import type { BankRecord, QuestionBank } from "./QuestionBank";

/**
 * 「标记为错题」（Issue #46）——预览模式浏览 AI 题卷时把生成质量差的题
 * 记下来、之后一键批量重转。**语义是「这道题本身出错了」，不是错题本
 * 那个「作答错误」**（文案/title 必须区分）。
 *
 * 存储口径照抄 `srcStale?: "1"`：字段只加不改名、不 bump version、不写
 * kramdown、**不动 questionHash**（数据演进守则冻结清单零触碰）；装载
 * backfill = undefined 即未标记，对无新字段的存量记录零影响。
 * `replaceRecordKramdown`（重转原题位回写）不动此字段——qid 不变，
 * 标记天然跟随。
 */

/** 标记一题（幂等；落盘走 markDirty 防抖）。 */
export async function markBad(bank: QuestionBank, qid: string, on = true): Promise<boolean> {
    const r = await recordOrUndefined(bank, qid);
    if (!r) return false;
    if (on ? r.badMark === "1" : r.badMark === undefined) return false; // 无变化不惊动落盘
    if (on) r.badMark = "1";
    else delete r.badMark;
    bank.markDirty();
    return true;
}

/** 取消标记（等价 markBad(bank, qid, false)）。 */
export function unmarkBad(bank: QuestionBank, qid: string): Promise<boolean> {
    return markBad(bank, qid, false);
}

/** 单题是否已标记。 */
export async function isBadMarked(bank: QuestionBank, qid: string): Promise<boolean> {
    return (await recordOrUndefined(bank, qid))?.badMark === "1";
}

/** 全库标记题的 qid 清单（跨卷全局收集，按题集/题序稳定排序——
 *  批量重转的次序可预期，逐题串行照此推进）。 */
export async function badMarkedQids(bank: QuestionBank): Promise<string[]> {
    const data = await bank.all();
    return Object.values(data.records)
        .filter((r) => r.badMark === "1")
        .sort((a, b) =>
            a.sourceDocId === b.sourceDocId ? a.qid.localeCompare(b.qid) : a.sourceDocId.localeCompare(b.sourceDocId)
        )
        .map((r) => r.qid);
}

/** 标记总数（头部徽标用；未装载题库返回 0=不显示）。 */
export async function badMarkCount(bank: QuestionBank | undefined): Promise<number> {
    if (!bank) return 0;
    const data = await bank.all();
    return Object.values(data.records).filter((r) => r.badMark === "1").length;
}

/** 取记录（无则 undefined；不落缓存副作用）。 */
async function recordOrUndefined(bank: QuestionBank, qid: string): Promise<BankRecord | undefined> {
    if (!qid) return undefined;
    const data = await bank.all();
    return data.records[qid];
}
