import type { BankRecord } from "./QuestionBank";

/**
 * 相关题收集口径（Issue #44）：**「某知识文档的相关题」只有这一份判据**——
 * 弹窗列表（RelatedDialog）与 related 活视图专题题单（LiveCols）共用本
 * 函数的输出，两者永远一致；题库后续变化读取时自动回流（活视图读取时
 * 重算）。
 *
 * 命中判据两条（并集）：
 * - `sourceDocId` 命中（由该文档转换/题目直接挂它名下——**无 kpRefs 的
 *   题也在此列**，是相关题与「按知识点收集」口径的关键差异）；
 * - `kpRefs` 里任一引用块落在该文档下（kpRoots：kp 块 id → 所在文档 id）。
 *
 * 纯函数：只吃记录表与根映射，不碰内核、不落盘（单测直接喂数据）。
 */
export function relatedRecordsOf(
    records: Iterable<BankRecord>,
    docId: string,
    kpRoots: Map<string, string>
): BankRecord[] {
    if (!docId) return [];
    const out: BankRecord[] = [];
    for (const r of records) {
        if (r.sourceDocId === docId || r.kpRefs.some((k) => kpRoots.get(k.id) === docId)) out.push(r);
    }
    return out;
}

/** 相关题 qid 序：与相关题列表同源同序（题集先后 × 集内 qid 序），
 *  活视图专题题单直接用（**不排序**——排序会让专题题单与列表错位）。 */
export function relatedQidsOf(records: Iterable<BankRecord>, docId: string, kpRoots: Map<string, string>): string[] {
    return relatedRecordsOf(records, docId, kpRoots).map((r) => r.qid);
}
