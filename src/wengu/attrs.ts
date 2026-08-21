/**
 * 温故题目块契约的自定义属性常量。
 *
 * 权威来源见 docs/question-block-contract.md。
 * 思源自定义属性统一加前缀 `custom-plugin-wengu-`（与官方约定一致），
 * 内核侧存于 attributes 表，属性视图与 /api/query/sql 均可直接使用。
 */

const PREFIX = "custom-plugin-wengu-";

/** 自定义属性统一前缀。 */
export const ATTR_PREFIX = PREFIX;

/** 属性名常量（key 即属性名去掉前缀后的部分）。 */
export const Attr = {
    /** 转换完成标记，值恒为 "1"；存在则该题进入刷题模式可抽取。 */
    q: `${PREFIX}q`,
    /** 题型：single | multiple | judge | fill | brief。 */
    type: `${PREFIX}type`,
    /** 正确答案字符串（客观题自动判分依据；brief 留空走自评）。 */
    answer: `${PREFIX}answer`,
    /** 知识点/考点名，用于分组抽题与错题归类。 */
    knowledge: `${PREFIX}knowledge`,
    /** 章节名，用于分组抽题。 */
    chapter: `${PREFIX}chapter`,
    /** 难度 1~5 星。 */
    difficulty: `${PREFIX}difficulty`,
    /** 真题来源，如 "2025年东华大学"。 */
    source: `${PREFIX}source`,
    /** 运行时：刷题次数（整数）。 */
    attempts: `${PREFIX}attempts`,
    /** 运行时：最近一次我的答案。 */
    lastAnswer: `${PREFIX}last-answer`,
    /** 运行时：最近一次正误，0/1/空。 */
    right: `${PREFIX}right`,
    /** 子块定位：值为 "answer" 表示该子块是解析侧（闪卡卡背）。 */
    part: `${PREFIX}part`,
} as const;

/** 转换完成标记的固定值。 */
export const Q_FLAG = "1";