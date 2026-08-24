import { fetchSyncPost } from "siyuan";
import { agentChat, agentChatConcurrent } from "./AgentClient";
import { AI_TIMEOUT_MS } from "./ConvertService";

/**
 * 知识点反链（从 ConvertBatch 拆出的独立关注点）：
 * 转换前按用户给的知识点根文档（书架/书）建两级索引（章 → h2~h4 小节，
 * 全部走 SQL 拿块 id，不导出正文）；每批生成前先路由出本批涉及的小节，
 * 让 AI 用 K 别名标注（避免抄错长块 id），生成后把别名映射回真实块 id、
 * 在解析引述块尾注入 `((id "标题"))` 块引用——知识点文档的反链面板
 * 即可看到相关题目，题目卡里点击可跳转（Protyle 原生渲染块引用）。
 *
 * 真机数据（20260823，/MinerU 书架）：61 个实质章节 304 万字，章中位
 * 4.7 万字——正文挂载不可行，本模块只做标题级路由与引用注入。
 * 任何路由失败都降级为「该批不加链接」，不阻断转换主流程。
 */

/** 知识点小节（h2~h4 标题块）。 */
export interface KnowSection {
    /** 标题块 id（块引用目标）。 */
    id: string;
    /** 小节标题。 */
    title: string;
    /** 展示路径：书架/书/章节/小节。 */
    path: string;
}

/** 知识点章节（一个叶子文档）。 */
export interface KnowChapter {
    /** 章节文档 id（无小节结构的章直接引用文档根块）。 */
    docId: string;
    title: string;
    /** 展示路径：书架/书/章节。 */
    path: string;
    sections: KnowSection[];
}

/** 两级索引：路由①在章集合上选，路由②在选中章的小节集合上选。 */
export interface KnowledgeIndex {
    chapters: KnowChapter[];
}

/** 路由调用通道（与生成同通道：串行走 agent/chat，并发走 chatGPT）。 */
export interface KnowRouteDeps {
    call(message: string): Promise<string>;
}

/** SQL 查询（fetchSyncPost 包装，失败抛错由调用方降级）。 */
async function sql(stmt: string): Promise<Map<string, string>[]> {
    const r = await fetchSyncPost("/api/query/sql", { stmt });
    if (r.code !== 0) throw new Error(r.msg || "sql failed");
    return ((r.data ?? []) as { [k: string]: unknown }[]).map((row) => {
        const m = new Map<string, string>();
        for (const [k, v] of Object.entries(row)) m.set(k, typeof v === "string" ? v : String(v ?? ""));
        return m;
    });
}

/** 分页拉全量：内核 SQL API 对无 LIMIT 的查询静默截断到 64 行
 *  （真机 20260823 验证），子查询不支持（返回空），必须显式分页。 */
async function sqlAll(stmt: string, pageSize = 512): Promise<Map<string, string>[]> {
    const out: Map<string, string>[] = [];
    for (let off = 0; ; off += pageSize) {
        const page = await sql(`${stmt} LIMIT ${pageSize} OFFSET ${off}`);
        out.push(...page);
        if (page.length < pageSize) return out;
    }
}

/**
 * 建知识点索引。rootIds 是用户填的知识点根文档（书架那层或直接一本
 * 书/一章）：取其下所有叶子文档为章节（书名空壳层自动排除），根自身
 * 无叶子后代时（用户直接指到章节）把根当唯一章节。无小节结构的章节
 * 引用文档根块本身。
 */
export async function buildKnowledgeIndex(rootIds: string[]): Promise<KnowledgeIndex> {
    const chapters: KnowChapter[] = [];
    for (const rid of rootIds) {
        let root;
        try {
            root = (
                await sql(`SELECT id, box, path, content, hpath FROM blocks WHERE id = '${rid}' AND type = 'd' LIMIT 1`)
            )[0];
        } catch (_) {
            continue;
        }
        if (!root?.get("box")) continue;
        const rootPath = root.get("path");
        const dir = rootPath.replace(/\.sy$/, "");
        const rows = await sqlAll(
            `SELECT id, path, content, hpath FROM blocks WHERE type = 'd' AND box = '${root.get(
                "box"
            )}' AND path LIKE '${dir}/%.sy' ORDER BY hpath`
        );
        // 叶子 = 没有任何文档以它为父目录（书名空壳层自动出局）
        const parentDirs = new Set(
            rows.map((r) => {
                const p = r.get("path");
                return p.slice(0, p.lastIndexOf("/"));
            })
        );
        let leaves = rows.filter((r) => !parentDirs.has(r.get("path").replace(/\.sy$/, "")));
        if (leaves.length === 0) leaves = [root];
        // 一次性拉全部叶子章节的 h2~h4 标题块（按 sort 保序；分页后要按章重排）
        const ids = leaves.map((r) => `'${r.get("id")}'`).join(",");
        const heads = ids
            ? await sqlAll(
                  `SELECT root_id, id, content FROM blocks WHERE type = 'h' AND subtype IN ('h2','h3','h4') AND root_id IN (${ids}) ORDER BY root_id, sort`
              )
            : [];
        const byRoot = new Map<string, { id: string; content: string }[]>();
        for (const h of heads) {
            const k = h.get("root_id");
            const arr = byRoot.get(k) ?? [];
            arr.push({ id: h.get("id"), content: h.get("content") });
            byRoot.set(k, arr);
        }
        for (const leaf of leaves) {
            const hp = leaf.get("hpath");
            const secs = (byRoot.get(leaf.get("id")) ?? []).map((h) => ({
                id: h.id,
                title: h.content,
                path: `${hp}/${h.content}`,
            }));
            chapters.push({
                docId: leaf.get("id"),
                title: leaf.get("content") || hp,
                path: hp,
                sections: secs,
            });
        }
    }
    return { chapters };
}

/** 从路由回复里抽数字（JSON 或裸列表都行），保序去重并限界 [1,max]。 */
function parseNums(reply: string, max: number): number[] {
    const out: number[] = [];
    for (const m of reply.matchAll(/\d+/g)) {
        const n = Number(m[0]);
        if (n >= 1 && n <= max && !out.includes(n)) out.push(n);
    }
    return out;
}

/** 小节清单的字符预算（路由②输入里清单部分的上限，保 30s 超时安全区）。 */
const SECTION_INDEX_CHARS = 2200;
/** 单批最多命中章 / 供生成标注的小节数。 */
const MAX_HIT_CHAPTERS = 4;
const MAX_SECTIONS = 10;

/**
 * 两级路由：①章清单（全部章标题，几百字）→ 命中章；②小节清单（命中
 * 章的 h2~h4 标题）→ 小节。返回 K 别名 → 小节的映射（供生成 prompt 与
 * 后处理共享）。任何一步失败返回空映射（该批不加链接）。
 */
export async function routeKnowledge(
    chunk: string,
    index: KnowledgeIndex,
    deps: KnowRouteDeps
): Promise<Map<string, KnowSection>> {
    const out = new Map<string, KnowSection>();
    try {
        if (index.chapters.length === 0) return out;
        let hit = index.chapters;
        if (index.chapters.length > 1) {
            const list = index.chapters.map((c, i) => `${i + 1}|${c.path}`).join("\n");
            const reply = await deps.call(
                `你是思源笔记的知识点路由器。下面是题目原文和章节清单（编号|路径）。
判断这批题目考查的内容涉及哪些章节，只输出 JSON，格式之外不要输出任何文字：
{"chapters":[编号,编号]}
规则：只输出清单里存在的编号，最多 ${MAX_HIT_CHAPTERS} 个，按相关度降序；没有合适的输出 {"chapters":[]}。

章节清单：
${list}

题目原文：
${chunk}`
            );
            const nums = parseNums(reply, index.chapters.length).slice(0, MAX_HIT_CHAPTERS);
            hit = nums.map((n) => index.chapters[n - 1]);
            if (hit.length === 0) return out;
        }
        // 汇总命中章的小节（按字符预算截断；无小节的章引用文档根本身）
        const picked: KnowSection[] = [];
        let chars = 0;
        for (const ch of hit) {
            if (ch.sections.length === 0) {
                picked.push({ id: ch.docId, title: ch.title, path: ch.path });
                continue;
            }
            for (const s of ch.sections) {
                if (chars + s.path.length > SECTION_INDEX_CHARS) continue;
                chars += s.path.length;
                picked.push(s);
            }
        }
        if (picked.length === 0) return out;
        const list2 = picked.map((s, i) => `${i + 1}|${s.path}`).join("\n");
        const reply2 = await deps.call(
            `你是思源笔记的知识点路由器。下面是题目原文和知识点小节清单（编号|路径）。
判断这批题目考查的具体知识点对应哪些小节，只输出 JSON，格式之外不要输出任何文字：
{"sections":[编号,编号]}
规则：只输出清单里存在的编号，最多 ${MAX_SECTIONS} 个，按相关度降序；没有合适的输出 {"sections":[]}。

知识点小节清单：
${list2}

题目原文：
${chunk}`
        );
        for (const n of parseNums(reply2, picked.length).slice(0, MAX_SECTIONS)) {
            const s = picked[n - 1];
            if (s) out.set(`K${out.size + 1}`, s);
        }
    } catch (_) {
        // 路由失败降级：本批不加知识点链接
    }
    return out;
}

/** 生成 prompt 的第 12 条规则（仅在路由出小节时追加）。 */
export function knowRule(): string {
    return `
12. 知识点标注：文末「知识点清单」列出本批内容可能涉及的知识点（K 编号）。每道题按考查内容在容器属性行末尾追加 custom-plugin-wengu-know="K1,K3"（1~3 个最相关编号，逗号分隔；只能用清单里的编号，不得编造；没有合适的不加该属性）。`;
}

/** 生成 prompt 文末的知识点清单（K 别号 → 展示路径）。 */
export function knowListBlock(map: Map<string, KnowSection>): string {
    const lines = [...map.entries()].map(([k, s]) => `${k}|${s.path}`);
    return `

知识点清单（供第 12 条规则标注用）：
${lines.join("\n")}`;
}

/** 路由+生成一体的批调用（ConvertBatch 的 worker 直接用）：先路由出
 *  小节（失败/为空降级为普通生成），再带着 K 清单调生成通道。 */
async function knowAwareCall(
    chunkText: string,
    index: KnowledgeIndex | undefined,
    deps: KnowRouteDeps & { generate(prompt: string): Promise<string> },
    buildPromptFn: (source: string, knowRuleBlock: string, knowList: string) => string
): Promise<{ reply: string; byAlias?: Map<string, KnowSection> }> {
    let rule = "";
    let list = "";
    let byAlias: Map<string, KnowSection> | undefined;
    if (index) {
        const routed = await routeKnowledge(chunkText, index, deps);
        if (routed.size > 0) {
            rule = knowRule();
            list = knowListBlock(routed);
            byAlias = routed;
        }
    }
    const reply = await deps.generate(buildPromptFn(chunkText, rule, list));
    return { reply, byAlias };
}

/** 知识点路由超时：输入短（批内容+索引）、输出一行 JSON。 */
const KNOW_ROUTE_TIMEOUT_MS = 120_000;

/** 组装「路由+生成」批调用：通道与生成本职一致（并发走 chatGPT 直答，
 *  串行走 agent/chat 可选模型），ConvertBatch 只提供 prompt 组装与信号。 */
export function makeKnowAwareAi(opts: {
    modelId: string;
    parallel: number;
    signal: AbortSignal;
    knowIndex: KnowledgeIndex | undefined;
    buildPrompt: (source: string, knowRuleBlock: string, knowList: string) => string;
}): (chunkText: string) => Promise<{ reply: string; byAlias?: Map<string, KnowSection> }> {
    const call = (message: string): Promise<string> =>
        opts.parallel > 1
            ? agentChatConcurrent(message, KNOW_ROUTE_TIMEOUT_MS, opts.signal)
            : agentChat(message, opts.modelId, KNOW_ROUTE_TIMEOUT_MS, opts.signal);
    const generate = (prompt: string): Promise<string> =>
        opts.parallel > 1
            ? agentChatConcurrent(prompt, AI_TIMEOUT_MS, opts.signal)
            : agentChat(prompt, opts.modelId, AI_TIMEOUT_MS, opts.signal);
    return (chunkText) => knowAwareCall(chunkText, opts.knowIndex, { call, generate }, opts.buildPrompt);
}

/** 引用文本消毒：去引号/换行，限长（块引用静态锚文本）。 */
function refTitle(title: string): string {
    return title
        .replace(/["<>\n\r]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 50);
}

/** 生成「相关知识点」引用行（与转换注入同格式，反链面板可见）。 */
export function knowledgeRefLine(refs: { id: string; title: string }[]): string {
    return `> 相关知识点：${refs.map((h) => `((${h.id} "${refTitle(h.title)}"))`).join(" ")}`;
}

/** 把知识点引用行注入题目 kramdown 的解析块尾（无解析块补独立块）。
 *  重新生成/针对性生成用：AI 不写引用，确定性注入。 */
export function injectKnowledgeRefs(kd: string, refs: { id: string; title: string }[]): string {
    if (refs.length === 0) return kd;
    const line = knowledgeRefLine(refs);
    const sol = SOLUTION_RE.exec(kd);
    if (sol) {
        return kd.replace(SOLUTION_RE, (_m, quote: string, ial: string) => `\n${quote}\n${line}\n${ial}`);
    }
    const close = kd.lastIndexOf("}}}");
    if (close < 0) return kd;
    return kd.slice(0, close) + `${line}\n{: custom-plugin-wengu-part="solution"}\n\n` + kd.slice(close);
}

/** 取知识点小节的正文（标题块 id → 该标题下到下一个同级/更高级标题
 *  之前的块内容，SQL 按 sort 顺序拼接；供重新生成/针对性生成喂正文）。 */
export async function sectionKramdown(headingId: string, maxChars = 3000): Promise<string> {
    const head = (await sql(`SELECT root_id, subtype FROM blocks WHERE id = '${headingId}' AND type = 'h' LIMIT 1`))[0];
    if (!head) return "";
    const myLevel = Number(head.get("subtype")?.replace("h", "")) || 2;
    const rows = await sqlAll(
        `SELECT id, subtype, type, content FROM blocks WHERE root_id = '${head.get("root_id")}' AND type IN ('h','p','l','b','c','t','i','s','m','html','embed') ORDER BY sort`
    );
    let started = false;
    const out: string[] = [];
    for (const r of rows) {
        const isHead = r.get("type") === "h";
        if (started && isHead) {
            const lv = Number(r.get("subtype")?.replace("h", "")) || 1;
            if (lv <= myLevel) break; // 同级或更高级标题：小节结束
        }
        if (r.get("id") === headingId) {
            started = true;
            continue;
        }
        if (started && out.join("\n").length + r.get("content").length > maxChars) break;
        if (started) out.push(r.get("content"));
    }
    return out.join("\n\n");
}

/** 解析引述块（多行 > 引用 + 紧随的 part="solution" IAL 行）。 */
const SOLUTION_RE =
    /\n[ \t]*(>[^\n]*(?:\n[ \t]*>[^\n]*)*)\n[ \t]*(\{:[^\n]*custom-plugin-wengu-part="solution"[^\n]*\})/;

/**
 * 生成后处理：把题目容器 IAL 上的 know 别名映射回真实块 id——在解析
 * 引述块尾注入「相关知识点：((id "标题")) …」（并入 solution 块，作答
 * 前随解析一起隐藏防剧透），并剥掉临时属性（落盘格式不变）。
 * 无解析块时补一个独立的 solution 引述块。返回注入成功的题数。
 */
export function applyKnowLinks(
    questions: string[],
    byAlias: Map<string, KnowSection>
): { out: string[]; linked: number } {
    const out = [...questions];
    let linked = 0;
    for (let i = 0; i < out.length; i++) {
        const attr = /\s*custom-plugin-wengu-know="([^"]*)"/.exec(out[i]);
        if (!attr) continue;
        const stripped = out[i].replace(/\s*custom-plugin-wengu-know="[^"]*"/, "");
        const seen = new Set<string>();
        const hits: KnowSection[] = [];
        for (const a of attr[1].split(/[\s,;，；]+/)) {
            const s = byAlias.get(a.trim());
            if (s && !seen.has(s.id)) {
                seen.add(s.id);
                hits.push(s);
            }
        }
        if (hits.length === 0) {
            out[i] = stripped;
            continue;
        }
        const line = `> 相关知识点：${hits.map((h) => `((${h.id} "${refTitle(h.title)}"))`).join(" ")}`;
        const sol = SOLUTION_RE.exec(stripped);
        if (sol) {
            // 追加为解析引述块的最后一行引用（IAL 行之前），保持同一 part 块
            out[i] = stripped.replace(SOLUTION_RE, (_m, quote: string, ial: string) => `\n${quote}\n${line}\n${ial}`);
        } else {
            // 无解析块：容器闭合 }}} 前补独立 solution 块
            const close = stripped.lastIndexOf("}}}");
            if (close < 0) {
                out[i] = stripped;
                continue;
            }
            out[i] =
                stripped.slice(0, close) +
                `${line}\n{: custom-plugin-wengu-part="solution"}\n\n` +
                stripped.slice(close);
        }
        linked++;
    }
    return { out, linked };
}
