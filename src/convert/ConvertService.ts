import { fetchSyncPost } from "siyuan";
import { Attr } from "../siyuan/attrs";
import { KernelBlock } from "../siyuan/block";
import { shuffleChoiceOptions } from "./OptionShuffle";

/**
 * AI 转换服务：把一篇笔记文档交给思源内置智能体（AgentClient，
 * 可指定用户在 设置→AI 配置的任一模型），按 docs/question-block-contract.md
 * 的契约生成题目块，落成独立的《原标题·习题》文档。
 *
 * 全部机制已在真机（思源 3.8.0）验证：
 * - /api/filetree/createDocWithMd 会用内核 Lute 解析 kramdown，
 *   超级块 IAL 必须另起一行紧跟在 }}} 之后才能落属性；
 * - 块级公式须用 $$...$/$...$ 记法，[ ] 里的 ^ 会丢。
 */

/** 文档定位信息。 */
export interface DocInfo {
    id: string;
    /** 笔记本 id。 */
    notebook?: string;
    /** 标题路径（如 /MinerU/书名/章节）。定位父级必须用它：内核按
     *  **标题**匹配 createDocWithMd 的路径段，用 .sy 文件路径拼段会让
     *  导入文档（文件名≠标题）被重建一串空父文档（真机踩坑）。 */
    hPath?: string;
    /** 文档标题。 */
    title: string;
}

/** AI 转换结果。 */
export interface ConvertResult {
    /** AI 判定能否转换。 */
    canConvert: boolean;
    /** 给用户看的结果说明（成功摘要 / 拒绝原因 / 失败原因）。 */
    message: string;
    /** 生成的习题文档 id（成功时）。 */
    docId?: string;
    /** 生成的习题文档标题（成功时）。 */
    title?: string;
    /** 生成题目数。 */
    count: number;
}

/**
 * 送入 AI 的单批内容上限（超长由 ConvertBatch 分批，本值是批大小）。
 * 真机实测：内核 AI 代理约 30 秒硬超时，12k 字符源会超时空返回；
 * 6k 字符约 22 秒稳定返回（12 题）。
 */
export const MAX_SOURCE_CHARS = 6000;

/** AI 调用超时（毫秒）：串行通道按空闲计（SSE 有 token 即续期），
 *  模型卡住时状态条报错，而不是永远「转换中」。 */
export const AI_TIMEOUT_MS = 300_000;

/** 并发直答通道（chatGPT 非流式）的总时长超时：慢模型大批次可能
 *  超过 5 分钟才整段返回（真机踩坑：总时长 5 分钟误杀长批次）。 */
export const AI_CONCURRENT_TIMEOUT_MS = 600_000;

/** 取文档定位信息（标题/笔记本/标题路径）。 */
export async function getDocInfo(docId: string): Promise<DocInfo | undefined> {
    const { data } = await fetchSyncPost("/api/query/sql", {
        stmt: `SELECT id, box, content FROM blocks WHERE id = '${docId}' AND type = 'd' LIMIT 1`,
    });
    const row = (data as { id: string; box: string; content: string }[] | null)?.[0];
    if (!row) return undefined;
    const info: DocInfo = { id: row.id, notebook: row.box, title: row.content || "未命名" };
    const loc = await fetchSyncPost("/api/filetree/getHPathByID", { id: docId });
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
    return m ? m[1] : input.trim();
}

/** 出题 prompt（格式规则全部真机验证，改动前先回归 createDocWithMd 落盘）。
 *  knowRule/knowList 是知识点反链的追加插槽（KnowledgeLink 路由出小节时才有值）。 */
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
11. 填空转选择：原文中的填空题一律改写为 type="single" 的单选题——题干中的空格（____/（ ））改为（ ），正确答案即原空格答案，再编写 3 个与正确答案同类、似是而非但有明确错误的干扰项作为其余选项；解析里说明原填空答案。`
        : "";
    // 大题拆多步：可分解的工科大题 → 多步引导题（method/result 步）
    const stepsRule = bigToSteps
        ? `

多步引导题（type="steps"）的 kramdown 格式（方法步 + 结果步，作答在插件里逐步进行）：
{{{row
计算大题题干……求 $\\lim_{x \\to 0}\\frac{\\sin x}{x}$
{: custom-plugin-wengu-part="stem"}

第 1 步 · 选择方法：求解本题可行的方法是（ ）
{: custom-plugin-wengu-part="step-0-stem"}

- A. 洛必达法则
- B. 等价无穷小代换
{: custom-plugin-wengu-part="step-0-option-0"}

> AB
{: custom-plugin-wengu-part="step-0-answer"}

第 2 步 · 等价无穷小代换：本步化简得（ ）
{: custom-plugin-wengu-part="step-1-stem"}

- A. $1$
- B. $0$
- C. $\\infty$
- D. $x$
{: custom-plugin-wengu-part="step-1-option-0"}

> A
{: custom-plugin-wengu-part="step-1-answer"}

> 完整解析（含每一步的推导）
{: custom-plugin-wengu-part="solution"}
}}}
{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="steps" custom-plugin-wengu-steps="method|result" custom-plugin-wengu-knowledge="考点" custom-plugin-wengu-chapter="章节"}

13. 大题拆多步：原文中可分解的工科大题（计算/求值/化简，每步有确定的中间结果）改写为 type="steps" 的多步引导题——选定一条典型参考路径拆 2~5 步；方法分歧处设 method 步（选项为候选方法，answer 写**全部可行方法**的字母集合如 AB，任选可行即对）；其余为 result 步考该步的中间结果，answer 写唯一正确字母，干扰项来自常见计算错误；每步 3~4 个选项，结果步的引导语写明所用方法（如「第 2 步 · 等价无穷小代换：本步得（ ）」）；容器必须带 custom-plugin-wengu-steps="method|result|…" 属性按序声明每步类型；论述/证明/开放等不可分解的题仍用 type="brief"。`
        : "";
    return `你是思源笔记的出题助手。把下面的文档内容转换成刷题题目块。

判断该文档是否适合出题（有可考查的知识点、内容足够具体）。

输出严格遵守以下格式，格式之外不要输出任何文字：
CAN_CONVERT: yes 或 no
REASON: 一句话说明（不能转换时说明原因，能转换时概括题目覆盖范围）
QUESTIONS:
（每道题一个超级块，直接输出 kramdown）

题目块 kramdown 格式（必须逐字符遵守，注意：不需要「我的答案」块，作答在插件里进行）：
{{{row
题干文字，公式用 $...$
{: custom-plugin-wengu-part="stem"}

- A. 选项一
- B. 选项二
{: custom-plugin-wengu-part="option-0"}

> 正确答案：B
{: custom-plugin-wengu-part="answer"}

> 解析文字
{: custom-plugin-wengu-part="solution"}
}}}
{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single" custom-plugin-wengu-knowledge="考点" custom-plugin-wengu-chapter="章节"}
${stepsRule}
10. **共享材料组（试卷中多篇小题共用的原文：阅读文章、完形语篇、翻译原文、新题型文章）**：先把材料输出成材料超级块，随后紧跟依附它的小题；这些小题的容器属性必须加 custom-plugin-wengu-group="prev"（表示材料=文中紧邻其前的材料块），独立成题（作文等无共享原文）不写 group。材料块格式（正文可多段，都用 part="body"；参考译文原文档有才写，用 part="trans"）：
{{{row
共享原文……
{: custom-plugin-wengu-part="body"}

参考译文全文（原文档没有就省略这一段）
{: custom-plugin-wengu-part="trans"}
}}}
{: custom-plugin-wengu-material="1"}
英语题型约定：完形填空用 type="cloze"（材料正文里保留空位编号如 __1__；题块内每空一组子块——slot-{k}-option-0 一块可含多个列表条目选项、slot-{k}-answer 写该空正确字母，k 从 0 递增，组内顺序即空号顺序）；新题型（七选五/排序/标题匹配/多项对应）用 type="match"（候选池写 option-0/option-1… 各一块，answer 写槽位顺序对应的字母串如 D|A|G|E|B）；作文（大小作文/应用文）用 type="essay"（题干=题目要求，图片随题走，answer 省略，solution 写范文）；翻译用 type="trans"（题干=原句/原段，answer=参考译文，solution 写采分点解析；逐句考查的每句一个题块、共用同一材料块并写 group="prev"）。分批转换时若本批只有材料没有题目、或只有题目没有材料，仍照常输出（题块 group="prev" 引用的是最终文档里其前的材料块）。
硬性规则：
1. 容器超级块以 {{{row 开始、}}} 结束；容器属性 {: ...} 必须另起一行紧跟在 }}} 之后，该行只包含 {: ...}。
2. type 取 single/multiple/judge/fill/brief/steps/cloze/match/essay/trans（steps 见第 13 条格式，材料组与英语题型见第 10 条）；单选多选 answer 写字母（如 B / AD），判断写 √ 或 ×，填空用 | 分隔多个可接受答案，简答写要点。
3. 子块 part 取 stem/option-0/answer/solution（steps 题另有 step-{k}-stem/step-{k}-option-0/step-{k}-answer，见第 13 条；材料块另有 body/trans，cloze 题另有 slot-{k}-option-0/slot-{k}-answer，见第 10 条；不要生成 mine 作答块）；题干可多段（都用 part="stem"）。
4. difficulty 为可选项：原文档/题目有明确难度线索才写（1~5），没有就整个省略，不要编造。
5. 公式写法：行内用 $...$，块级用 $$...$$ 各占一行；禁止使用 \\[ \\] 记法。
6. 保留原文的公式与代码；一个选项块里可以写多个选项。
7. 题量：若原文档本身是试卷/题库（已有现成题目），必须**逐题全部**转换——不得限量、不得合并、不得漏题，也不得自行新造题目；若是讲义/笔记，按知识点出题：内容少时至少 1 道，丰富时 5~12 道，覆盖主要知识点。
8. **插图必须随题走**：原文档里的图片行（![](...assets/...)）是该题依赖的插图（电路图/方框图/几何图等）时，把图片行**原样逐字复制**进对应题——单独成段、路径与文件名一个字符都不能改。题目本身依赖的图（原理示意图/结构图，题干常写「如图/下图/图所示」）放**题干**（紧跟题干文字段之后，标记 part="stem"）；答案/解析里给出的图（如解答画出的方框图）放**解析**（标记 part="solution"），不放题干。没有插图的题**不要**编造图片行。
9. **禁止跳过带图题**：题干含「如图/下图/图所示」或题目相关段落配有图片行的题，必须与所有题一样逐题转换（插图按第 8 条处理）；因为题里有图、读不了图就跳过整道题，是比漏选项严重得多的错误。${fillRule}${knowRuleBlock}

文档内容：
${source}${knowList}`;
}

/** 解析 AI 的判定（CAN_CONVERT / REASON 行）。 */
export function parseVerdict(reply: string): { can: boolean; reason: string } {
    const vm = /CAN_CONVERT\s*[:：]\s*(yes|no|是|否|true|false)/i.exec(reply);
    const can = vm !== null ? /^(yes|是|true)$/i.test(vm[1]) : /QUESTIONS\s*[:：]/.test(reply);
    const rm = /REASON\s*[:：]\s*([^\n]+)/i.exec(reply);
    return { can, reason: (rm?.[1] ?? "").trim() };
}

/**
 * 抽取回复里所有带 q 容器属性的题目超级块与材料超级块
 * （custom-plugin-wengu-material="1"，材料组见第 10 条），并做几处规整
 * （真机实测 AI 的高频偏差）：
 * - q 属性自增（q="2"、q="3"…）→ 统一改回契约的 q="1"（SQL 按 '1' 检测）；
 * - 子块 part 属性漏右引号（part="solution}）→ 补上；
 * - 题干带「题干A：」前缀标签（及紧随的悬空 `**`）→ 入库前剥掉；
 * - AI 从原文 kramdown 抄来的噪声行（块 id IAL、嵌套超级块定界）→ 剥掉。
 * 材料块与题目块按出现顺序混排（group="prev" 依赖「材料在前、题目紧随」）。
 */
function extractQuestions(reply: string): string[] {
    const idx = reply.search(/QUESTIONS\s*[:：]/);
    const body = idx >= 0 ? reply.slice(idx) : reply;
    const re = /\{\{\{row[\s\S]*?\}\}\}\s*\n\s*\{:[^\n]*custom-plugin-wengu-(?:q|material)="[^"]+"[^\n]*\}/g;
    const out: string[] = [];
    for (const m of body.matchAll(re)) {
        out.push(m[0].trim());
    }
    return out
        .map((q) =>
            q
                .replace(/custom-plugin-wengu-q="\d+"/, 'custom-plugin-wengu-q="1"')
                .replace(/custom-plugin-wengu-part="([a-z0-9-]+)\}/g, 'custom-plugin-wengu-part="$1"}')
                .replace(/^[ \t]*题干\s*[A-Za-z0-9]?[ \t]*[：:][ \t]*(?:\*\*[ \t]*)?/gm, "")
                .replace(/^[ \t]*(?:>[ \t]*)?\{:[^}\n]*\bid="[^"]*"[^\n]*$/gm, (line) =>
                    /custom-plugin-wengu-/.test(line) ? line : ""
                )
                .split("\n")
                .filter((line, i) => !/^[ \t]*(?:>[ \t]*)?\{\{\{/.test(line) || i === 0)
                .filter((line, i, ls) => {
                    if (!/^[ \t]*(?:>[ \t]*)?\}\}\}/.test(line)) return true;
                    // 容器自身的收尾 }}}（其后紧跟容器 IAL）保留，嵌套的剥掉
                    return /^\s*\{:[^}]*custom-plugin-wengu-(?:q|material)=/.test(ls[i + 1] ?? "");
                })
                .join("\n")
        )
        .map(shuffleChoiceOptions);
}

/** 该块 kramdown 是否是材料超级块（不占题目数）。 */
export function isMaterialKramdown(kd: string): boolean {
    return kd.includes('custom-plugin-wengu-material="1"');
}

/** 抽取并规整一批回复里的题目块与材料块（AI 偏差规整见上）。 */
export function extractBatchQuestions(reply: string): string[] {
    return extractQuestions(reply).filter((q) => q.includes('part="stem"') || isMaterialKramdown(q));
}

/** "/a/b.sy" → "/a"；"/x.sy" → "/"。 */
export function parentOf(path: string): string {
    const cut = path.lastIndexOf("/");
    return cut <= 0 ? "/" : path.slice(0, cut);
}

/** 生成位置解析结果：ok=false 时 message 有值。 */
export interface TargetLocation {
    ok: boolean;
    notebook: string;
    parentPath: string;
    message: string;
}

/** 解析生成位置：targetRaw 空=原文档同目录（父级用 hPath 标题路径——
 *  内核按标题匹配路径段，.sy 文件路径会让导入文档被重建空父链）；
 *  指定父文档时生成到它下面（子文档，笔记本跟随目标）。 */
export async function resolveTarget(
    info: DocInfo,
    targetRaw: string,
    t: (key: string) => string
): Promise<TargetLocation> {
    if (!targetRaw) {
        return { ok: true, notebook: info.notebook ?? "", parentPath: parentOf(info.hPath ?? "/"), message: "" };
    }
    const target = await getDocInfo(extractBlockId(targetRaw));
    if (!target?.notebook || !target.hPath) {
        return { ok: false, notebook: "", parentPath: "", message: t("convertTargetMissing") };
    }
    return { ok: true, notebook: target.notebook, parentPath: target.hPath, message: "" };
}

/** 生成《标题·习题》文档；先去掉已有的 ·习题 后缀避免「·习题·习题」，同名冲突追加时间戳。
 *  srcDocId 非空时在根块打 source-doc 配对属性（源删则习题随删，见 OrphanCleaner）。 */
export async function createExerciseDoc(
    notebook: string,
    parentPath: string,
    baseTitle: string,
    markdown: string,
    srcDocId = ""
): Promise<{ id: string; title: string }> {
    const safe =
        baseTitle
            .replace(/[\\/:*?"<>|]/g, "-")
            .replace(/(·习题)+$/, "")
            .trim() || "习题";
    const created = await createDocWithTitles(
        notebook,
        parentPath,
        [`${safe}·习题`, `${safe}·习题${Date.now().toString(36)}`],
        markdown
    );
    if (srcDocId) {
        await fetchSyncPost("/api/attr/setBlockAttrs", { id: created.id, attrs: { [Attr.sourceDoc]: srcDocId } });
    }
    return created;
}

/** 向文档末尾追加单个块（markdown）。IAL 必须独立成行才落块属性；
 *  一次一块——多块数据会散落错位（20260826 真机验证见 AGENTS.md）。 */
export async function appendBlockToDoc(docId: string, blockMd: string): Promise<void> {
    const res = await KernelBlock.append({ dataType: "markdown", data: blockMd, parentID: docId });
    if (res.code !== 0) throw new Error(res.msg || "appendBlock failed");
}

/** 按候选标题顺序建文档，同名冲突落到下一个（时间戳后缀）。 */
async function createDocWithTitles(
    notebook: string,
    parentPath: string,
    titles: string[],
    markdown: string
): Promise<{ id: string; title: string }> {
    let lastMsg = "";
    for (const title of titles) {
        const path = `${parentPath === "/" ? "" : parentPath}/${title}.sy`;
        const res = await fetchSyncPost("/api/filetree/createDocWithMd", { notebook, path, markdown });
        if (res.code === 0 && res.data) {
            return { id: String(res.data), title };
        }
        lastMsg = res.msg;
    }
    throw new Error(lastMsg || "createDocWithMd failed");
}

/** 文档是否有子文档（任一后代层级）。原位替换会连子文档一起删，必须先拦。 */
export async function hasChildDocs(docId: string): Promise<boolean> {
    const { data } = await fetchSyncPost("/api/query/sql", {
        stmt: `SELECT box, path FROM blocks WHERE id = '${docId}' AND type = 'd' LIMIT 1`,
    });
    const row = (data as { box?: string; path?: string }[] | null)?.[0];
    if (!row?.box || !row.path) return false;
    const { data: children } = await fetchSyncPost("/api/query/sql", {
        stmt: `SELECT COUNT(*) AS n FROM blocks
            WHERE type = 'd' AND box = '${row.box}' AND path LIKE '${row.path}/%' LIMIT 1`,
    });
    return Number((children as { n?: number }[] | null)?.[0]?.n ?? 0) > 0;
}

/** 原位替换失败原因：原文档已删 / 写盘时刻发现有子文档。 */
export type ReplaceInplaceReason = "noDoc" | "hasChildren";

export class ReplaceInplaceError extends Error {
    constructor(public readonly reason: ReplaceInplaceReason) {
        super(reason);
    }
}

/**
 * 原位替换：删除原文档（进回收站，可恢复）→ 同路径同标题重建为题目版。
 * 内核没有可靠的「改写已有文档内容」通道（updateBlock 多块并段/丢段、
 * transactions insert 静默无效，20260822 真机验证），原位只能删旧重建，
 * 文档 id 会变——这些文档只作插件的题库底座，无外部引用场景。
 *
 * 转换耗时数分钟，调用方传入的 info 是开始时的快照——写盘时刻
 * **重查**文档当前位置与子文档（中途移动/重命名/建子文档都按当下
 * 状态处理：位置与标题跟新，发现子文档抛 hasChildren 拒绝）。
 * 另把旧「另存」习题文档的 source-doc 配对改指到新文档 id，否则
 * 旧 id 消失会让 OrphanCleaner 误判源已删、连删旧习题文档。
 */
export async function replaceDocInPlace(oldInfo: DocInfo, markdown: string): Promise<{ id: string; title: string }> {
    const fresh = await getDocInfo(oldInfo.id);
    if (!fresh?.notebook) throw new ReplaceInplaceError("noDoc");
    if (await hasChildDocs(fresh.id)) throw new ReplaceInplaceError("hasChildren");
    const safe = fresh.title.replace(/[\\/:*?"<>|]/g, "-").trim() || "习题";
    await fetchSyncPost("/api/filetree/removeDocByID", { id: fresh.id });
    const created = await createDocWithTitles(
        fresh.notebook,
        parentOf(fresh.hPath ?? "/"),
        [safe, `${safe}·${Date.now().toString(36)}`],
        markdown
    );
    await repointSourcePairs(fresh.id, created.id);
    return created;
}

/** 旧「另存」习题文档的配对源改指到原位重建后的新文档。 */
async function repointSourcePairs(oldDocId: string, newDocId: string): Promise<void> {
    const { data } = await fetchSyncPost("/api/query/sql", {
        stmt: `SELECT block_id AS id FROM attributes WHERE name = '${Attr.sourceDoc}' AND value = '${oldDocId}'`,
    });
    for (const row of (data ?? []) as { id?: string }[]) {
        if (row.id) {
            await fetchSyncPost("/api/attr/setBlockAttrs", { id: row.id, attrs: { [Attr.sourceDoc]: newDocId } });
        }
    }
}

/** 终止保留 / 继续生成完成后的落盘：把累积 kramdown 建成习题文档。 */
export async function writeExerciseDoc(
    info: DocInfo,
    markdown: string,
    srcDocId = "",
    targetRaw = "",
    t: (key: string) => string = () => ""
): Promise<{ id: string; title: string }> {
    const loc = await resolveTarget(info, targetRaw, t);
    if (!loc.ok) throw new Error(loc.message);
    return createExerciseDoc(loc.notebook, loc.parentPath, info.title, markdown, srcDocId);
}

/** 继续生成完成后删掉上次终止保留的旧文档（换成完整新文档）。 */
export async function removeDoc(docId: string): Promise<void> {
    try {
        await fetchSyncPost("/api/filetree/removeDocByID", { id: docId });
    } catch (_) {
        // 删除失败不影响主流程（旧文档保留）
    }
}

/** 单发结果包装（兼容弹窗的 onDone 汇报；参数按 BatchResult 结构收）。 */
export function toConvertResult(r: {
    status: string;
    message: string;
    docId?: string;
    title?: string;
    count: number;
}): ConvertResult {
    return {
        canConvert: r.status === "done",
        message: r.message,
        docId: r.docId,
        title: r.title,
        count: r.count,
    };
}
