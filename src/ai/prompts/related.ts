import type { RelatedRow, RelatedWeakLine } from "../../bank/data/RelatedData";

/**
 * 相关题 AI 分析 prompt（Issue #44）：知识文档小节正文 + 相关题清单
 * + 薄弱摘要，三路材料按预算拼装，输出一段可渲染 markdown 的学情分析。
 * 与 misc 家族同性质（单场景自由文本），故落这里而不是 protocol 行协议。
 */

/** 单段材料字符预算（小节正文；题清单/薄弱段各自另有截断）。 */
export const RELATED_SECTION_CHARS = 3000;
/** 相关题清单最多列几题（弹窗列表可滚动，喂 AI 的只取前 N）。 */
export const RELATED_LIST_MAX = 30;

/** 题目摘要行（题号 + 题干摘要 + 作答统计）。 */
function rowLine(r: RelatedRow, i: number): string {
    const stat = r.attempts > 0 ? `做过 ${r.attempts} 次、错 ${r.wrongCount} 次` : "从未作答";
    return `${i + 1}. ${r.stem || r.qid}（${stat}）`;
}

/** 薄弱摘要行（错因/批注仅在存在时拼）。 */
function weakLine(w: RelatedWeakLine): string {
    const bits = [`错 ${w.wrong} / 做 ${w.total}`];
    if (w.topCause) bits.push(`主要错因：${w.topCause}`);
    if (w.aiNote) bits.push(`批注：${w.aiNote}`);
    return `- ${w.title}（${bits.join("；")}）`;
}

/**
 * 相关题分析 prompt。三段材料：
 * - 考点内容与解题方法：来源文档的小节正文（查不到时空段，措辞降级）；
 * - 相关题清单：题干摘要 + attempts/wrongCount；
 * - 薄弱点：仅当有作答数据且命中薄弱条目时出现——**零作答数据时整段
 *   省略，并在要求里明确「尚无作答数据」要如实说明、不得编造**。
 */
export function relatedAnalysisPrompt(input: {
    docTitle: string;
    section: string;
    rows: RelatedRow[];
    weak: RelatedWeakLine[];
    hasData: boolean;
}): string {
    const list = input.rows.slice(0, RELATED_LIST_MAX).map(rowLine).join("\n") || "（该文档暂无相关题）";
    const sec = input.section.trim()
        ? `\n【考点内容与解题方法】\n${input.section.slice(0, RELATED_SECTION_CHARS)}`
        : "";
    const weak =
        input.weak.length > 0 ? `\n【薄弱点（来自历史作答沉淀）】\n${input.weak.map(weakLine).join("\n")}` : "";
    // 两条警示互斥：连相关题都没有时不谈作答数据（谈不着），只说清
    // 「暂无相关题」；有题但全没做过时才是「尚无作答数据」
    const noRows = input.rows.length === 0;
    const noData =
        noRows || input.hasData
            ? ""
            : "\n⚠️ 这组题**尚无作答数据**（全部未作答），只能基于考点与题目本身给学习建议；必须如实说明「尚无作答数据」，严禁编造错题、错因或掌握度结论。";
    const noRowsNote = noRows ? "\n⚠️ 该文档**暂无相关题**，只围绕考点给复习方向，不要虚构题目。\n" : "";
    return `你是考研刷题的学情分析助手。围绕一份知识文档给出针对性的复习分析。
要求：分三段（考点与解题方法要点；相关题里值得注意的题与易错处；下一步复习与训练建议）；用 markdown，不超过 500 字；只依据下面给出的材料，不要引入材料里没有的题目或数据。${noData}

【知识文档】${input.docTitle}

${noRowsNote}【相关题清单（共 ${input.rows.length} 题）】
${list}${sec}${weak}`;
}
