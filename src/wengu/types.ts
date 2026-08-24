/**
 * 温故题目类型与题目对象的结构定义。
 *
 * 与 docs/question-block-contract.md 一一对应。字段 kebab 即属性名，
 * 通过 attrs.ts -> kebab 转换与自定义属性互转。
 */

/** 题型：前四类自动判分，brief（大题）AI 判分+自评改判，steps 走多步引导；
 * 英语四类（E0 契约先行）：cloze/match 逐空判分待 E2 交互（先走自评降级），
 * essay/trans 走 brief 同款 AI 判分。 */
export enum QuestionType {
    /** 单选 */
    Single = "single",
    /** 多选 */
    Multiple = "multiple",
    /** 判断 */
    Judge = "judge",
    /** 填空 */
    Fill = "fill",
    /** 简答/计算（大题，AI 判分并计入，可自评改判） */
    Brief = "brief",
    /** 多步引导（工科大题拆解：方法步 + 结果步，逐步解锁作答） */
    Steps = "steps",
    /** 完形填空（语篇在材料块里，逐空 slot-{k}-* 子块） */
    Cloze = "cloze",
    /** 新题型（候选池 option 块 + 槽位匹配：七选5/排序/标题匹配/多项对应） */
    Match = "match",
    /** 作文（大小作文/应用文：题干即材料，AI 判分给分档） */
    Essay = "essay",
    /** 翻译（英译汉：逐句或整段，AI 判分） */
    Trans = "trans",
}

/** 客观题类型 = 可自动判分；brief 除外。 */
export const AUTO_GRADE_TYPES: readonly QuestionType[] = [
    QuestionType.Single,
    QuestionType.Multiple,
    QuestionType.Judge,
    QuestionType.Fill,
];

/** type 属性别名映射：AI 偶发输出大小写/中文变体，读入时规整。 */
const TYPE_ALIASES: Record<string, QuestionType> = {
    [QuestionType.Single]: QuestionType.Single,
    单选: QuestionType.Single,
    单项选择: QuestionType.Single,
    [QuestionType.Multiple]: QuestionType.Multiple,
    多选: QuestionType.Multiple,
    多项选择: QuestionType.Multiple,
    [QuestionType.Judge]: QuestionType.Judge,
    判断: QuestionType.Judge,
    [QuestionType.Fill]: QuestionType.Fill,
    填空: QuestionType.Fill,
    [QuestionType.Brief]: QuestionType.Brief,
    简答: QuestionType.Brief,
    问答: QuestionType.Brief,
    [QuestionType.Steps]: QuestionType.Steps,
    多步: QuestionType.Steps,
    多步引导: QuestionType.Steps,
    引导: QuestionType.Steps,
    [QuestionType.Cloze]: QuestionType.Cloze,
    完形: QuestionType.Cloze,
    完形填空: QuestionType.Cloze,
    英语知识运用: QuestionType.Cloze,
    [QuestionType.Match]: QuestionType.Match,
    新题型: QuestionType.Match,
    七选五: QuestionType.Match,
    "7选5": QuestionType.Match,
    匹配: QuestionType.Match,
    [QuestionType.Essay]: QuestionType.Essay,
    作文: QuestionType.Essay,
    写作: QuestionType.Essay,
    大作文: QuestionType.Essay,
    小作文: QuestionType.Essay,
    应用文: QuestionType.Essay,
    [QuestionType.Trans]: QuestionType.Trans,
    翻译: QuestionType.Trans,
    英译汉: QuestionType.Trans,
};

/** 规整 type 属性为合法题型；无法识别返回 undefined（走自评流程）。 */
export function normalizeType(raw?: string): QuestionType | undefined {
    return TYPE_ALIASES[(raw ?? "").trim().toLowerCase()];
}

/** steps 题且聚合出了至少一步（否则按普通自评流程降级）。 */
export function hasSteps(q: WenguQuestion): boolean {
    return q.type === QuestionType.Steps && (q.steps?.length ?? 0) > 0;
}

/** brief 同族：多行输入 + AI 判分（essay/trans 共用 brief 的判分与改判通道）。 */
export function isBriefLike(q: WenguQuestion): boolean {
    return q.type === QuestionType.Brief || q.type === QuestionType.Essay || q.type === QuestionType.Trans;
}

/** 多步引导题的一步类型：method=选方法（可行集合任一即对），result=中间结果。 */
export type WenguStepKind = "method" | "result";

/** 多步引导题（type="steps"）的一步。 */
export interface WenguStep {
    /** method：考察「什么场合用什么工具」，任一可行方法即对；
     *  result：考参考路径下的中间结果，唯一解。 */
    kind: WenguStepKind;
    /** 本步引导语 markdown（如「第 2 步 · 等价无穷小代换：本步化简得（ ）」）。 */
    stemMd: string;
    /** 本步选项 markdown，按序对应 A、B、C…。 */
    optionMd: string[];
    /** method 步=全部可行字母集合（如 "AC"）；result 步=正确字母（或内容答案）。 */
    answer: string;
}

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
    /** 所属材料块 id（阅读/完形等共享原文；转换先写 "prev" 占位，
     *  装载时由 MaterialService 解析回写真实 id）。 */
    group?: string;
    /** 刷题次数。 */
    attempts: number;
    /** 累计答错次数（答错 +1、答对不清零）。 */
    wrongCount: number;
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
    /** 多步步骤（type="steps"，由 part="step-{k}-*" 子块与 steps 属性聚合）。 */
    steps?: WenguStep[];
    /** 运行时：逐步最近正误（"1010"，与 steps 对齐）。 */
    stepRight?: string;
    /** 运行时：逐步最近作答（字母按步竖线分隔，如 "A|B"）。 */
    stepLast?: string;
}

/** 一个习题文档的聚合视图（已生成列表用，随文档持久存在）。 */
export interface WenguDoc {
    /** 文档 id。 */
    id: string;
    /** 文档标题。 */
    title?: string;
    /** 人读路径，如 /温故测试。 */
    hPath?: string;
    /** 题目总数。 */
    total: number;
    /** 已作答题数（attempts 已写过）。 */
    attempted: number;
    /** 最近一次答对题数（right=1）。 */
    rightCount: number;
    /** 累计刷题用时（秒，文档块 total-time 属性）。 */
    totalTime: number;
}

/** 材料块（E0 材料组，english-question-review.md M1）：阅读/完形等
 * 共享原文的超级块容器，与小题同存一篇习题文档；小题用 group 属性引用。 */
export interface WenguMaterial {
    /** 材料超级块 id。 */
    id: string;
    /** 所属文档 id。 */
    rootId?: string;
    /** 材料正文 markdown（part="body" 子块按序拼接）。 */
    bodyMd?: string;
    /** 参考译文 markdown（part="trans" 子块，可选；判分后揭示）。 */
    transMd?: string;
}

/** 难度取值为合法星数。 */
export function parseDifficulty(raw?: string): number | undefined {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined;
}

/**
 * 解析 steps 容器属性（"method|result|result"，AI 偶发中文/逗号变体）。
 * 非法或缺失返回 undefined（步骤 kind 全部按 result 容错）。
 */
export function parseStepKinds(raw?: string): WenguStepKind[] | undefined {
    if (!raw?.trim()) return undefined;
    const kinds = raw.split(/[|,，;；\s]+/).filter(Boolean);
    if (kinds.length === 0) return undefined;
    const out: WenguStepKind[] = [];
    for (const k of kinds) {
        const lower = k.toLowerCase();
        if (lower === "method" || k === "方法") out.push("method");
        else if (lower === "result" || k === "结果") out.push("result");
        else return undefined;
    }
    return out;
}

/**
 * 清洗 answer 子块文本为判分原料：去引述（`>`）前缀、
 * 「正确答案：」类标签、转义竖线（fill 多答案分隔符写法 `\|`）。
 */
export function normalizeAnswerMd(md: string): string {
    return md
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:>\s*)+/, ""))
        .join("\n")
        .replace(/^[ \t]*(?:正确答案|我的答案|答案|Answer)\s*[:：][ \t]*/i, "")
        .replace(/\\\|/g, "|")
        .trim();
}

/**
 * 清洗题干文本：去掉早期转换残留的「题干A：」类前缀标签
 * 及紧随其后的悬空 `**`（真机 20260821231242 文档实测）。
 */
export function cleanStemMd(md: string): string {
    return md.replace(/^[ \t]*题干\s*[A-Za-z0-9]?[ \t]*[：:][ \t]*(?:\*\*[ \t]*)?/gm, "").trim();
}

/**
 * 判分用最终规整：大写、去全部空白、去 `$` 数学定界。
 * 真实转换结果里答案常写作 `$e^2$`，与手输 `e^2` 应判相等。
 */
export function normAnswerText(s: string): string {
    return s.trim().toUpperCase().replace(/\s+/g, "").replace(/\$/g, "");
}

/**
 * 把一个选项块拆成逐选项 markdown。
 * 真实转换常把 A、B、C 写进同一个列表块（如 `- A. $e$\n- B. $e^2$`），
 * 按顶层列表条目切分；嵌套行跟随其父条目。
 */
export function splitOptionMd(md: string): string[] {
    const out: string[] = [];
    let cur: string[] = [];
    for (const line of md.split(/\r?\n/)) {
        if (/^(?:[-*+]|\d+[.)])\s/.test(line)) {
            if (cur.length) out.push(cur.join("\n"));
            cur = [line];
        } else {
            cur.push(line);
        }
    }
    if (cur.length) out.push(cur.join("\n"));
    return out.length ? out : [md];
}

/** 选项展示用：去列表标记与字母标签（字母由页签自己画角标）。 */
export function optionDisplayMd(md: string): string {
    return stripOptionLabel(md.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "")).trimStart();
}

/** 选项判分用可比文本：去标记/标签后规整。 */
export function optionComparable(md: string): string {
    return normAnswerText(optionDisplayMd(md));
}

function stripOptionLabel(md: string): string {
    // 单字母标签：A. / A、 / A： / (A) …；选项正文本就带这些标签，误伤率低
    return md.replace(/^\s*(?:\([A-Za-z]\)|[A-Za-z]\s*[.、．:：)])\s*/, "");
}

/** 选项字母表，按 option 顺序对应 A、B、C…。 */
export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 一轮刷题的计时方式：正计时 / 倒计时 / 逐题计时 / 不计时。 */
export type WenguTimingMode = "countUp" | "countdown" | "perQuestion" | "none";

/** 答案展示方式：即时（提交一题看一题）/ 全部做完再统一展示。 */
export type WenguRevealMode = "instant" | "after";

/** 多步引导题的作答模式：离线（转换时生成的静态参考路径）/
 *  AI 实时（作答时跟随用户选的方法逐步生成，较慢且可能出错）。 */
export type WenguStepsMode = "offline" | "ai";

/** 多步题第 k 步在会话里的记录 qid（块 id + "#" + 步序）。 */
export function stepsQid(qid: string, k: number): string {
    return `${qid}#${k}`;
}

/** 会话结果 qid → 所属题目块 id（普通题即自身，多步步条目去掉 #k 后缀）。 */
export function baseQid(qid: string): string {
    return qid.split("#")[0];
}
