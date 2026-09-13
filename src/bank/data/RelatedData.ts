import type { WeakPointEntry } from "./WeaknessStore";
import type { BankRecord } from "./QuestionBank";

/**
 * 相关题弹窗的纯数据层（Issue #44）：收集口径在 RelatedQids，这里放
 * 「弹窗动作」侧的纯逻辑——分析材料（薄弱摘要、聚合键、小节引用）与
 * 「零作答」判据。不碰 DOM/内核/AI，单测直接喂数据。
 */

/** 相关题弹窗的列表行（列表渲染、四个动作、AI 分析共用一份数据）。 */
export interface RelatedRow {
    qid: string;
    stem: string;
    attempts: number;
    wrongCount: number;
    /** 该题的知识点引用块 id（分析材料取小节正文用；无引用=空）。 */
    kpIds: string[];
    /** 该题的聚合键（kp:/kn:/ch:，WeaknessStore.weakKeys 同一口径）。 */
    weakKeys: string[];
}

/** 薄弱摘要行（WeaknessStore 命中项的精简形态，喂 prompt 用）。 */
export interface RelatedWeakLine {
    title: string;
    wrong: number;
    total: number;
    topCause?: string;
    aiNote?: string;
}

/** 一条题库记录 → 分析用键（kpRefs 优先；缺则 knowledge 的 kn: / chapter
 *  的 ch:——与 WeaknessStore.weakKeys 同口径，只吃记录侧字段）。 */
export function recordKeysOf(r: BankRecord | undefined): { kpIds: string[]; weakKeys: string[] } {
    if (!r) return { kpIds: [], weakKeys: [] }; // 记录已删（列表与读库之间同步）：键按空收口
    const kpIds = r.kpRefs.map((k) => k.id);
    if (kpIds.length > 0) return { kpIds, weakKeys: kpIds.map((id) => `kp:${id}`) };
    if (r.knowledge) return { kpIds, weakKeys: [`kn:${r.knowledge}`] };
    if (r.chapter) return { kpIds, weakKeys: [`ch:${r.chapter}`] };
    return { kpIds, weakKeys: [] };
}

/** 这组相关题是否有任何作答记录（attempts 全 0 = 从未做过）。
 *  AI 分析据此决定「如实说明尚无作答数据」，禁止编造薄弱点。 */
export function hasAnswerData(rows: Pick<RelatedRow, "attempts">[]): boolean {
    return rows.some((r) => r.attempts > 0);
}

/** 全部聚合键并集（薄弱摘要过滤用）。 */
export function weakKeysOf(rows: Pick<RelatedRow, "weakKeys">[]): string[] {
    const out = new Set<string>();
    for (const r of rows) for (const k of r.weakKeys) out.add(k);
    return [...out];
}

/** 全部分析用小节 id 并集（按出现序去重，取正文用）。 */
export function kpIdsOf(rows: Pick<RelatedRow, "kpIds">[]): string[] {
    const out = new Set<string>();
    for (const r of rows) for (const id of r.kpIds) out.add(id);
    return [...out];
}

/**
 * 薄弱摘要：从全部薄弱点里挑出「命中这组题的键」的条目。
 * - 排序 = 错次降序（与 WeaknessStore.snapshot 同口径）；
 * - 零命中 → 空数组（调用方据此省略 prompt 该段）。
 */
export function weakLinesOf(points: Iterable<WeakPointEntry>, keys: Iterable<string>, limit = 12): RelatedWeakLine[] {
    const wanted = new Set(keys);
    const out: RelatedWeakLine[] = [];
    for (const e of points) {
        if (!wanted.has(e.key) || e.wrong <= 0) continue;
        const topCause = Object.entries(e.causes ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
        out.push({
            title: e.title,
            wrong: e.wrong,
            total: e.total,
            ...(topCause ? { topCause } : {}),
            ...(e.aiNote ? { aiNote: e.aiNote } : {}),
        });
    }
    return out.sort((a, b) => b.wrong - a.wrong).slice(0, limit);
}

/** 相关题 qid 集（错题本「回顾」的 qidFilter 用；纯集合运算便于断言）。 */
export function qidSetOf(rows: Pick<RelatedRow, "qid">[]): Set<string> {
    return new Set(rows.map((r) => r.qid));
}
