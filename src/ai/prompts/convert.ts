import type { QuestionType } from "../../types";
import { QuestionType as QT } from "../../types";
import { materialExamplesFor, materialRulesFor, protocolSpec, typeRulesFor } from "./protocol";

/**
 * 转换域 prompt（20260910 自 ConvertService/ConvertDetect/KnowOutline 迁入
 * prompt 集中地）：整卷/增量共用的出题 prompt、前置检测窗口 prompt、
 * 知识大纲归纳 prompt。
 *
 * 出题 prompt 题型化（20260910）：前置检测顺带判断文档含哪些题型
 * （TYPES 行，零额外 AI 调用），buildPrompt 只拼在场题型的规则——
 * 数学卷不再带英语四类约定。types=undefined（检测失败/续跑无先验）
 * 走全量兜底，prompt 与题型化之前逐字节一致。
 */

/** 多步引导题的行协议示例（bigToSteps 开启时随 prompt 附带）。 */
const STEPS_EXAMPLE = `@@Q type=steps steps=method|result knowledge=考点 chapter=章节
@@P stem
计算大题题干……求 $\\lim_{x \\to 0}\\frac{\\sin x}{x}$
@@P step
第 1 步 · 选择方法：求解本题可行的方法是（ ）
@@P step-opt
洛必达法则
@@P step-opt
等价无穷小代换
@@P step-ans
AB
@@P step
第 2 步 · 等价无穷小代换：本步化简得（ ）
@@P step-opt
$1$
@@P step-opt
$0$
@@P step-opt
$\\infty$
@@P step-opt
$x$
@@P step-ans
A
@@P sol
完整解析（含每一步的推导）
@@END`;

/** 开关联动的补充题型：填空转选择产出 single、大题拆多步产出 steps——
 *  开关开着时对应题型约定必须在场（用户显式设置不受检测影响）。 */
function specTypesOf(
    types: QuestionType[] | undefined,
    fillToChoice: boolean,
    bigToSteps: boolean
): QuestionType[] | undefined {
    if (!types) return undefined;
    const extra: QuestionType[] = [...(fillToChoice ? [QT.Single] : []), ...(bigToSteps ? [QT.Steps] : [])];
    return [...new Set([...types, ...extra])];
}

/** 出题 prompt（20260902 起输出走行协议，kramdown 由代码渲染——格式
 *  规则只剩内容语义，超级块/IAL 语法全部消失）。knowRule/knowList 是
 *  知识点反链的追加插槽（KnowledgeLink 路由出小节时才有值）；
 *  types=前置检测/题集先验给出的本卷题型（undefined=全量兜底）。 */
export function buildPrompt(
    source: string,
    fillToChoice = false,
    bigToSteps = false,
    knowRuleBlock = "",
    knowList = "",
    types?: QuestionType[]
): string {
    const specTypes = specTypesOf(types, fillToChoice, bigToSteps);
    // 填空转选择：一次对话内完成（不需要额外一轮 AI 调用）
    const fillRule = fillToChoice
        ? `
8. 填空转选择：原文中的填空题一律改写为 type="single" 的单选题——题干中的空格（____/（ ））改为（ ），正确答案即原空格答案，再编写 3 个与正确答案同类、似是而非但有明确错误的干扰项作为其余选项；解析里说明原填空答案。`
        : "";
    // 大题拆多步：可分解的工科大题 → 多步引导题（method/result 步）
    const stepsRule = bigToSteps
        ? `
9. 大题拆多步：原文中可分解的工科大题（计算/求值/化简，每步有确定的中间结果）改写为 type="steps" 的多步引导题——选定一条典型参考路径拆 2~5 步；方法分歧处设 method 步（选项为候选方法，@@P step-ans 写**全部可行方法**的字母集合如 AB，任选可行即对）；其余为 result 步考该步的中间结果，@@P step-ans 写唯一正确字母，干扰项来自常见计算错误；每步 3~4 个选项，结果步的引导语写明所用方法（如「第 2 步 · 等价无穷小代换：本步化简得（ ）」）；@@Q 行的 steps 按序声明每步类型（如 steps=method|result）；论述/证明/开放等不可分解的题仍用 type="brief"。示例：
${STEPS_EXAMPLE}`
        : "";
    const englishRules = materialRulesFor(specTypes);
    return `你是思源笔记的出题助手。把下面的文档内容转换成刷题题目。

判断该文档内容是否适合出题（有可考查的知识点、内容足够具体），先输出两行判定：
CAN_CONVERT: yes 或 no
REASON: 一句话说明（不能转换时说明原因，能转换时概括题目覆盖范围）

可出题时，随后每道题按以下${protocolSpec(specTypes)}
硬性规则：
${typeRulesFor(specTypes)}
2. 公式行内用 $...$，块级用 $$...$$ 各占一行；禁止使用 \\[ \\] 记法。
3. 保留原文的公式与代码。
4. **题量与原文严格对应**：若原文是试卷/习题册/题解（有现成题目，或「题目+答案」结构），必须**一题对一题**——原文一道题输出一道题，原文的答案与解答写进该题的解析（@@P sol），不得漏题、不得合并、不得把一道题拆成多道、也不得自行新造；答案/解答只是该题的解析来源，**不得再为它单独出题**。只有原文是讲义/笔记（无现成题目）时才按知识点出题：内容少时至少 1 道，丰富时 5~12 道。
5. **插图必须随题走**：原文档里的插图以占位行「〔插图:assets/文件名〕」出现，是该题依赖的插图（电路图/方框图/几何图等）时，把该插图**还原成标准 markdown 图片行**写进对应部件——半角 ! + 空方括号 + 小括号内为冒号后的完整原路径（示意形如 ![](插图原路径)），单独成段、路径与文件名一个字符都不能改；**不要**把〔插图:…〕占位原样写进输出。题目本身依赖的图（原理示意图/结构图，题干常写「如图/下图/图所示」）放题干（@@P stem）；答案/解析里给出的图（如解答画出的方框图）放解析（@@P sol）。没有插图的题**不要**编造图片行。
6. **禁止跳过带图题**：题干含「如图/下图/图所示」或题目相关段落配有插图占位行（〔插图:…〕）的题，必须与所有题一样逐题转换（插图按第 5 条还原）；因为题里有图、读不了图就跳过整道题，是比漏选项严重得多的错误。
7. **共享材料组**（试卷中多篇小题共用的原文${materialExamplesFor(specTypes)}）：先输出材料块（@@Q material=1 + @@P body，原文档有参考译文才加 @@P trans），随后紧跟依附它的小题，小题 @@Q 行加 group=prev；独立成题（作文等无共享原文）不加 group。${englishRules}分批转换时若本批只有材料没有题目、或只有题目没有材料，仍照常输出（group=prev 引用的是最终文档里其前的材料块）。
内容筛选（只出可考查的练习题，以下内容一律跳过、不得转成题目）：
- 讲义正文里夹带的**例题**（「例 1」「例 2」「【例】」「例题」等）及其示范解答——例题是讲解演示，不是练习，整段跳过。**例外：习题册的答案/解答不算例题**——「答案」「题解」类标题下、只有【解】【证】【分析】等求解过程的段落是练习内容而非讲解演示：把其中每道解答还原成**一道**完整题目输出（一解答只对应一题，求解过程写进解析），同样遵守第 4 条一题对一题；
- 章节开头的**引言/导读/学习目标**（「本章将介绍…」「学习目标」「导读」）——开场白没有可考知识点；
- 章末的**小结/重点回顾/知识框架/思维导图**（「本章小结」「重点回顾」「知识框架」）——收尾总结不出题；
判断依据是内容性质而非标题字面：讲解正文里附带完整解答的演示题即例题，习题册答案区的解答不是；只对知识做归纳梳理、无新考点的首尾段落即引言或小结。跳过这些内容后，按剩余正文的知识点正常出题。${fillRule}${stepsRule}${knowRuleBlock}

文档内容：
${source}${knowList}`;
}

/** 单段检测 prompt：计数 + 题型判断（题干起点落在本段的题），首段
 *  额外产出 CAN/REASON。TYPES 行喂生成端的题型化 prompt——宁可多报，
 *  漏报会让生成缺该题型的格式规则。20260910 自 ConvertDetect 迁入
 *  （原名 windowPrompt，计数语义不变）。 */
export function detectWindowPrompt(win: string, withVerdict: boolean): string {
    const lines: string[] = [];
    if (withVerdict) lines.push("CAN_CONVERT: yes 或 no");
    lines.push("COUNT: 数字（本段中现成题目的数量）");
    lines.push("TYPES: 本段现成题目的题型，逗号分隔；没有现成题目时留空");
    if (withVerdict) lines.push("REASON: 一句话说明（注明文档类型：试卷题库或讲义笔记；不能转换时说明原因）");
    const head = withVerdict
        ? "你是思源笔记出题助手的前置检查。判断下面的内容是否适合出题，并统计其中现成题目的数量。"
        : "你是思源笔记出题助手的题目计数器。统计下面这段内容里现成题目的数量。";
    const nCn = ["一", "两", "三", "四"][lines.length - 1] ?? String(lines.length);
    return `${head}
只统计题干开头（题号如「1.」「(1)」，或一道题的完整设问起点）出现在本段中的题目：
本段开头承接上文的未完残题不要计，本段末尾未写完的题目照常计；讲义/笔记等没有现成题目时计 0。
题型从 single/multiple/judge/fill/brief/steps/cloze/match/essay/trans 里选（写中文也可以，如 单选/多选/判断/填空/简答/多步/完形/新题型/作文/翻译）；拿不准或疑似混合的题型也列出——宁可多报，漏报会让后续生成缺少该题型的格式规则。
输出严格${nCn}行，格式之外不要输出任何文字：
${lines.join("\n")}
内容：
${win}`;
}

/** 归纳 prompt。层级约定与 buildSectionTree 的就近挂靠语义对齐；禁空
 *  标题；方法层要求穷尽但有实质讲解门槛——纯名词罗列/发展史不升格为
 *  知识点（20260909 真机踩坑：自控原理绪论「发展史」一节的流派名词云
 *  被全量铺成 18 个 h3，占全树近半且污染路由词表）。20260910 自
 *  KnowOutline 迁入。 */
export function buildOutlinePrompt(content: string): string {
    return `你是知识点大纲整理器。把下面的章节内容归纳成一棵知识点大纲树，输出 markdown，只含标题与极简说明。这棵树服务于刷题：节点是做题时会用到的知识点。
层级约定（严格）：
# 知识大类（如：求极限 / 微分方程 / 级数）
## 具体方法或解法（如：洛必达法则 / 等价无穷小代换 / 夹逼准则；一阶线性 / 伯努利方程 / 傅里叶级数展开）
### 更细分（适用条件 / 典型陷阱 / 步骤要点；确无细分则省略整级）
规则：
1. 最高从 # 开始；层级最深 ###；不要输出章节名本身当标题。
2. 每个标题必须实义，禁止「其他」「概述」「总结」这类空标题。
3. 每个 # 必须是本章实际讲到的知识主题，禁止起比本章更宽泛的学科名（本章讲「自动控制的一般概念」就不要起「自动控制理论基础」这类大一统标题）。
4. 方法层要穷尽内容中有实质讲解的方法与解法——正文有展开说明的才算，不要只挑两三个；一笔带过、纯名词罗列的内容（发展史、流派清单、课程框架）不单独立节点，至多合并成一个条目。
5. 面向做题价值：不出题的背景性、科普性内容不进树。
6. 每个叶标题下至多一行 30 字内的补充说明（可整篇省略）。
7. 只输出 markdown 标题树，格式之外不要输出任何文字。

章节内容：
${content}`;
}
