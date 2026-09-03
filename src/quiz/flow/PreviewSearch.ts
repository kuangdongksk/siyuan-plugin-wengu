import type { WenguQuestion } from "../../types";

/**
 * 预览搜题的纯匹配逻辑（DOM 显隐与定位在 PreviewFlow）：按关键词搜
 * 题目的内容字段——题干/选项/答案/解析 + 知识点/章节/来源，原始
 * markdown 口径（LaTeX 源码可搜），大小写不敏感；空词全命中。
 */

/** 单题是否命中（空词/纯空白=全命中）。 */
export function questionMatches(q: WenguQuestion, term: string): boolean {
    const needle = term.trim().toLowerCase();
    if (!needle) return true;
    return haystackOf(q).includes(needle);
}

/** 命中题目的整卷下标序列（与题号 data-idx 对齐，过滤/定位共用）。 */
export function matchIndices(list: WenguQuestion[], term: string): number[] {
    const hits: number[] = [];
    for (const [i, q] of list.entries()) {
        if (questionMatches(q, term)) hits.push(i);
    }
    return hits;
}

/** 可搜字段拼一篇（缺席字段跳过），统一小写比 contains。 */
function haystackOf(q: WenguQuestion): string {
    return [
        q.stemMd,
        q.answer,
        q.solutionMd,
        q.knowledge,
        q.chapter,
        q.source,
        ...(q.optionMd ?? []),
        ...(q.steps ?? []).flatMap((s) => [s.stemMd, s.answer, ...s.optionMd]),
        ...(q.slots ?? []).flatMap((s) => [s.answer, ...s.optionMd]),
    ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
}
