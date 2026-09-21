/**
 * AI 转换质检（Issue #184，规划稿 A1）：每个落库批**在写题库之前**问 Jev
 * 五项，判定结果收成「Jev 存疑」清单随**转换报告**展示。
 *
 * 三项硬口径（规划稿 §二 纪律 1/2/3）：
 *  - **只标不删**：明确踩雷（如「可推出」≤0.2）与低置信一样，只进存疑清单
 *    ——静默丢数据违反数据演进守则，删不删永远是人点；
 *  - **失败/低置信回落现状**：无 key（`isJevEnabled` 为假）、调用抛错、
 *    响应形状不对，一律返回空清单，**不阻塞且不改动**转换主流程；
 *  - **判定结果不落盘**：清单只挂在这次运行的返回值上，报告关了即没；
 *    本模块不碰任何持久化存储（冻结清单/题库格式零改动）。
 *
 * 一次请求问完（纪律 5）：整批题目 + 材料原文打成一个 `state`，五项作为
 * 同一批独立问题发出去——**不逐题发请求**。
 *
 * 本模块是**纯判定层**：不 import 转换域的类型（`DraftUnit` 的结构等价
 * 由调用方按 `CheckDraft` 的形状给出），输入输出都是纯数据，故可直测。
 * 是否启用由调用方判（`isJevEnabled(settings)`），这里只认「给不给 key」。
 */
import { judgeJev, type JevAnswer, type JevQuestion } from "./client";
import { fmt } from "../../ui/shared";
import type { JevTransportFn } from "./transport";
import type { JevTrack } from "./track";
import { noulVerdict, scoreLowConfidence } from "./policy";

/* ── 输入形状（与 convert 域 DraftUnit 结构性兼容，故意不 import） ── */

/** 质检只看草稿的这三样：题型属性、部件文本、是否材料块。 */
export interface CheckDraft {
    material: boolean;
    attrs: Record<string, string>;
    parts: { name: string; text: string }[];
}

/* ── 五项判定的内部键（同时是线上问题名 q0..q4 的位序） ── */

const K_UNIQUE = "unique";
const K_DERIVE = "derive";
const K_RELEVANT = "relevant";
const K_TYPE = "typeOk";
const K_QUALITY = "quality";

/**
 * 五项问题（**一次请求**发出去，见文件头）。
 *
 * ⚠️ 两处措辞**别当普通文案改**（#184 验收 3/4 的实际分水岭）：
 *  - 「与其他选项含义相同或可同时为真」写成「含义相同」会被判成「不唯一」
 *    ——那正是极正常的多选/多填，处处误报；
 *  - 「答案能否从材料推出」必须限「仅凭这段材料」，否则模型按常识也能判
 *    「能推出」，烂题照样过关。
 */
function buildQuestions(): JevQuestion[] {
    return [
        {
            kind: "noul",
            question:
                "这道题的正确答案是否唯一？即：给定材料，只有一个选项（或一种答案）成立；" +
                "不存在另一个选项与其他选项含义相同、或可与正确答案同时成立的情况。",
        },
        {
            kind: "noul",
            question: "仅凭随后给出的这段材料原文（不借助材料之外的知识），题干与答案是否能够推出？",
        },
        { kind: "noul", question: "这道题是否与这段材料原文直接相关？它不是凭空编造、与材料无关的题目。" },
        { kind: "noul", question: "这道题的题型是否正确？它与题干、选项所表达的实际题型一致，没有转错形。" },
        {
            kind: "score",
            question: "这道题作为练习题的总体质量如何？",
            legend: {
                "1": "废题：答案错误、与材料无关或无法作答",
                "2": "可用但差：表述含糊、多个选项讲得通、或与材料关系牵强",
                "3": "尚可：能作答但题干或解析偏简略，练习价值一般",
                "4": "良好：表述清楚、答案有据、与材料直接相关",
                "5": "优秀：题干清楚、答案唯一且有据、干扰项合理、解析到位",
            },
        },
    ];
}

/* ── 判定结果 ── */

/** 存疑原因（一处一码，报告按码取文案：`jevQc<Reason>` 键）。 */
export type JevQcReason = "unique" | "derive" | "relevant" | "typeOk" | "quality";

/** 一个**存疑项**：不绑题目（五项是对整片的判定，逐题绑定会假装精确）。 */
export interface JevQcSuspect {
    reason: JevQcReason;
    /** 是否已明确踩雷（而非仅仅不确定）——两者都只标不删，仅措辞不同； */
    /** 明确踩雷才会带上被点名的题目（不确定时点名反而是误导）。 */
    clear: boolean;
    /** 重点题目（整片判定无从归属到具体某题，当前恒空——见 `checkBatch`）。 */
    items: { index: number; stem: string }[];
}

/** 一次批质检的结果（内存态，不落盘）。 */
export interface JevQcReport {
    /** 本批被判定的题目数（不含材料；0 = 无题可判，未发请求）。 */
    checked: number;
    /** 命中的存疑项（空 = 本批全部五项过关）。 */
    suspects: JevQcSuspect[];
}

/** 各存疑原因 → 中文/英文说明的 i18n 键（报告与通知共用一处口径）。 */
export const JEV_QC_REASON_KEY: Record<JevQcReason, string> = {
    unique: "jevQcUnique",
    derive: "jevQcDerive",
    relevant: "jevQcRelevant",
    typeOk: "jevQcType",
    quality: "jevQcQuality",
};

/** 单项存疑的**可见标注**一行（哪一项存疑 + 一句原因）——
 *  报告与站内通知共用的唯一组装点。 */
export function suspectLabel(t: (k: string) => string, s: JevQcSuspect): string {
    const head = s.clear ? t("jevQcClear") : t("jevQcUnsure");
    const names = s.items.map((i) => `第 ${i.index} 题「${i.stem}」`).join("、");
    const reason = t(JEV_QC_REASON_KEY[s.reason]);
    return names ? `${head}${t("jevQcOf")}${names}（${reason}）` : `${head}（${reason}）`;
}

/**
 * 存疑项**按（原因 + 是否明确）去重**，保留首次出现顺序。
 *
 * 为什么必须去重（#184 复核抓出）：判定是**逐批**做的，一篇 6 批题的文档
 * 会把同一个毛病重复 6 次——报告行于是长成「· 明确有问题（…）」× 6 的
 * 复读机（用户看到的是同一个结论，不是六个问题）。题数已由头部
 * 「已判定 N 题」汇总，逐条只需说清「有哪些项存疑」。
 */
export function dedupeSuspects(suspects: JevQcSuspect[]): JevQcSuspect[] {
    const seen = new Set<string>();
    const out: JevQcSuspect[] = [];
    for (const s of suspects) {
        const key = `${s.reason}|${String(s.clear)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

/**
 * 质检汇总一行（**报告文案的唯一组装点**：整卷尾巴、增量链、页内报告行的
 * 头部都从这里出，别各拼一套）。
 *
 * 无存疑 → 「未发现存疑项」；有存疑 → 「Jev 存疑（已判定 N 题）：…」+
 * 去重后的「哪一项 + 一句原因」。
 */
export function qcSummary(t: (k: string) => string, report: JevQcReport): string {
    const list = dedupeSuspects(report.suspects);
    if (list.length === 0) return t("jevQcPass");
    const head = `${t("jevQcSuspect")}${fmt(t("jevQcHeadCount"), { n: String(report.checked) })}`;
    return `${head}${list.map((s) => suspectLabel(t, s)).join("；")}`;
}

/* ── 增量（逐块）质检 ── */

/** 增量链的判定合计（逐块判、逐块回落）。 */
export interface JevQcChunkSummary {
    /** 逐块报告（只收**判出存疑**的块，顺序即块序）。 */
    reports: { index: number; report: JevQcReport }[];
    /** 有存疑的块数。 */
    suspectChunks: number;
    /** 已判定成功的块数（失败/未启用不计）。 */
    checkedChunks: number;
}

/* ── 判定（主入口） ── */

/** 单批判定的入参（纯数据，调用方把整批题目 + 材料原文交进来）。 */
export interface CheckBatchOpts {
    drafts: CheckDraft[];
    /** 材料原文（`state`）；空 = 无材料可依据（判据仍照问）。 */
    materialText: string;
    /** Jev key（空 = 未配置，直接返回空报告、不发请求）。 */
    apiKey?: string;
    /** 传输注入（单测 mock；缺省走内核 forwardProxy）。 */
    transport?: JevTransportFn;
    /** 退避等待注入（单测避免真睡）。 */
    sleep?: (ms: number) => Promise<void>;
    /** 会话登记（Issue #201，可选）：本批的判定落一条记录（kind 固定
     *  `"jev"`）；标题/组由调用方给（逐批质检挂同组，面板树归并）。 */
    track?: JevTrack;
}

/** 单题在 `state` 里的紧凑形态：题干 + 选项 + 答案（解析不进质检文本，
 *  它只增加 token 而不影响五项判据）。 */
function questionLines(idx: number, d: CheckDraft): string {
    const text = (name: string): string =>
        d.parts
            .filter((p) => p.name === name)
            .map((p) => p.text.trim())
            .filter(Boolean)
            .join("\n");
    const opts = d.parts
        .filter((p) => /^option-\d+$/.test(p.name))
        .map((p, i) => `  ${String.fromCharCode(65 + i)}. ${p.text.trim()}`)
        .join("\n");
    const out = [`第 ${idx} 题（题型：${d.attrs.type ?? "未标注"}）`, text("stem")];
    if (opts) out.push(opts);
    const ans = text("answer");
    if (ans) out.push(`答案：${ans}`);
    return out.filter(Boolean).join("\n");
}

/** 整批状态文本：题目在前（含序号，供「重点题目」点名复用），材料在后
 *  （「可推出/材料相关」两项要的就是这段原文）。 */
export function buildCheckState(drafts: CheckDraft[], materialText: string): string {
    const qs: string[] = [];
    let n = 0;
    const mats: string[] = [];
    for (const d of drafts) {
        if (d.material) {
            const body = d.parts
                .filter((p) => p.name === "body" || p.name === "trans")
                .map((p) => p.text.trim())
                .filter(Boolean)
                .join("\n\n");
            if (body) mats.push(body);
            continue;
        }
        n++;
        qs.push(questionLines(n, d));
    }
    const parts = [qs.join("\n\n")];
    if (mats.length > 0) parts.push(`材料原文：\n${mats.join("\n\n")}`);
    else if (materialText.trim()) parts.push(`材料原文：\n${materialText.trim()}`);
    return parts.filter(Boolean).join("\n\n");
}

/**
 * 判定响应是否「问什么答什么」。
 *
 * ⚠️ 这里**不能只看 `kind`**：`client.parseAnswer` 是按**问题类型**建答案
 * 壳的（问 noul 就回一个 noul 壳），值读不到时它把 `noul` 读成 `NaN`、
 * choice 的 `confidence` 缺省成 0——壳的类型永远等于问题类型，拿 kind
 * 比对恒真（#184 实测：q0 回 `{choice:…}` 时 `kind` 仍是 `"noul"`）。
 * 因此判定**看值**：noul 概率必须是有限数，score 分值必须是有限数，
 * 缺值即「上游回了壳没回值」，整批弃掉回落现状（宁可漏报，不误报）。
 */
function answersUsable(answers: JevAnswer[]): boolean {
    if (answers.length !== 5) return false;
    for (let i = 0; i < 4; i++) {
        const a = answers[i] as { kind: string; noul?: number };
        if (a.kind !== "noul" || !Number.isFinite(a.noul)) return false;
    }
    const s = answers[4] as { kind: string; score?: number };
    return s.kind === "score" && Number.isFinite(s.score);
}

/**
 * 一批题目的五项判定（**一次请求**）。
 *
 * 返回空报告的情形（一律「回落现状」，不抛错、不弹窗）：
 *  - 无 key / 无题目（没东西可判）；
 *  - `judgeJev` 抛错（401/403 key 问题、429/529 退避后仍败、网络、
 *    响应形状不对）——调用方不必 try/catch；
 *  - 判定响应缺值（问了 noul 却没回概率等）：按位取值会读成 `NaN`，
 *    静默落进「不确定」存疑是**假归因**，故整批弃掉（宁可漏报不误报）。
 */
export async function checkBatch(opts: CheckBatchOpts): Promise<JevQcReport> {
    const empty: JevQcReport = { checked: 0, suspects: [] };
    const key = (opts.apiKey ?? "").trim();
    if (!key) return empty;
    const questions = opts.drafts.filter((d) => !d.material);
    if (questions.length === 0) return empty; // 只出材料的批没有题可判
    const state = buildCheckState(opts.drafts, opts.materialText);
    if (!state.trim()) return empty;

    let answers: JevAnswer[];
    try {
        answers = await judgeJev({
            state,
            questions: buildQuestions(),
            apiKey: key,
            ...(opts.transport ? { transport: opts.transport } : {}),
            ...(opts.sleep ? { sleep: opts.sleep } : {}),
            ...(opts.track ? { track: opts.track } : {}),
        });
    } catch (_) {
        return empty; // 判定失败 = 跳过（不阻塞转换主流程）
    }
    if (!answersUsable(answers)) return empty;

    // 不点名具体题目：五项是对**整片**的判定，而 Jev 的回答只到「这片有没有
    // 这个毛病」，把它摊到某一题上是假装精确（假归因），只给整片结论。
    // 「明确踩雷」与「不确定」都只标不删（规划稿 §二 纪律 2）。
    const suspects: JevQcSuspect[] = [];
    const body = (): JevQcReport => ({ checked: questions.length, suspects });
    const push = (reason: JevQcReason, a: JevAnswer | undefined): void => {
        const p = (a as { noul?: number } | undefined)?.noul;
        const v = noulVerdict(p);
        if (v !== "yes") suspects.push({ reason, clear: v === "no", items: [] });
    };
    push(K_UNIQUE, answers[0]);
    push(K_DERIVE, answers[1]);
    push(K_RELEVANT, answers[2]);
    push(K_TYPE, answers[3]);
    const score = answers[4] as { score: number; confidence: number };
    if (scoreLowConfidence(score.confidence)) {
        // 质量分置信不足：不可用时按「不确定」存疑，**绝不按分值下结论**
        suspects.push({ reason: K_QUALITY, clear: false, items: [] });
    } else if (score.score <= 2) {
        suspects.push({ reason: K_QUALITY, clear: true, items: [] });
    }
    return body();
}

/**
 * 增量链的存疑汇总（**与整卷报告同一套文案**：`qcSummary` 是唯一组装点）。
 *
 * 把逐块报告并成一份：判定题数累加、存疑项去重（同一毛病在多块出现，
 * 只说一次）。无存疑时给 `null`（**增量链零 Jev 痕迹**是硬口径：没 key /
 * 没踩雷的两条路径，用户看到的文案必须与改造前逐字一致）。
 */
export function chunkQcSummary(t: (k: string) => string, sum: JevQcChunkSummary): string | null {
    const suspects = sum.reports.flatMap((c) => c.report.suspects);
    if (dedupeSuspects(suspects).length === 0) return null;
    return qcSummary(t, { checked: sum.checkedChunks, suspects });
}
