import { KernelQuery } from "../../siyuan/query";
import { KernelDoc } from "../../siyuan/doc";
import { protocolSpec } from "./QuestionDraft";

/**
 * AI 转换服务的内核侧原语：源文档定位/读取、出题 prompt 与行协议解析。
 * 20260903 起转换产物**直写题库**（SetWriter），本模块不再含任何落盘
 * 文档通道（createExerciseDoc/appendBlockToDoc 等已随「不落文档」整体
 * 退役）。
 *
 * 20260902 起 AI 返回**行协议**（QuestionDraft：@@ 标记行定界的结构化
 * 文本），由代码确定性渲染成契约 kramdown——AI 不再手写超级块/IAL，
 * 格式修补层（extractQuestions）整体退役。
 */

/** 文档定位信息。 */
export interface DocInfo {
    id: string;
    /** 笔记本 id。 */
    notebook?: string;
    /** 标题路径（如 /讲义/书名/章节）。定位父级必须用它：内核按
     *  **标题**匹配 createDocWithMd 的路径段，用 .sy 文件路径拼段会让
     *  导入文档（文件名≠标题）被重建一串空父文档（真机踩坑）。 */
    hPath?: string;
    /** 文档标题。 */
    title: string;
}

/**
 * 送入 AI 的单批内容上限（超长由 ConvertBatch 分批，本值是批大小）。
 * 真机实测：内核 AI 代理约 30 秒硬超时，12k 字符源会超时空返回；
 * 6k 字符约 22 秒稳定返回（12 题）。
 */
export const MAX_SOURCE_CHARS = 6000;

/** 生成批切块字符上限（略小于 MAX_SOURCE_CHARS，给 prompt 头部留余量）。 */
export const CHUNK_CHARS = 5000;

/** 源文档切块（确定性：同一切分规则，偏移可作为续跑标记；检测的分段
 *  计数复用同一原语，只是窗口更大）。 */
export interface SourceChunk {
    text: string;
    /** 本块在源 kramdown 中的起始偏移（继续生成的断点）。 */
    offset: number;
}

/** 在 [半长, 全长] 窗口内找最后一个空行切块，找不到就硬切。 */
export function chunkKramdown(md: string, maxChars = CHUNK_CHARS): SourceChunk[] {
    const out: SourceChunk[] = [];
    let start = 0;
    while (start < md.length) {
        let end = Math.min(start + maxChars, md.length);
        if (end < md.length) {
            const blank = md.lastIndexOf("\n\n", end);
            if (blank > start + Math.floor(maxChars / 2)) end = blank + 2;
        }
        const text = md.slice(start, end).trim();
        if (text) out.push({ text, offset: start });
        start = end;
    }
    return out;
}

/** 取文档定位信息（标题/笔记本/标题路径）。 */
export async function getDocInfo(docId: string): Promise<DocInfo | undefined> {
    const row = (
        await KernelQuery.rows<{ id: string; box: string; content: string }>(
            `SELECT id, box, content FROM blocks WHERE id = '${docId}' AND type = 'd' LIMIT 1`
        )
    )[0];
    if (!row) return undefined;
    const info: DocInfo = { id: row.id, notebook: row.box, title: row.content || "未命名" };
    const loc = await KernelDoc.hPath(docId);
    const hp = loc.data;
    info.hPath = typeof hp === "string" && hp.trim() ? hp : undefined;
    return info;
}

/**
 * 从用户输入提取块 id：直接是 id，或粘了 `siyuan://blocks/<id>` 链接。
 * 思源块 id 形如 `20260821165017-6ivs5xm`。
 */
export function extractBlockId(input: string): string {
    const m = /(\d{14}-[a-z0-9]+)/i.exec(input.trim());
    // 未匹配时原样透传——调用方把它拼进 SQL（id = '…'），含引号即注入
    // 面；块 id 字符集不含引号，剥掉只影响垃圾输入（20260829 三轮审查）
    return m ? m[1] : input.trim().replace(/['"\\]/g, "");
}

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

/** 出题 prompt（20260902 起输出走行协议，kramdown 由代码渲染——格式
 *  规则只剩内容语义，超级块/IAL 语法全部消失）。knowRule/knowList 是
 *  知识点反链的追加插槽（KnowledgeLink 路由出小节时才有值）。 */
export function buildPrompt(
    source: string,
    fillToChoice = false,
    bigToSteps = false,
    knowRuleBlock = "",
    knowList = ""
): string {
    // 填空转选择：一次对话内完成（不需要额外一轮 AI 调用）
    const fillRule = fillToChoice
        ? `
8. 填空转选择：原文中的填空题一律改写为 type="single" 的单选题——题干中的空格（____/（ ））改为（ ），正确答案即原空格答案，再编写 3 个与正确答案同类、似是而非但有明确错误的干扰项作为其余选项；解析里说明原填空答案。`
        : "";
    // 大题拆多步：可分解的工科大题 → 多步引导题（method/result 步）
    const stepsRule = bigToSteps
        ? `
9. 大题拆多步：原文中可分解的工科大题（计算/求值/化简，每步有确定的中间结果）改写为 type="steps" 的多步引导题——选定一条典型参考路径拆 2~5 步；方法分歧处设 method 步（选项为候选方法，@@P step-ans 写**全部可行方法**的字母集合如 AB，任选可行即对）；其余为 result 步考该步的中间结果，@@P step-ans 写唯一正确字母，干扰项来自常见计算错误；每步 3~4 个选项，结果步的引导语写明所用方法（如「第 2 步 · 等价无穷小代换：本步得（ ）」）；@@Q 行的 steps 按序声明每步类型（如 steps=method|result）；论述/证明/开放等不可分解的题仍用 type="brief"。示例：
${STEPS_EXAMPLE}`
        : "";
    return `你是思源笔记的出题助手。把下面的文档内容转换成刷题题目。

判断该文档内容是否适合出题（有可考查的知识点、内容足够具体），先输出两行判定：
CAN_CONVERT: yes 或 no
REASON: 一句话说明（不能转换时说明原因，能转换时概括题目覆盖范围）

可出题时，随后每道题按以下${protocolSpec()}
硬性规则：
1. type 取 single/multiple/judge/fill/brief/steps/cloze/match/essay/trans；@@P ans 按题型约定写（字母/字母串/√或×/| 分隔多答案/要点或范文）。
2. 公式行内用 $...$，块级用 $$...$$ 各占一行；禁止使用 \\[ \\] 记法。
3. 保留原文的公式与代码。
4. **题量与原文严格对应**：若原文是试卷/习题册/题解（有现成题目，或「题目+答案」结构），必须**一题对一题**——原文一道题输出一道题，原文的答案与解答写进该题的解析（@@P sol），不得漏题、不得合并、不得把一道题拆成多道、也不得自行新造；答案/解答只是该题的解析来源，**不得再为它单独出题**。只有原文是讲义/笔记（无现成题目）时才按知识点出题：内容少时至少 1 道，丰富时 5~12 道。
5. **插图必须随题走**：原文档里的插图以占位行「〔插图:assets/文件名〕」出现，是该题依赖的插图（电路图/方框图/几何图等）时，把该插图**还原成标准 markdown 图片行**写进对应部件——半角 ! + 空方括号 + 小括号内为冒号后的完整原路径（示意形如 ![](插图原路径)），单独成段、路径与文件名一个字符都不能改；**不要**把〔插图:…〕占位原样写进输出。题目本身依赖的图（原理示意图/结构图，题干常写「如图/下图/图所示」）放题干（@@P stem）；答案/解析里给出的图（如解答画出的方框图）放解析（@@P sol）。没有插图的题**不要**编造图片行。
6. **禁止跳过带图题**：题干含「如图/下图/图所示」或题目相关段落配有插图占位行（〔插图:…〕）的题，必须与所有题一样逐题转换（插图按第 5 条还原）；因为题里有图、读不了图就跳过整道题，是比漏选项严重得多的错误。
7. **共享材料组**（试卷中多篇小题共用的原文：阅读文章、完形语篇、翻译原文、新题型文章）：先输出材料块（@@Q material=1 + @@P body，原文档有参考译文才加 @@P trans），随后紧跟依附它的小题，小题 @@Q 行加 group=prev；独立成题（作文等无共享原文）不加 group。英语题型约定：完形填空用 type="cloze"（材料正文里保留空位编号如 __1__；每空一组 @@P slot-opt（该空选项）/@@P slot-ans（该空正确字母），组内顺序即空号顺序）；新题型（七选五/排序/标题匹配/多项对应）用 type="match"（候选池每个候选一个 @@P opt，@@P ans 写槽位顺序对应的字母串如 D|A|G|E|B）；作文用 type="essay"（题干=题目要求，图片随题走，省略 @@P ans，解析写范文）；翻译用 type="trans"（题干=原句/原段，@@P ans=参考译文，解析写采分点解析；逐句考查的每句一个题块、共用同一材料块并加 group=prev）。分批转换时若本批只有材料没有题目、或只有题目没有材料，仍照常输出（group=prev 引用的是最终文档里其前的材料块）。
内容筛选（只出可考查的练习题，以下内容一律跳过、不得转成题目）：
- 讲义正文里夹带的**例题**（「例 1」「例 2」「【例】」「例题」等）及其示范解答——例题是讲解演示，不是练习，整段跳过。**例外：习题册的答案/解答不算例题**——「答案」「题解」类标题下、只有【解】【证】【分析】等求解过程的段落是练习内容而非讲解演示：把其中每道解答还原成**一道**完整题目输出（一解答只对应一题，求解过程写进解析），同样遵守第 4 条一题对一题；
- 章节开头的**引言/导读/学习目标**（「本章将介绍…」「学习目标」「导读」）——开场白没有可考知识点；
- 章末的**小结/重点回顾/知识框架/思维导图**（「本章小结」「重点回顾」「知识框架」）——收尾总结不出题；
判断依据是内容性质而非标题字面：讲解正文里附带完整解答的演示题即例题，习题册答案区的解答不是；只对知识做归纳梳理、无新考点的首尾段落即引言或小结。跳过这些内容后，按剩余正文的知识点正常出题。${fillRule}${stepsRule}${knowRuleBlock}

文档内容：
${source}${knowList}`;
}

/** 解析 AI 的判定（CAN_CONVERT / REASON 行）。 */
export function parseVerdict(reply: string): { can: boolean; reason: string } {
    const vm = /CAN_CONVERT\s*[:：]\s*(yes|no|是|否|true|false)/i.exec(reply);
    const can = vm !== null ? /^(yes|是|true)$/i.test(vm[1]) : /@@Q\b/.test(reply);
    const rm = /REASON\s*[:：]\s*([^\n]+)/i.exec(reply);
    return { can, reason: (rm?.[1] ?? "").trim() };
}

/** 该块 kramdown 是否是材料超级块（不占题目数）。 */
export function isMaterialKramdown(kd: string): boolean {
    return kd.includes('custom-plugin-wengu-material="1"');
}
