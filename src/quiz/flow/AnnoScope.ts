import { QuestionType } from "../../types";

/**
 * 标注浮条的作用域判定（Issue #45 纯逻辑层，单测覆盖）——两类误现的
 * 判定都收在这里，DOM 侧（AnnoFlow）只做「读观测 → 交给这里 → 按结果
 * 施工」，不在事件回调里写业务判断：
 *
 * ① **模式闸**：标注是**做题功能**，只读浏览（预览）/错题复查（复习）
 *    下滑选文本不该出条。视图 mode 是唯一权威（QuizView.mode）。
 * ② **标生词的条件闸**：生词本是英语功能，非英语卷（数学等）选中公式/
 *    文字出「标生词」无意义——按**卷级**判定（该卷题型并集含英语四类
 *    任一），题级判不开（英语阅读 single 与数学单选都是 single）。
 *
 * 分流结果 `BarPicks` = 出哪几个钮；**一个都不出 = 浮条整体不出现**
 * （非英语卷在非可标区域选段，出了就是一条空浮条）。
 */

/** 视图模式（与 QuizView.mode 同源；study 是预留的学习模式，同样非做题）。 */
export type ViewMode = "quiz" | "review" | "study" | "preview";

/** 英语四类题型（cloze 完形 / match 新题型 / essay 作文 / trans 翻译）
 *  ——与 ai/prompts/protocol 的英语题型段同集合，改这里也要改那边。 */
export const ENGLISH_TYPES: readonly QuestionType[] = [
    QuestionType.Cloze,
    QuestionType.Match,
    QuestionType.Essay,
    QuestionType.Trans,
];

/**
 * 模式闸：**只有做题模式（quiz）放行**。预览/复习/学习都是只读或复习
 * 上下文，标注浮条一律不出现；切模式时已开的浮条由调用方立即 hideBar
 * （判定是拉取式，光靠 selectionchange 不会在切模式那一刻重判）。
 */
export function annoEnabled(mode: ViewMode): boolean {
    return mode === "quiz";
}

/**
 * 卷级英语判定：该卷题型并集里含英语四类任一即英语卷。空并集（题集
 * 尚无记录/题型全不可识别）判**否**——反查不出证据时不放行标生词，
 * 宁缺勿错。
 */
export function isEnglishTypes(types: readonly QuestionType[] | undefined | null): boolean {
    return !!types?.some((t) => ENGLISH_TYPES.includes(t));
}

/** 浮条按钮分流所需观测（DOM 侧读出，本模块只做判定）。
 *  isCluable=选区是否落在可标区域（材料面板/题干区，见 AnnoFlow）；
 *  english=选区起点所在卷是否英语卷（反查失败=false）；mode=当前视图模式。 */
export interface BarPick {
    mode: ViewMode;
    isCluable: boolean;
    english: boolean;
}

/** 浮条该出哪些钮。 */
export interface BarPicks {
    /** 浮条整体是否出现（两钮都不出 = 空条，不出）。 */
    show: boolean;
    clue: boolean;
    word: boolean;
}

/**
 * 模式闸 + 按钮分流（唯一判定点）：
 * - 非 quiz 模式：`{show:false}`——预览/复习零浮条；
 * - quiz 模式：「标为线索」照旧只认可标区域（既有行为逐字节不变）；
 *   「标生词」还要**英语卷**才出（卷级，见 isEnglishTypes）；
 * - 两钮都不出 ⇒ 不出现（非英语卷在解析区/选项区选段即此情形，
 *   改造前会浮出一条只剩「标生词」的条）。
 */
export function pickAnnobarButtons(p: BarPick): BarPicks {
    if (!annoEnabled(p.mode)) return { show: false, clue: false, word: false };
    const clue = p.isCluable;
    const word = p.english;
    return { show: clue || word, clue, word };
}
