#!/usr/bin/env node
/**
 * Jev（TypeSafe System One 模型）PR 可信度预检 —— 调度基础设施（AGENTS.md 例外，可直推 dev）。
 *
 * 背景：NPC 交上来的 PR 一律「不信自述」。本脚本把 PR 标题/描述 + 变更文件清单
 * 交给 TypeSafe 的 Jev（只回类型化判定与概率，不生成文本），一次批量问 7 个独立
 * 问题：总评（choice）、描述一致性 / 夹带改动 / 存量数据红线 / 描述外高危面 /
 * 测试弱化（noul×5）、工程质量（score 1-5）。判定结果由**本脚本**按固定政策组装
 * 成 markdown 评论落在 PR 上，给人工审查做参考——模型出判定，政策留在代码。
 *
 * 立场：预检仅供参考，**不是合并门禁**。choice 置信 < 0.5 一律回落「需人工细看」；
 * CI 里任何本脚本报错都只打日志不红流水线；绝不会因「Jev 说不可信」拦 PR。
 *
 * 运行环境两种，自动识别：
 *   CI（.cnb.yml pull_request 流水线，node:24 镜像）：内置环境
 *     CNB_PULL_REQUEST_IID / CNB_TOKEN / CNB_API_ENDPOINT 存在即为 CI；
 *     key 缺失 → 打日志优雅跳过（exit 0），不挡质量门。数据与评论走 OpenAPI。
 *   本地（调度机，node ≥20）：
 *     `node .cnb/scripts/jev-pr-review.mjs <PR号> [--repo 组/子/仓] [--post] [--dry-run]`
 *     数据走已登录的 cnb CLI（零 token 处理）；默认只打印，--post 才落评论。
 *
 * key（jevkey）：环境变量 TYPESAFE_API_KEY（或别名 JEV_KEY）。仓库内不落 key：
 * CI 从私有仓库 imports 注入（.cnb.yml 里有预留注释行）；本地 export 即可。
 * 直连 REST 而不用 @typesafe-ai/sdk：给构建镜像引入新依赖属于业务面改动，
 * fetch 三十行就够了，不值得为基础设施动 package.json。
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const CNB_API_FALLBACK = "https://api.cnb.cool";
const MARKER = "<!-- jev-pr-review:v1 -->";

// diff 进 state 的上限：TypeSafe 按输入计费，锁文件/产物只报名字不报内容
const PER_FILE_PATCH_CAP = 4000;
const TOTAL_PATCH_CAP = 80_000;
const MAX_FILES = 150;
const PR_BODY_CAP = 4000;
const LOCKLIKE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|.*\.zip$)/;

/** 本项目最高约束（AGENTS.md 数据演进守则摘要），作为判定 state 的一部分。 */
const PROJECT_RULES = `「温故」是思源笔记的刷题插件，存量用户数据兼容是最高约束。PR 触碰以下任一条即视为高危：
1. 持久化 JSON 字段改名或删除（只允许新增 optional 字段 + 装载 backfill）；
2. 改动冻结清单：BankParse.questionHash 归一化、WordBook.wordKey 归一化、
   custom-plugin-wengu-* 属性名、题块 kramdown 结构、SrcChunk srcKey 键格式、KnowledgeNorm.knKey；
3. 往题块 kramdown 写新的非内容属性却没同步 BankParse 的 RUNTIME_ATTR_HASH_RE 剥除名单；
4. 存储 version 字段参与装载判据或被 bump；
5. 单文件超 500 行（scripts/check-line-limit.mjs 是 CI 硬闸）；
6. 触屏样式新增 media query（必须走 .wengu-mobile 根标记类分流）。`;

// ── 入参与运行模式 ────────────────────────────────────────────────

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const CI_MODE = Boolean(process.env.CNB_PULL_REQUEST_IID && process.env.CNB_TOKEN);
const API_KEY = process.env.TYPESAFE_API_KEY || process.env.JEV_KEY || "";

function usageAndExit() {
    console.log(`用法：node .cnb/scripts/jev-pr-review.mjs <PR号> [--repo 组/子/仓] [--post] [--dry-run]
  --repo     缺省时从 git remote cnb 的 URL 推断
  --post     把评审评论发到 PR（缺省只打印）
  --dry-run  只打印发给 Jev 的 state/questions，不调 API（不需要 key）`);
    process.exit(2);
}

function repoFromGitRemote() {
    // 两台调度机的远端命名相反（cnb=CNB 或 origin=CNB），逐个试、按 URL 域名认
    for (const name of ["cnb", "origin"]) {
        try {
            const url = execFileSync("git", ["remote", "get-url", name], { encoding: "utf8" }).trim();
            const m = url.match(/cnb\.cool[/:](.+?)(\.git)?$/);
            if (m) return m[1];
        } catch {
            // 该远端不存在，试下一个
        }
    }
    return "";
}

const prNumber = CI_MODE ? String(process.env.CNB_PULL_REQUEST_IID) : args.find((a) => /^\d+$/.test(a));
if (!prNumber) usageAndExit();

function repoArg() {
    const inline = args.find((a) => a.startsWith("--repo="));
    if (inline) return inline.slice("--repo=".length);
    const i = args.indexOf("--repo");
    if (i !== -1 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
    return "";
}
const repoSlug = CI_MODE ? process.env.CNB_REPO_SLUG : repoArg() || repoFromGitRemote();
if (!repoSlug) usageAndExit();

// ── CNB 数据获取：CI 走 OpenAPI（CNB_TOKEN），本地走 cnb CLI ──────

async function cnbRest(method, path, body) {
    const base = process.env.CNB_API_ENDPOINT || CNB_API_FALLBACK;
    const res = await globalThis.fetch(base + path, {
        method,
        headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${process.env.CNB_TOKEN}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`CNB API ${method} ${path} -> ${res.status}`);
    return res.json();
}

/** cnb CLI -v 输出 { status, data } 包装；非 200 抛错。 */
function cnbCliData(cliArgs) {
    const out = execFileSync("cnb", [...cliArgs, "-v"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const parsed = JSON.parse(out);
    if (parsed.status !== 200) throw new Error(`cnb CLI ${cliArgs[0]} -> ${parsed.status}`);
    return parsed.data;
}

async function fetchPullDetail() {
    if (CI_MODE) return cnbRest("GET", `/${repoSlug}/-/pulls/${prNumber}`);
    return cnbCliData(["pulls", "get-pull", "--repo", repoSlug, "--number", prNumber]);
}

/** 文件列表分页拉全：页参数名不确定，按「无新文件名即停」兜底，封顶 MAX_FILES。 */
async function fetchPullFiles() {
    const seen = new Set();
    const files = [];
    for (let page = 1; page <= 20; page++) {
        const batch = CI_MODE
            ? await cnbRest("GET", `/${repoSlug}/-/pulls/${prNumber}/files?page=${page}&pageSize=100`)
            : cnbCliData(["pulls", "list-pull-files", "--repo", repoSlug, "--number", prNumber]);
        const fresh = (Array.isArray(batch) ? batch : []).filter((f) => f.filename && !seen.has(f.filename));
        if (fresh.length === 0) break; // 页参数失效会重复拿到同一页，也在这里自然停机
        fresh.forEach((f) => {
            seen.add(f.filename);
            files.push(f);
        });
        if (files.length >= MAX_FILES) break;
    }
    return files.slice(0, MAX_FILES);
}

// ── Jev 判定：一次批量 7 个独立问题（skill 口径：独立问题同请求并行） ──

function buildState(detail, files) {
    let patchBudget = TOTAL_PATCH_CAP;
    const diffFiles = files.map((f) => {
        const item = { path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions };
        if (f.patch == null) item.patch = "(二进制或无 patch)";
        else if (LOCKLIKE.test(f.filename)) item.patch = "(内容略：锁文件/产物)";
        else {
            const capped = f.patch.slice(0, Math.min(PER_FILE_PATCH_CAP, patchBudget));
            patchBudget -= capped.length;
            if (capped.length < f.patch.length) item.patch = capped + "\n…(截断)";
            else item.patch = capped;
        }
        return item;
    });
    const body = (detail.body || "").slice(0, PR_BODY_CAP);
    // CNB 的 head/base 是对象，ref 带 refs/heads/ 前缀
    const refName = (r) => (typeof r === "string" ? r.replace(/^refs\/heads\//, "") : "");
    return {
        pr: {
            title: detail.title || "",
            description: body,
            source_branch: refName(detail.head?.ref) || detail.source_branch || "",
            target_branch: refName(detail.base?.ref) || detail.target_branch || "",
            author: detail.author ?? detail.proposer ?? "",
        },
        diff_summary: {
            changed_files: files.length,
            additions: files.reduce((s, f) => s + (f.additions || 0), 0),
            deletions: files.reduce((s, f) => s + (f.deletions || 0), 0),
            truncated: files.length >= MAX_FILES || patchBudget < 0,
        },
        diff_files: diffFiles,
        project_rules: PROJECT_RULES,
    };
}

function buildQuestions() {
    return {
        verdict: {
            type: "choice",
            instructions: "综合以下全部 state（PR 描述、diff、本项目红线）判断这个 PR 的可信度，供人工审查分流参考。",
            criteria: {
                trustworthy: "改动与描述一致，无夹带、无红线风险，可进入常规人工审查",
                needs_human_review: "存在不确定点（低置信、描述对不上、或触碰敏感面），人工必须细看",
                suspicious: "发现夹带、描述失实或红线嫌疑，人工审查需重点核查",
            },
        },
        desc_matches_diff: {
            type: "noul",
            instructions: "PR 的 title+description 是否如实反映了 diff 的实际改动内容？",
            criteria: { true: "描述与改动基本一致", false: "描述遗漏、夸大或与改动矛盾" },
        },
        unrelated_changes: {
            type: "noul",
            instructions: "diff 里是否夹带了与 PR 声称目的无关的改动？",
            criteria: { true: "存在无关夹带改动", false: "改动都与目的相关" },
        },
        data_compat_violation: {
            type: "noul",
            instructions: "对照 `project_rules`，diff 是否触碰存量用户数据兼容红线？",
            criteria: { true: "触碰或疑似触碰红线", false: "未触碰红线" },
        },
        hidden_risk: {
            type: "noul",
            instructions: "diff 是否动了 PR 描述未提及的高影响面（依赖、构建脚本、CI 配置、入口文件、锁文件）？",
            criteria: { true: "动了未声明的高影响面", false: "高影响面改动均已声明" },
        },
        tests_weakened: {
            type: "noul",
            instructions: "diff 是否删除测试、跳过测试（skip/todo）或弱化断言，且改动中没有正当说明？",
            criteria: { true: "存在测试弱化且无说明", false: "测试未被削弱或有正当说明" },
        },
        craft: {
            type: "score",
            instructions: "就 diff 展现的整体工程质量打分（改动意图合理性、实现干净度、测试与文档配套）。",
            criteria: [
                "1 = 几乎不可合：红线全踩或大面积越权改动，应打回",
                "2 = 问题不少：描述失实、缺测试或实现粗糙，多处需返工",
                "3 = 勉强及格：主改动成立，边缘粗糙，需小修",
                "4 = 良好：改动干净、测试到位，仅个别建议项",
                "5 = 优秀：可直接进入人工终审，近乎无可挑剔",
            ],
        },
    };
}

async function jevJudge(state) {
    const payload = { model: "jev-latest", state, questions: buildQuestions() };
    for (let attempt = 1; attempt <= 2; attempt++) {
        const res = await globalThis.fetch(TYPESAFE_URL, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
            body: JSON.stringify(payload),
            signal: globalThis.AbortSignal ? globalThis.AbortSignal.timeout(90_000) : undefined,
        });
        if ((res.status === 429 || res.status === 529) && attempt === 1) {
            await new Promise((r) => setTimeout(r, 5000));
            continue;
        }
        if (res.status === 401 || res.status === 403)
            throw new Error(`TYPESAFE_API_KEY 无效（${res.status}），检查 key 是否正确/有效`);
        if (!res.ok) throw new Error(`TypeSafe ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return res.json();
    }
    throw new Error("TypeSafe 限流/过载（429/529），重试一次仍失败");
}

// ── 判定 → 评论：政策在代码，不在模型 ─────────────────────────────

const VERDICT_LABEL = {
    trustworthy: "✅ 可信",
    needs_human_review: "⚠️ 需人工细看",
    suspicious: "🚨 可疑，重点核查",
};
// [key, 展示名, noul 高概率是否算「好」]
const NOUL_ITEMS = [
    ["desc_matches_diff", "描述如实反映改动", true],
    ["unrelated_changes", "无夹带改动", false],
    ["data_compat_violation", "存量数据兼容红线未触碰", false],
    ["hidden_risk", "无描述外的高影响面改动", false],
    ["tests_weakened", "测试未被削弱", false],
];

function noulCell(p, highIsGood) {
    const prob = `p=${p.toFixed(2)}`;
    if (p >= 0.8) return highIsGood ? `✅ ${prob}` : `❌ ${prob}`;
    if (p <= 0.2) return highIsGood ? `❌ ${prob}` : `✅ ${prob}`;
    return `⚠️ 不确定 ${prob}`;
}

function composeComment(modelEcho, usage, answers) {
    const verdict = answers.verdict || {};
    const lowConfidence = typeof verdict.confidence === "number" && verdict.confidence < 0.5;
    const verdictLabel = lowConfidence
        ? `⚠️ 需人工细看（模型置信 ${verdict.confidence.toFixed(2)} < 0.5，本次判定不可靠，强制回落人工）`
        : `${VERDICT_LABEL[verdict.choice] || "⚠️ 需人工细看"}（verdict=\`${verdict.choice}\`，置信 ${Number(verdict.confidence ?? 0).toFixed(2)}）`;

    const rows = NOUL_ITEMS.map(([key, label, highIsGood]) => {
        const p = answers[key]?.noul;
        return `| ${label} | ${typeof p === "number" ? noulCell(p, highIsGood) : "（无判定）"} |`;
    }).join("\n");

    const craft = answers.craft || {};
    const craftLine =
        typeof craft.score === "number"
            ? `${craft.score.toFixed(1)} / 5（置信 ${Number(craft.confidence ?? 0).toFixed(2)}）`
            : "（无判定）";

    const tokens = usage ? `，in ${usage.input_tokens ?? "?"} / out ${usage.output_tokens ?? "?"} tok` : "";
    return [
        MARKER,
        "## 🧭 Jev 可信度预检（自动，非合并门禁）",
        "",
        `**总评：${verdictLabel}**`,
        "",
        "| 检查项 | 判定 |",
        "|---|---|",
        rows,
        "",
        `**工程质量**：${craftLine}`,
        "",
        `> Jev（${modelEcho}${tokens}）只做类型化判定，本评论由脚本按固定政策组装，供人工审查参考；`,
        "> 合并决定仍走人工流程。对判定有疑义可本地复跑：`node .cnb/scripts/jev-pr-review.mjs <PR号>`。",
    ].join("\n");
}

// ── 评论落 PR：带 marker 则覆写，避免刷屏 ─────────────────────────

async function findMarkedCommentId() {
    try {
        const list = CI_MODE
            ? await cnbRest("GET", `/${repoSlug}/-/pulls/${prNumber}/comments?page=1&pageSize=50`)
            : cnbCliData(["pulls", "list-pull-comments", "--repo", repoSlug, "--number", prNumber]);
        const hit = (Array.isArray(list) ? list : []).find(
            (c) => typeof c.body === "string" && c.body.includes(MARKER)
        );
        return hit ? hit.id : "";
    } catch {
        return ""; // 查评论失败不致命：退化为新建评论
    }
}

async function postComment(markdown) {
    if (CI_MODE) {
        const oldId = await findMarkedCommentId();
        if (oldId) {
            await cnbRest("PATCH", `/${repoSlug}/-/pulls/${prNumber}/comments/${oldId}`, { body: markdown });
            return "updated";
        }
        await cnbRest("POST", `/${repoSlug}/-/pulls/${prNumber}/comments`, { body: markdown });
        return "created";
    }
    const tmp = `/tmp/jev-pr-${prNumber}.md`;
    writeFileSync(tmp, markdown);
    execFileSync("cnb", ["pulls", "post-pull-comment", "--repo", repoSlug, "--number", prNumber, "--body-file", tmp], {
        encoding: "utf8",
    });
    return "created";
}

// ── 主流程 ────────────────────────────────────────────────────────

async function main() {
    if (!API_KEY && CI_MODE) {
        console.log("[jev-review] 跳过：未配置 TYPESAFE_API_KEY（CI 从私有仓库 imports 注入后自动生效）");
        return;
    }
    if (!API_KEY && !hasFlag("--dry-run")) {
        console.error("[jev-review] 缺 key：export TYPESAFE_API_KEY=... 后重跑；只看装配结果可加 --dry-run");
        process.exit(2);
    }

    console.log(`[jev-review] 拉取 PR #${prNumber}（${repoSlug}）…`);
    const [detail, files] = [await fetchPullDetail(), await fetchPullFiles()];
    if (!files.length) throw new Error("取到 0 个变更文件，PR 数据异常");
    const state = buildState(detail, files);
    console.log(
        `[jev-review] state 装配完成：${state.diff_summary.changed_files} 个文件 +${state.diff_summary.additions}/-${state.diff_summary.deletions}`
    );

    if (hasFlag("--dry-run")) {
        console.log(JSON.stringify({ model: "jev-latest", state, questions: buildQuestions() }, null, 2));
        return;
    }

    console.log("[jev-review] 请求 Jev 判定 …");
    const resp = await jevJudge(state);
    const markdown = composeComment(resp.model, resp.usage, resp.answers || {});
    console.log(markdown);

    if (CI_MODE || hasFlag("--post")) {
        const how = await postComment(markdown);
        console.log(`[jev-review] 评论已${how === "updated" ? "更新" : "发布"}到 PR #${prNumber}`);
    }
}

try {
    await main();
} catch (err) {
    console.error(`[jev-review] 失败：${err?.message || err}`);
    // CI 里预检失败绝不挡门禁；本地保留非零退出码方便脚本化感知
    process.exit(CI_MODE ? 0 : 1);
}
