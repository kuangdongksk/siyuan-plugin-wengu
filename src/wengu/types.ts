/**
 * 温故题目类型与题目对象的结构定义。
 *
 * 与 docs/question-block-contract.md 一一对应。字段 kebab 即属性名，
 * 通过 attrs.ts -> kebab 转换与自定义属性互转。
 */

/** 题型：前四类自动判分，brief（大题）走自评。 */
export enum QuestionType {
    /** 单选 */
    Single = "single",
    /** 多选 */
    Multiple = "multiple",
    /** 判断 */
    Judge = "judge",
    /** 填空 */
    Fill = "fill",
    /** 简答/计算（大题，自评） */
    Brief = "brief",
}

/** 客观题类型 = 可自动判分；brief 除外。 */
export const AUTO_GRADE_TYPES: readonly QuestionType[] = [
    QuestionType.Single,
    QuestionType.Multiple,
    QuestionType.Judge,
    QuestionType.Fill,
];

/** 一道题在插件侧的结构化视图（由容器超级块属性 + 子块文本拼装）。 */
export interface WenguQuestion {
    /** 容器超级块 id。 */
    id: string;
    /** 所属文档 id。 */
    rootId?: string;
    /** 题型。 */
    type?: QuestionType;
    /** 正确答案文本（从 part="answer" 子块取，客观题判分原料）。 */
    answer?: string;
    /** 知识点/考点名。 */
    knowledge?: string;
    /** 章节名。 */
    chapter?: string;
    /** 难度 1~5。 */
    difficulty?: number;
    /** 真题来源。 */
    source?: string;
    /** 刷题次数。 */
    attempts: number;
    /** 最近一次我的答案。 */
    lastAnswer?: string;
    /** 最近一次正误：0/1/空。 */
    right?: "0" | "1";
    /** 题干子块 markdown（part="stem"，供 Lute 渲染）。 */
    stemMd?: string;
    /** 选项子块 markdown（part="option-*"，供 Lute 渲染），按序。 */
    optionMd?: string[];
    /** 解析子块 markdown（part="solution"，判分后展示）。 */
    solutionMd?: string;
}

/** 难度取值为合法星数。 */
export function parseDifficulty(raw?: string): number | undefined {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined;
}