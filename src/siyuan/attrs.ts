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
    /** 题型：single/multiple/judge/fill/brief/steps/cloze/match/essay/trans。 */
    type: `${PREFIX}type`,
    /** steps 题：步骤类型声明，按序竖线分隔，如 "method|result|result"。 */
    steps: `${PREFIX}steps`,
    /** 材料块标记（值恒为 "1"）：阅读/完形等共享原文的超级块。 */
    material: `${PREFIX}material`,
    /** 小题块：所属材料块 id（转换先写 "prev" 占位，装载时解析回写）。 */
    group: `${PREFIX}group`,
    /** 运行时（slots 题：cloze/match，E2 启用）：逐空最近正误。 */
    slotRight: `${PREFIX}slot-right`,
    /** 运行时（slots 题）：逐空最近作答（字母按空序竖线分隔）。 */
    slotLast: `${PREFIX}slot-last`,
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
    /** 运行时：累计答错次数（整数，答错 +1、答对不清零）。 */
    wrongCount: `${PREFIX}wrong-count`,
    /** 运行时：最近一次我的答案。 */
    lastAnswer: `${PREFIX}last-answer`,
    /** 运行时：最近一次正误，0/1/空。 */
    right: `${PREFIX}right`,
    /** 运行时（steps 题）：逐步最近正误（"1010"，与 steps 属性对齐）。 */
    stepRight: `${PREFIX}step-right`,
    /** 运行时（steps 题）：逐步最近作答（字母按步竖线分隔，如 "A|B"）。 */
    stepLast: `${PREFIX}step-last`,
    /** 运行时（文档级）：累计刷题用时（秒），打在习题文档块上。 */
    totalTime: `${PREFIX}total-time`,
    /** 转换配对（文档级）：习题文档根块记源讲义文档 id；源删则习题随删（OrphanCleaner）。 */
    sourceDoc: `${PREFIX}source-doc`,
    /** 子块定位：值为 "answer" 表示该子块是解析侧（闪卡卡背）。 */
    part: `${PREFIX}part`,
} as const;

/** 转换完成标记的固定值。 */
export const Q_FLAG = "1";

/** 材料块标记的固定值。 */
export const MATERIAL_FLAG = "1";

/** group 占位值：材料=文中紧邻其前的材料块（AI 写不出内核分配的
 *  真实块 id，落盘后由 MaterialService 按文档序解析回写）。 */
export const GROUP_PREV = "prev";
