import { QuestionType } from "../../types";

/**
 * 行协议格式约定与题型注册表（生成 prompt 共用：转换/增量/单题重生成/
 * 出题）。20260910 自 convert/service/draft/QuestionDraft.ts 迁入 prompt 集中地
 * （bank 域 import convert 域的层级倒挂随之消解），并升级**题型化**：
 * 前置检测先判断材料含哪些题型，生题 prompt 只带相关题型的部件说明与
 * 写法约定（数学卷不再背英语四类的规则）。
 *
 * types=undefined 是**全量兜底**路径（检测失败/续跑无先验/题型未知），
 * 输出与题型化改造前逐字节一致——回退语义=旧行为，不引入新变量。
 *
 * 选项顺序另有**变体**（Issue #123，20260915 Issue #131 收口）：
 *   - 缺省（不带 opts）= **正确项写最前**（字母由渲染按序自动编、洗牌
 *     消剧透由代码做）——只留给**新造题**（讲义/笔记出题、变式、概念
 *     辨析/加练）；原文有现成题目（`opts.bank`）时必须走 keep 序。
 *   - `opts: "keep"` = 沿用原题顺序与字母（题内 ans/解析的字母引用随之
 *     自洽）：单题修复重生成、以及**整卷转换/增量重转换**的一题对一题。
 *   - `opts.bank`（Issue #131）= 逐题条件规则：原文有现成题目走 keep 序、
 *     新造题走「正确项写最前」——整卷转换既有题解（一题对一题）又有讲义
 *     （按知识点出题）时，只有条件规则能同时覆盖。
 *
 * 解析里的选项引用另有**标记协议**（Issue #131）：凡指代选项一律写
 * `〔opt:X〕`（全角方括号，与「〔插图:…〕」占位同款、与 kramdown IAL 的
 * `{:` 无碰撞），不得用裸字母指代选项；非指代选项的大写字母（Plan A、
 * 维生素 A）照常书写。落库前由 `OptionRefReplace` 换成选项文本——解析
 * 因此**不含任何选项字母**，展示层洗牌只剩答案字母重映射一件事，英语域
 * 也不会被裸 A 误伤。
 *
 * ⚠️ **标记约定缺省恒在**（P1，20260915 审查）：它曾随 `order`/`bank`
 * 条件生效，把 GenQuestion 的 conceptPrompt/variantPrompt（加练/变式，
 * 走默认协议）漏在链外——这些链的解析仍是裸字母，写库不洗、展示只重映射
 * 答案 ⇒ 一进卡解析字母就指错。设计是「解析无选项字母」**全链统一**，
 * 故 `solRule` 缺省 true，只在显式 `solRule: false` 时摘除。
 */

/** 行协议选项顺序口径（Issue #123）：缺省=「正确项在最前、系统重排
 *  字母」；"keep"=沿用原题顺序与字母（题内 ans/解析的字母引用随之自洽）。 */
export type ProtocolOptsOrder = "" | "keep";

/** @@P opt 行的写作约定：默认要求「正确项写在最前」（系统洗牌消剧透），
 *  keep 变体要求沿用原题顺序与字母（见 ProtocolOptsOrder）。 */
const OPT_LINE_DEFAULT =
    "选项内容（只写内容不写字母——字母由系统按顺序自动编 A、B、C…；正确项写在最前，之后是干扰项，每个选项一个 @@P opt）";
const OPT_LINE_KEEP =
    "选项内容（按**原题顺序与字母**原样给出——A 就是 A、B 就是 B，不重排、不省略，每个选项一个 @@P opt）";
/** 逐题条件规则（整卷转换/增量：原文有的题走原序、新造的题走重排）。 */
const OPT_LINE_BY_BANK =
    "选项内容（每个选项一个 @@P opt）。选项顺序**逐题判断**：原文这道题**本来就有现成选项**时，按**原题顺序与字母**原样给出（A 就是 A、B 就是 B，不重排）；原文没有现成选项（讲义/笔记新造的题）时只写内容不写字母（字母由系统按顺序自动编），**正确项写在最前**、之后是干扰项";

/** @@P sol 行的选项引用标记协议（Issue #131）：解析里凡指代选项一律写
 *  `〔opt:X〕`，落库前由 OptionRefReplace 换成选项文本（解析因此不含
 *  字母——展示层洗牌无需改写解析、英语域的裸 A 也不会被误伤）。 */
const SOL_REF_RULE =
    "解析中凡**指代选项**的地方（如「〔opt:B〕正确」「〔opt:A〕与〔opt:C〕均错误」）必须写全角方括号标记 〔opt:X〕（X 为该选项字母，一标记一字母），**不得用裸字母指代选项**；不是指代选项的大写字母（如 Plan A、维生素 A、型号 X）照常书写、不要加标记";

/** 行协议头部（标注行 → @@P opt 约定 → 答案/解析约定与 @@END）拼装。
 *  `withSolRule`=解析里带 `〔opt:X〕` 标记约定（Issue #131）。 */
function headOf(optLine: string, withSolRule: boolean): string {
    return `行协议格式（标记行必须顶格、独占一行；内容行原样书写，公式与图片行不需要任何转义）：
@@Q type=题型 knowledge=考点 chapter=章节
@@P stem
题干文字（公式行内 $...$、块级 $$...$$ 独占一行；空行分段，也可写多个 @@P stem）
@@P opt
${optLine}
@@P ans
答案（单选/多选写字母如 B、AD；判断写 √ 或 ×；填空用 | 分隔多个可接受答案；简答/作文写要点或范文）
@@P sol
解析文字${
        // 标记约定**独占一行**（Issue #131）：@@P opt 与 @@P sol 两行是
        // 变体之间的全部差异，其余行逐字不变（测试按行 diff 锁着）
        withSolRule ? `\n选项引用约定：${SOL_REF_RULE}` : ""
    }
@@END
`;
}

/** 题型规范序（type 清单展示序）。 */
const ALL_TYPES: QuestionType[] = [
    QuestionType.Single,
    QuestionType.Multiple,
    QuestionType.Judge,
    QuestionType.Fill,
    QuestionType.Brief,
    QuestionType.Steps,
    QuestionType.Cloze,
    QuestionType.Match,
    QuestionType.Essay,
    QuestionType.Trans,
];

/** brief 恒含（主观题兜底：题型漏检时 AI 可就近降级成简答而不是硬写
 *  无规则可依的题型）。 */
const withBrief = (types: QuestionType[]): QuestionType[] =>
    ALL_TYPES.filter((t) => t === QuestionType.Brief || types.includes(t));

/** 各题型 @@P ans 约定（protocolSpec 答案行按题型拼装；cloze/match 的
 *  答案在逐空 slot/候选池约定里，不进此行）。 */
const ANS_SPEC: Partial<Record<QuestionType, string>> = {
    [QuestionType.Single]: "单选写字母如 B",
    [QuestionType.Multiple]: "多选写字母串如 AD",
    [QuestionType.Judge]: "判断写 √ 或 ×",
    [QuestionType.Fill]: "填空用 | 分隔多个可接受答案",
    [QuestionType.Brief]: "简答写要点",
    [QuestionType.Essay]: "作文省略 @@P ans，解析写范文",
    [QuestionType.Trans]: "@@P ans 写参考译文",
    [QuestionType.Steps]: "多步题整题 @@P ans 可省略（每步答案写在 step-ans）",
};

/** rule 1 题型清单后的答案约定速记（括号内按题型拼装）。 */
const RULE1_HINTS: Partial<Record<QuestionType, string>> = {
    [QuestionType.Single]: "字母",
    [QuestionType.Multiple]: "字母串",
    [QuestionType.Judge]: "√或×",
    [QuestionType.Fill]: "| 分隔多答案",
    [QuestionType.Brief]: "要点或范文",
    [QuestionType.Steps]: "逐步作答",
    [QuestionType.Trans]: "参考译文",
};

/** 英语/材料组题型的生成约定（buildPrompt 规则 7「英语题型约定」段，
 *  仅该题型在场时拼入）。 */
const MATERIAL_TYPE_RULES: Partial<Record<QuestionType, string>> = {
    [QuestionType.Cloze]:
        '完形填空用 type="cloze"（材料正文里保留空位编号如 __1__；每空一组 @@P slot-opt（该空选项）/@@P slot-ans（该空正确字母），组内顺序即空号顺序）',
    [QuestionType.Match]:
        '新题型（七选五/排序/标题匹配/多项对应）用 type="match"（候选池每个候选一个 @@P opt，@@P ans 写槽位顺序对应的字母串如 D|A|G|E|B）',
    [QuestionType.Essay]: '作文用 type="essay"（题干=题目要求，图片随题走，省略 @@P ans，解析写范文）',
    [QuestionType.Trans]:
        '翻译用 type="trans"（题干=原句/原段，@@P ans=参考译文，解析写采分点解析；逐句考查的每句一个题块、共用同一材料块并加 group=prev）',
};

/** 行协议格式约定。types=undefined 时输出全量（与题型化改造前逐字节
 *  一致，兜底路径）；给定题型时部件说明与答案约定按题型裁剪，核心
 *  骨架（标记行/stem/opt/ans/sol 与材料组 body/trans/group/material）
 *  恒在——共享材料组与题型无关（阅读理解单选也挂材料）。
 *
 *  `opts.order`（Issue #123）与 `opts.bank`（Issue #131）**只替换 @@P opt
 *  那一行的写作约定**，其余段落逐字不变。二者同时给出时 bank 优先
 *  （条件规则已含两支语义）。
 *
 *  解析的 `〔opt:X〕` 标记约定（SOL_REF_RULE）**缺省恒在**（P1，20260915
 *  审查）：设计是「解析无选项字母」**全链统一**——所有走行协议的调用方
 *  产物都会落库、都会被展示层洗牌，裸字母指代选项必错。只有显式传
 *  `solRule: false` 才摘掉（当前无调用方这么做，留着做逃生口）。 */
export function protocolSpec(
    types?: QuestionType[],
    opts?: { order?: ProtocolOptsOrder; bank?: boolean; solRule?: boolean }
): string {
    const optLine = opts?.bank ? OPT_LINE_BY_BANK : opts?.order === "keep" ? OPT_LINE_KEEP : OPT_LINE_DEFAULT;
    // 解析标记约定**缺省为真**（P1，20260915 审查）：设计是「解析无选项字母」
    // **全链统一**——凡是走行协议出题/改题的调用方（转换、增量、重生成、
    // 概念辨析、变式、加练）落库后都会被展示层洗牌，而这些链原本只有
    // 声明了顺序口径的两个拿得到约定：GenQuestion 的 conceptPrompt /
    // variantPrompt 走**默认协议**、AI 写裸字母（它自己输出的序位，写库
    // 不洗、展示只重映射答案）⇒ **这些新题一进卡解析字母就全指错**（正是
    // 本单要杀的 bug 类）。故缺省带上，`withSolRule` 只作显式关闭口。
    const withSolRule = opts?.solRule !== false;
    const head = headOf(optLine, withSolRule);
    if (!types) {
        return `${head}其它部件：材料块正文 @@P body、参考译文 @@P trans；多步引导题（type=steps）每步依次 @@P step（步引导语）、@@P step-opt（该步选项）、@@P step-ans（该步答案），步号自动递增，整题解析仍用 @@P sol；完形/新题型每空依次 @@P slot-opt、@@P slot-ans，空号自动递增。@@Q 行还可带：difficulty=1~5（有明确难度线索才写）、steps=method|result|…（steps 题必带，按序声明每步类型）、group=prev（材料组小题，材料=文中紧邻其前的材料块）、material=1（共享材料块，搭配 @@P body/trans）。`;
    }
    const inTypes = withBrief(types);
    const ans = inTypes
        .map((t) => ANS_SPEC[t])
        .filter(Boolean)
        .join("；");
    const stepPart = inTypes.includes(QuestionType.Steps)
        ? "；多步引导题（type=steps）每步依次 @@P step（步引导语）、@@P step-opt（该步选项）、@@P step-ans（该步答案），步号自动递增，整题解析仍用 @@P sol"
        : "";
    const slotPart =
        inTypes.includes(QuestionType.Cloze) || inTypes.includes(QuestionType.Match)
            ? "；完形/新题型每空依次 @@P slot-opt、@@P slot-ans，空号自动递增"
            : "";
    const stepsAttr = inTypes.includes(QuestionType.Steps)
        ? "、steps=method|result|…（steps 题必带，按序声明每步类型）"
        : "";
    return `${head.replace(
        "答案（单选/多选写字母如 B、AD；判断写 √ 或 ×；填空用 | 分隔多个可接受答案；简答/作文写要点或范文）",
        `答案（${ans}）`
    )}其它部件：材料块正文 @@P body、参考译文 @@P trans${stepPart}${slotPart}。@@Q 行还可带：difficulty=1~5（有明确难度线索才写）${stepsAttr}、group=prev（材料组小题，材料=文中紧邻其前的材料块）、material=1（共享材料块，搭配 @@P body/trans）。`;
}

/** buildPrompt 规则 1：题型白名单 + 答案约定速记。types=undefined 时
 *  输出全量（与改造前逐字节一致）。 */
export function typeRulesFor(types?: QuestionType[]): string {
    if (!types) {
        return "1. type 取 single/multiple/judge/fill/brief/steps/cloze/match/essay/trans；@@P ans 按题型约定写（字母/字母串/√或×/| 分隔多答案/要点或范文）。";
    }
    const inTypes = withBrief(types);
    const list = inTypes.join("/");
    const hints = inTypes
        .map((t) => RULE1_HINTS[t])
        .filter(Boolean)
        .join("/");
    return `1. type 只取 ${list}；@@P ans 按题型约定写（${hints}）。`;
}

/** 词条行保真约定（Issue #30）：英语原卷在正文里对「特殊词」做下划线+
 *  标号，并在段后给词条行（`词 ^{记号} 音标 释义`）。这条**只要求 AI 把
 *  词条行原样搬进材料尾部**，正文不做任何改写——词表区的落库标记
 *  （`@@G`）与正文划线联动由代码做，不占 AI 的注意力。
 *
 *  与 materialRulesFor 同在「英语题型约定」段（cloze/match/essay/trans
 *  在场才拼）——非英语卷的 prompt 产物因此逐字节不含本段。 */
const GLOSS_RULE =
    "词条保真：源文里形如「词 ^{记号} 音标 释义」的**词条行**（紧跟其解释段落之后、成组出现的特殊词注）原样搬进该材料 @@P body 的**末尾**，回收时每行一条、内容不增不减不改写、顺序与原卷一致；**正文本身不得因词条做任何改写**（句子照抄、不许插标号、不许省略词条对应的词）。没有词条行时一个字都不要加。";

/** buildPrompt 规则 7 的「英语题型约定」段：仅在场题型的约定拼装；
 *  四类全不在场时返回空串（整段省略）。types=undefined 时四类全拼
 *  （与题型化改造前逐字节一致——**词条保真段是 20260910 Issue #30 的
 *  新增内容，是全量的组成部分**，undefined 兜底与英语题型在场两条路
 *  都带它；非英语卷才整段省略）。 */
export function materialRulesFor(types?: QuestionType[]): string {
    const english = [QuestionType.Cloze, QuestionType.Match, QuestionType.Essay, QuestionType.Trans];
    const present = types ? english.filter((t) => types.includes(t)) : english;
    const frags = present.map((t) => MATERIAL_TYPE_RULES[t]).filter(Boolean);
    if (frags.length === 0) return "";
    return `英语题型约定：${frags.join("；")}。${GLOSS_RULE}`;
}

/** 材料组示例清单（规则 7 括号内）：英语题型在场时列全，纯客观/数学
 *  卷只提阅读文章。 */
export function materialExamplesFor(types?: QuestionType[]): string {
    const english = [QuestionType.Cloze, QuestionType.Match, QuestionType.Essay, QuestionType.Trans];
    return types && !types.some((t) => english.includes(t))
        ? "：阅读文章等共用语篇"
        : "：阅读文章、完形语篇、翻译原文、新题型文章";
}
