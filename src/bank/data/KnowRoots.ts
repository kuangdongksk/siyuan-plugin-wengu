import type { QuestionBank } from "./QuestionBank";

/**
 * 知识文档登记（知识面板手动导入，2026-08-27）：存 BankData.knowRoots，
 * 只入册展示不建题目；QuestionBank 超 500 行拆出的友元模块（all/
 * markDirty 公开，同 BankReconcile 访问方式）。移除登记不影响题目上
 * 已有的知识引用（推导行仍在）。
 */

/** 已登记的知识文档根 id（顺序保持登记序）。 */
export async function knowRootsOf(bank: QuestionBank): Promise<string[]> {
    return [...(await bank.all()).knowRoots];
}

/** 覆写登记清单（选择器多选「确定」的语义：勾选即全量）。 */
export async function setKnowRoots(bank: QuestionBank, ids: string[]): Promise<void> {
    const data = await bank.all();
    data.knowRoots = [...new Set(ids)];
    bank.markDirty();
}

/** 单个移除登记（只退册）。 */
export async function removeKnowRoot(bank: QuestionBank, id: string): Promise<void> {
    const data = await bank.all();
    data.knowRoots = data.knowRoots.filter((x) => x !== id);
    bank.markDirty();
}

/** 匹配面板把新挂的知识引用并入题库记录（按 id 去重保序；kramdown 由
 *  replaceRecordKramdown 先行更新，这里同步 kpRefs 供面板计数/反查）。 */
export async function mergeRecordKpRefs(
    bank: QuestionBank,
    qid: string,
    refs: { id: string; title: string }[]
): Promise<void> {
    if (refs.length === 0) return;
    const data = await bank.all();
    const r = data.records[qid];
    if (!r) return;
    const seen = new Set(r.kpRefs.map((k) => k.id));
    const add = refs.filter((x) => !seen.has(x.id));
    if (add.length === 0) return;
    r.kpRefs.push(...add);
    bank.markDirty();
}
