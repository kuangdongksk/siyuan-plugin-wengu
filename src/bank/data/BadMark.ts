import type { BankData, BankRecord, QuestionBank } from "./QuestionBank";

/**
 * 「标记为错题」（Issue #46）——预览模式浏览 AI 题卷时把生成质量差的题
 * 记下来、之后一键批量重转。**语义是「这道题本身出错了」，不是错题本
 * 那个「作答错误」**（文案/title 必须区分）。
 *
 * 存储口径照搬题库 optional 字段既有同款：字段只加不改名、不 bump
 * version、不写 kramdown、**不动 questionHash**（数据演进守则冻结清单零
 * 触碰）；装载 backfill = undefined 即未标记，对无新字段的存量记录零影响。
 * `replaceRecordKramdown`（重转原题位回写）不动此字段——qid 不变，
 * 标记天然跟随。
 *
 * **两条读取通道分开**：渲染期（卡头初态/头部徽标）走同步快照
 * `badMarkedSet(peek())`——渲染路径不许 await 查库（与 AnnoScopeCtl
 * 同款口径，SideMount 也是同步读快照）；批量重转的收集走异步
 * `badMarkedQids(bank)`（跨卷全库，落库前后一致性由它保证）。
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

/** 批量取消标记（**只对清单里的 qid 生效**）：批量重转后仅清「真正重转
 *  成功」的那批——失败的/被中止的/防重入跳过的一律保留，用户可再转。
 *  返回真清掉的条数。 */
export async function unmarkMany(bank: QuestionBank, qids: string[]): Promise<number> {
    let n = 0;
    for (const qid of qids) if (await unmarkBad(bank, qid)) n++;
    return n;
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

/** 标记题 qid 集合（**同步快照读**，入参 `bank.peek()`）：渲染期给卡头
 *  标记钮回灌初态用。未装载（peek=undefined）返回空集=全部未标记。 */
export function badMarkedSet(data: BankData | undefined): Set<string> {
    const out = new Set<string>();
    if (!data) return out;
    for (const r of Object.values(data.records)) if (r.badMark === "1") out.add(r.qid);
    return out;
}

/** 标记总数（**同步快照读**；头部徽标用，0=不出钮）。 */
export function badMarkCount(data: BankData | undefined): number {
    return badMarkedSet(data).size;
}

/** 取记录（无则 undefined；不落缓存副作用）。 */
async function recordOrUndefined(bank: QuestionBank, qid: string): Promise<BankRecord | undefined> {
    if (!qid) return undefined;
    const data = await bank.all();
    return data.records[qid];
}
