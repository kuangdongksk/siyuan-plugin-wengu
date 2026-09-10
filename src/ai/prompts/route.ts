/**
 * 知识点路由族 prompt（20260910 自 convert/service/knowledge/KnowledgeLink 迁入
 * prompt 集中地，文本逐字保持）：两级路由（章清单 → 小节清单）的
 * 单批/批量四个变体，与生成 prompt 的知识点标注插槽。
 *
 * MAX_HIT_CHAPTERS/MAX_SECTIONS 同时是 prompt 文本里的「最多 N 个」
 * 与路由逻辑的结果截断上限——两边必须同值，故随 prompt 落在这里、
 * 由 KnowledgeLink 反向引用。
 */

/** 单批最多命中章 / 供生成标注的小节数。 */
export const MAX_HIT_CHAPTERS = 4;
export const MAX_SECTIONS = 10;

/** 章级单批路由 prompt（一批题 → 一个编号集合）。 */
export function chapterRoutePrompt(chunk: string, list: string): string {
    return `你是思源笔记的知识点路由器。下面是题目原文和章节清单（编号|路径）。
判断这批题目考查的内容涉及哪些章节，只输出 JSON，格式之外不要输出任何文字：
{"chapters":[编号,编号]}
规则：只输出清单里存在的编号，最多 ${MAX_HIT_CHAPTERS} 个，按相关度降序；没有合适的输出 {"chapters":[]}。

章节清单：
${list}

题目原文：
${chunk}`;
}

/** 小节级单批路由 prompt（一批题 → 一个编号集合，清单已剥公共前缀）。 */
export function sectionRoutePrompt(chunk: string, listTitle: string, list2: string): string {
    return `你是思源笔记的知识点路由器。下面是题目原文和${listTitle}。
判断这批题目考查的具体知识点对应哪些小节，只输出 JSON，格式之外不要输出任何文字：
{"sections":[编号,编号]}
规则：只输出清单里存在的编号，最多 ${MAX_SECTIONS} 个，按相关度降序；没有合适的输出 {"sections":[]}。

${listTitle}：
${list2}

题目原文：
${chunk}`;
}

/** 批量章级路由 prompt：编号题目 + 章节清单，要求按题号返回逐题数组。 */
export function batchChapterPrompt(chunks: string[], list: string): string {
    const qs = chunks.map((c, i) => `${i + 1}|${c}`).join("\n");
    return `你是思源笔记的知识点路由器。下面是题目原文和章节清单（编号|路径）。
判断下面每道题目考查的内容涉及哪些章节，只输出 JSON，格式之外不要输出任何文字：
{"chapters":[[编号,编号],[编号,编号]]}
规则：chapters 是数组，第 i 个元素对应第 i 道题（题目按编号 1,2,... 排列）；每道题只输出清单里存在的编号，最多 ${MAX_HIT_CHAPTERS} 个，按相关度降序；没有合适的输出 []。

章节清单：
${list}

题目原文：
${qs}`;
}

/** 批量小节级路由 prompt：编号题目 + 共享小节清单，要求按题号返回逐题数组。 */
export function batchSectionPrompt(chunks: string[], listTitle: string, list2: string): string {
    const qs = chunks.map((c, i) => `${i + 1}|${c}`).join("\n");
    return `你是思源笔记的知识点路由器。下面是题目原文和${listTitle}。
判断下面每道题目考查的具体知识点对应哪些小节，只输出 JSON，格式之外不要输出任何文字：
{"sections":[[编号,编号],[编号,编号]]}
规则：sections 是数组，第 i 个元素对应第 i 道题（题目按编号 1,2,... 排列）；每道题只输出清单里存在的编号，最多 ${MAX_SECTIONS} 个，按相关度降序；没有合适的输出 []。

${listTitle}：
${list2}

题目原文：
${qs}`;
}

/** 生成 prompt 的知识点标注规则（仅在路由出小节时追加；20260902 起
 *  标注挂在 @@Q 行 know= 上，渲染时由代码解析成真实引用并入解析块）。 */
export function knowRule(): string {
    return `
知识点标注：文末「知识点清单」列出本批内容可能涉及的知识点（K 编号）。每道题按考查内容在 @@Q 行末尾追加 know="K1,K3"（1~3 个最相关编号，逗号分隔；只能用清单里的编号，不得编造；没有合适的不加）。`;
}

/** 生成 prompt 文末的知识点清单（K 别号 → 展示路径；结构类型收窄，
 *  KnowledgeLink 的 KnowSection 天然可赋值）。 */
export function knowListBlock(map: Map<string, { path: string }>): string {
    const lines = [...map.entries()].map(([k, s]) => `${k}|${s.path}`);
    return `

知识点清单（供知识点标注规则用）：
${lines.join("\n")}`;
}
