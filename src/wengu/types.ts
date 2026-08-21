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

/** 一道题在插件侧的结构化视图（由块自定义属性 + 块基本信息拼装）。 */
export interface WenguQuestion {
    /** 容器块 id。 */
    id: string;
    /** 所属文档 id。 */
    rootId?: string;
    /** 题型。 */
    type?: QuestionType;
    /** 正确答案（客观题）。 */
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
}

/** 难度取值为合法星数。 */
export function parseDifficulty(raw?: string): number | undefined {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined;
}