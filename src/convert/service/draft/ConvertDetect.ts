import type { QuestionType } from "../../../types";
import { normalizeType } from "../../../types";
import { isMaterialKramdown } from "../core/ConvertService";

/**
 * 转换的判定/预览纯解析。
 *
 * 20260910 起**独立前置检测已退役**：原来 detectQuestions 要把全文按 12k
 * 分段并行问 AI「能否出题 + 现成题数 + 题型」，现在判定与题型先验合并进
 * 首批逐段生成的回复（见 ConvertBatch + prompts/convert 的 StepContext），
 * 少一整轮 AI 调用；`detectWindowPrompt`/`parseCount` 随之删除。
 *
 * 本模块只留两件纯解析：
 * - parseTypes：从回复抽 TYPES 行（题型先验喂生成 prompt 的题型化裁剪）；
 * - questionPreview：从题目 kramdown 抽预览行（弹窗渐进展示）。
 */

/** 从回复取 TYPES 题型（normalizeType 容错中英别名；无 TYPES 行/全部
 *  无法识别返回空数组）。 */
export function parseTypes(reply: string): QuestionType[] {
    const m = /TYPES\s*[:：]\s*([^\n]+)/i.exec(reply);
    if (!m) return [];
    const out: QuestionType[] = [];
    for (const tok of m[1].split(/[\s,，、;；/|]+/)) {
        const t = normalizeType(tok);
        if (t && !out.includes(t)) out.push(t);
    }
    return out;
}

/** 弹窗预览行：题号 + 题型 + 题干片段。 */
export interface QuestionPreview {
    no: number;
    type: string;
    stem: string;
}

/** 从题目 kramdown 抽预览：题型属性 + 去标记后的题干开头（截 80 字）。
 *  材料块无 type 属性，type 记为 "material"（弹窗按 typeMaterial 标签展示）。 */
export function questionPreview(kd: string, no: number): QuestionPreview {
    const type = isMaterialKramdown(kd) ? "material" : (/custom-plugin-wengu-type="([a-z]+)"/.exec(kd)?.[1] ?? "");
    const stem = kd
        .split(/\r?\n/)
        .filter(
            (l) =>
                !/^\s*\{:/.test(l) && // IAL 属性行
                !/^\s*\{\{\{/.test(l) && // 超级块定界
                !/^\s*\}\}\}/.test(l) &&
                !/^\s*>/.test(l) && // 答案/解析引述
                !/^\s*[-*]\s/.test(l) // 选项列表
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    return { no, type, stem: stem.slice(0, 80) };
}
