import { QuestionType } from "../../types";

/**
 * 行协议格式约定与题型注册表（生成 prompt 共用：转换/增量/单题重生成/
 * 出题）。20260910 自 convert/service/QuestionDraft.ts 迁入 prompt 集中地
 * （bank 域 import convert 域的层级倒挂随之消解），并升级**题型化**：
 * 前置检测先判断材料含哪些题型，生题 prompt 只带相关题型的部件说明与
 * 写法约定（数学卷不再背英语四类的规则）。
 *
 * types=undefined 是**全量兜底**路径（检测失败/续跑无先验/题型未知），
 * 输出与题型化改造前逐字节一致——回退语义=旧行为，不引入新变量。
 */

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
 *  恒在——共享材料组与题型无关（阅读理解单选也挂材料）。 */
export function protocolSpec(types?: QuestionType[]): string {
    const head = `行协议格式（标记行必须顶格、独占一行；内容行原样书写，公式与图片行不需要任何转义）：
@@Q type=题型 knowledge=考点 chapter=章节
@@P stem
题干文字（公式行内 $...$、块级 $$...$$ 独占一行；空行分段，也可写多个 @@P stem）
@@P opt
选项内容（只写内容不写字母——字母由系统按顺序自动编 A、B、C…；正确项写在最前，之后是干扰项，每个选项一个 @@P opt）
`;
    if (!types) {
        return `${head}@@P ans
答案（单选/多选写字母如 B、AD；判断写 √ 或 ×；填空用 | 分隔多个可接受答案；简答/作文写要点或范文）
@@P sol
解析文字
@@END
其它部件：材料块正文 @@P body、参考译文 @@P trans；多步引导题（type=steps）每步依次 @@P step（步引导语）、@@P step-opt（该步选项）、@@P step-ans（该步答案），步号自动递增，整题解析仍用 @@P sol；完形/新题型每空依次 @@P slot-opt、@@P slot-ans，空号自动递增。@@Q 行还可带：difficulty=1~5（有明确难度线索才写）、steps=method|result|…（steps 题必带，按序声明每步类型）、group=prev（材料组小题，材料=文中紧邻其前的材料块）、material=1（共享材料块，搭配 @@P body/trans）。`;
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
    return `${head}@@P ans
答案（${ans}）
@@P sol
解析文字
@@END
其它部件：材料块正文 @@P body、参考译文 @@P trans${stepPart}${slotPart}。@@Q 行还可带：difficulty=1~5（有明确难度线索才写）${stepsAttr}、group=prev（材料组小题，材料=文中紧邻其前的材料块）、material=1（共享材料块，搭配 @@P body/trans）。`;
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

/** buildPrompt 规则 7 的「英语题型约定」段：仅在场题型的约定拼装；
 *  四类全不在场时返回空串（整段省略）。types=undefined 时四类全拼
 *  （与改造前逐字节一致）。 */
export function materialRulesFor(types?: QuestionType[]): string {
    const english = [QuestionType.Cloze, QuestionType.Match, QuestionType.Essay, QuestionType.Trans];
    const present = types ? english.filter((t) => types.includes(t)) : english;
    const frags = present.map((t) => MATERIAL_TYPE_RULES[t]).filter(Boolean);
    if (frags.length === 0) return "";
    return `英语题型约定：${frags.join("；")}。`;
}

/** 材料组示例清单（规则 7 括号内）：英语题型在场时列全，纯客观/数学
 *  卷只提阅读文章。 */
export function materialExamplesFor(types?: QuestionType[]): string {
    const english = [QuestionType.Cloze, QuestionType.Match, QuestionType.Essay, QuestionType.Trans];
    return types && !types.some((t) => english.includes(t))
        ? "：阅读文章等共用语篇"
        : "：阅读文章、完形语篇、翻译原文、新题型文章";
}
