import { fetchSyncPost } from "siyuan";
import { Attr } from "./attrs";

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

/** AI 调用超时（毫秒）：模型卡住时状态条报错，而不是永远「转换中」。 */
export const AI_TIMEOUT_MS = 300_000;

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

/** 出题 prompt（格式规则全部真机验证，改动前先回归 createDocWithMd 落盘）。 */
export function buildPrompt(source: string, fillToChoice = false, bigToSteps = false): string {
    // 填空转选择：一次对话内完成（不需要额外一轮 AI 调用）
    const fillRule = fillToChoice
        ? `
10. 填空转选择：原文中的填空题一律改写为 type="single" 的单选题——题干中的空格（____/（ ））改为（ ），正确答案即原空格答案，再编写 3 个与正确答案同类、似是而非但有明确错误的干扰项作为其余选项；解析里说明原填空答案。`
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

11. 大题拆多步：原文中可分解的工科大题（计算/求值/化简，每步有确定的中间结果）改写为 type="steps" 的多步引导题——选定一条典型参考路径拆 2~5 步；方法分歧处设 method 步（选项为候选方法，answer 写**全部可行方法**的字母集合如 AB，任选可行即对）；其余为 result 步考该步的中间结果，answer 写唯一正确字母，干扰项来自常见计算错误；每步 3~4 个选项，结果步的引导语写明所用方法（如「第 2 步 · 等价无穷小代换：本步得（ ）」）；容器必须带 custom-plugin-wengu-steps="method|result|…" 属性按序声明每步类型；论述/证明/开放等不可分解的题仍用 type="brief"。`
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
硬性规则：
1. 容器超级块以 {{{row 开始、}}} 结束；容器属性 {: ...} 必须另起一行紧跟在 }}} 之后，该行只包含 {: ...}。
2. type 取 single/multiple/judge/fill/brief/steps（steps 见第 11 条格式）；单选多选 answer 写字母（如 B / AD），判断写 √ 或 ×，填空用 | 分隔多个可接受答案，简答写要点。
3. 子块 part 取 stem/option-0/answer/solution（steps 题另有 step-{k}-stem/step-{k}-option-0/step-{k}-answer，见第 11 条；不要生成 mine 作答块）；题干可多段（都用 part="stem"）。
4. difficulty 为可选项：原文档/题目有明确难度线索才写（1~5），没有就整个省略，不要编造。
5. 公式写法：行内用 $...$，块级用 $$...$$ 各占一行；禁止使用 \\[ \\] 记法。
6. 保留原文的公式与代码；一个选项块里可以写多个选项。
7. 题量：若原文档本身是试卷/题库（已有现成题目），必须**逐题全部**转换——不得限量、不得合并、不得漏题，也不得自行新造题目；若是讲义/笔记，按知识点出题：内容少时至少 1 道，丰富时 5~12 道，覆盖主要知识点。
8. **插图必须随题走**：原文档里的图片行（![](...assets/...)）是该题依赖的插图（电路图/方框图/几何图等）时，把图片行**原样逐字复制**到该题的题干里——单独成段、紧跟题干文字段之后，同样标记 part="stem"；路径与文件名一个字符都不能改，没有插图的题**不要**编造图片行。${fillRule}

文档内容：
${source}`;
}

/** 解析 AI 的判定（CAN_CONVERT / REASON 行）。 */
export function parseVerdict(reply: string): { can: boolean; reason: string } {
    const vm = /CAN_CONVERT\s*[:：]\s*(yes|no|是|否|true|false)/i.exec(reply);
    const can = vm !== null ? /^(yes|是|true)$/i.test(vm[1]) : /QUESTIONS\s*[:：]/.test(reply);
    const rm = /REASON\s*[:：]\s*([^\n]+)/i.exec(reply);
    return { can, reason: (rm?.[1] ?? "").trim() };
}

/**
 * 抽取回复里所有带 q 容器属性的题目超级块，并做几处规整
 * （真机实测 AI 的高频偏差）：
 * - q 属性自增（q="2"、q="3"…）→ 统一改回契约的 q="1"（SQL 按 '1' 检测）；
 * - 子块 part 属性漏右引号（part="solution}）→ 补上；
 * - 题干带「题干A：」前缀标签（及紧随的悬空 `**`）→ 入库前剥掉。
 */
function extractQuestions(reply: string): string[] {
    const idx = reply.search(/QUESTIONS\s*[:：]/);
    const body = idx >= 0 ? reply.slice(idx) : reply;
    const re = /\{\{\{row[\s\S]*?\}\}\}\s*\n\s*\{:[^\n]*custom-plugin-wengu-q="\d+"[^\n]*\}/g;
    const out: string[] = [];
    for (const m of body.matchAll(re)) {
        out.push(m[0].trim());
    }
    return out.map((q) =>
        q
            .replace(/custom-plugin-wengu-q="\d+"/, 'custom-plugin-wengu-q="1"')
            .replace(/custom-plugin-wengu-part="([a-z0-9-]+)\}/g, 'custom-plugin-wengu-part="$1"}')
            .replace(/^[ \t]*题干\s*[A-Za-z0-9]?[ \t]*[：:][ \t]*(?:\*\*[ \t]*)?/gm, "")
    );
}

/** 抽取并规整一批回复里的题目块（AI 偏差规整见上）。 */
export function extractBatchQuestions(reply: string): string[] {
    return extractQuestions(reply).filter((q) => q.includes('part="stem"'));
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
    const titles = [`${safe}·习题`, `${safe}·习题${Date.now().toString(36)}`];
    let lastMsg = "";
    for (const title of titles) {
        const path = `${parentPath === "/" ? "" : parentPath}/${title}.sy`;
        const res = await fetchSyncPost("/api/filetree/createDocWithMd", { notebook, path, markdown });
        if (res.code === 0 && res.data) {
            const id = String(res.data);
            if (srcDocId) {
                await fetchSyncPost("/api/attr/setBlockAttrs", { id, attrs: { [Attr.sourceDoc]: srcDocId } });
            }
            return { id, title };
        }
        lastMsg = res.msg;
    }
    throw new Error(lastMsg || "createDocWithMd failed");
}
