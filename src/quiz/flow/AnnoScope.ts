import { QuestionType } from "../../types";

/**
 * 标注浮条的作用域判定（Issue #45 纯逻辑层，单测覆盖）——两类误现的
 * 判定都收在这里，DOM 侧（AnnoFlow）只做「读观测 → 交给这里 → 按结果
 * 施工」，不在事件回调里写业务判断：
 *
 * ① **模式闸**：标注是**做题功能**，只读浏览（预览）/错题复查（复习）
 *    下滑选文本不该出条。视图 mode 是唯一权威（QuizView.mode）。
 * ② **标生词的条件闸**：生词本是英语功能，非英语卷（数学/语文等）选中
 *    公式/文字出「标生词」无意义——按**卷级**判定（`isEnglishScope`：
 *    有学科以学科为准、无学科回退题型并集），题级判不开（英语阅读 single
 *    与数学单选都是 single）。
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
 * 英语学科的字面归一判定（Issue #83）：`subject` 是转换首批判定行报出的
 * **真实学科**，取值开放（英语/数学/语文/历史/政治/自控原理…）。这里只认
 * 三个同义写法（英语 / 英文 / english，大小写与空白不敏感），**不做模糊
 * 匹配**——学科猜错比不认更坏（语言闸被假学科锁死）。
 *
 * ⚠️ 只服务「标生词」（语言专属功能）。**不许拿它判阅读面**：阅读面是
 * 材料组结构判据、与学科零关系（见 flow/ReadingScope，#83 根因即
 * 「#81 把阅读面绑在英语判别上」）。
 */
export function isEnglishSubject(subject?: string | null): boolean {
    const s = (subject ?? "").trim().toLowerCase().replace(/\s+/g, "");
    return s === "英语" || s === "英文" || s === "english";
}

/**
 * 卷级英语判定的**两级口径**（Issue #83，唯一判定点；**仅服务「标生词」**）：
 *
 * - **有学科以学科为准**：`subject` 在场即 **只看它**——不管题型并集里
 *   有没有英语四类。理由：题型是**作答形态**不是学科，「语文卷含作文
 *   （essay）与文言文翻译（trans）」在题型并集上与英语卷无从区分；反过来
 *   「纯英语阅读训练卷」全是 single，题型并集里一个英语形态都没有。形态
 *   代理两个方向都会判错，有真实学科时必须以它为准。
 * - **无学科回退题型并集**（存量题集零迁移，逐字节保持改造前口径）：
 *   见 isEnglishTypes。
 *
 * 空学科（题集不存在/未报/占位「无」「未知」，由 BankSets.normalizeSubject
 * 归 undefined）走回退分支——与「存量无字段」同一路。
 *
 * ⚠️ **本判据只决定「标生词」出不出现**（生词本是英语/语言功能）：阅读面
 * 与题卡间距阶梯看**材料组结构**、全学科一致（`flow/ReadingScope`）——
 * 两者曾经同源是 #81 修错方向的产物（#83 已切分）。
 */
export function isEnglishScope(
    subject: string | undefined | null,
    types: readonly QuestionType[] | undefined | null
): boolean {
    const s = (subject ?? "").trim();
    if (s) return isEnglishSubject(s);
    return isEnglishTypes(types);
}

/**
 * 卷级英语判定（**回退腿**）：该卷题型并集里含英语四类任一即英语卷。空
 * 并集（题集尚无记录/题型全不可识别）判**否**——反查不出证据时不放行标
 * 生词，宁缺勿错。
 *
 * ⚠️ 这是**无学科时**的口径（存量题集/学科未报）。带学科的题集一律走
 * `isEnglishScope`，别在消费点直接用它（Issue #83 的假阴/假阳即此）。
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

/* ── 选段归属题反查（卷级判定的输入） ── */

/** 选段归属反查的 DOM 观测（AnnoFlow 读出，纯判定在本模块）。 */
export interface AnnoOwnerPick {
    /** 最近的 `.wengu-card` 上的 `data-qid`（普通题卡/组内题卡都有）。 */
    cardQid?: string;
    /** 所在材料组单元内**当前显示**的那张卡的 qid（组题材料面板用）。 */
    groupQid?: string;
}

/**
 * 选段归属题的 qid（Issue #45 卷级判定的第一步；与 ClueMark 的
 * `clueOwnerQid` 同款「DOM 观测 → 纯判定」分工）。
 *
 * **组题的材料面板必须按组内卡反查**：`.wengu-gmat`（`[data-mprotyle]`）
 * 是 `.wengu-gqs` 的**兄弟节点**、不在任何 `.wengu-card` 里——英语阅读/
 * 完形的正文正好落在这里，只认 `cardQid` 会让整片正文区判不出英语卷
 * （「标生词」消失，验收 4/5 破）。两处都不命中 ⇒ undefined，调用方按
 * 「反查失败」收口（宁缺勿错）。
 */
export function annoOwnerQid(p: AnnoOwnerPick): string | undefined {
    return p.cardQid || p.groupQid || undefined;
}
