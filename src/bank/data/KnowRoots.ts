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
