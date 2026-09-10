import { SINGLE_Q_NOTE } from "./common";
import { protocolSpec } from "./protocol";

/**
 * 单题生成族 prompt（20260910 自 bank 域 GenQuestion/RegenDialog/TagDialog
 * 迁入 prompt 集中地，文本逐字保持）：概念辨析出题、变式出题、生成后
 * AI 自检验算、单题修复重生成、无知识文档时的自由标签生成。
 */

/** 概念辨析出题 prompt（薄弱加练/收集补题 concept 模式）。 */
export function conceptPrompt(title: string, statLine: string, section: string): string {
    return `你是考研刷题的概念辨析出题助手。依据知识点小节出一道概念/辨析题（单选或判断）。
要求：只考概念辨析（不考计算）；干扰项来自常见误解；正确答案与解析自洽。
${SINGLE_Q_NOTE}
${protocolSpec()}

【知识点：${title}${statLine}】
${section}`;
}

/** 变式出题 prompt（知识点变式/按题变式重练共用，模板=原题 kramdown）。 */
export function variantPrompt(template: string, statLine: string): string {
    return `你是考研刷题的变式出题助手。以原题为模板，改数字/换条件/反向提问出一道同知识点的变式题。
要求：结构、题型与原题一致；新数据必须凑巧（答案干净可验算）；正确答案与解析自洽完整。
${SINGLE_Q_NOTE}
${protocolSpec()}

【原题${statLine}】
${template}`;
}

/** 生成后自检 prompt（独立重做校验答案，不过检由调用方丢弃）。 */
export function verifyPrompt(kd: string): string {
    return `你是解题验算助手。独立解下面的题，再与题内给出的答案比对。只输出一行：
VERIFY: yes 或 no（答案与解析自洽为 yes；算不平/矛盾为 no）

${kd}`;
}

/** 单题修复重生成 prompt（题卡「重新生成」：OCR 缺失/转换错误/答案算错）。
 *  材料三选一：原文块 kramdown > 知识点小节正文 > 无材料保守修复。 */
export function buildRegenPrompt(kd: string, sourceBlock: string, section: string, note: string): string {
    const srcPart = sourceBlock ? `\n【修正后的原文（以此为准，插图占位还原成图片行进题干）】\n${sourceBlock}` : "";
    const secPart = !sourceBlock && section ? `\n【相关知识点小节（补全缺失数据的依据）】\n${section}` : "";
    const notePart = note ? `\n【用户备注】\n${note}` : "";
    return `你是思源笔记的题目修复助手。下面这道题存在问题（OCR 缺失/转换错误/答案算错），请重出这一道题。
${srcPart || secPart ? "以补充材料为准修正；没有依据的部分不要编造，宁可保守。" : "依据题目自身与解析保守修复。"}${notePart}
要求：输出与原题相同的题型结构（客观题保持客观题）；公式行内 $...$、块级 $$...$$；题干依赖的插图以「〔插图:assets/…〕」占位出现时，必须还原成标准 markdown 图片行（半角 ! + 空方括号 + 冒号后完整原路径，示意形如 ![](插图原路径)）逐字保留进题干，不要原样输出占位；正确答案与解析必须自洽。
${SINGLE_Q_NOTE}
${protocolSpec()}

【原题 kramdown】
${kd}${srcPart}${secPart}${notePart}`;
}

/** 自由标签生成 prompt（无知识文档时的整批生成：编号题干节选 → 编号|标签行）。 */
export function freeTagPrompt(list: string): string {
    return `你是刷题库的知识点标注器。下面是编号题目的题干节选。给每道题标一个最贴切的知识点标签：不超过 12 字、沿用题目原文的术语、不造新词、不同题可以同标签。
输出格式（每题一行，格式之外不要输出任何文字；没有合适标签的题输出 编号|-）：
1|标签
2|标签

题目：
${list}`;
}
