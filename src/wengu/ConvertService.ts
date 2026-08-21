import {fetchSyncPost} from "siyuan";

/**
 * AI 转换服务：把一篇笔记文档交给思源自带 AI（/api/ai/chatGPT，
 * 用户在 设置→AI 里配置的模型），按 docs/question-block-contract.md
 * 的契约生成题目块，落成独立的《原标题·习题》文档。
 *
 * 全部机制已在真机（思源 3.8.0）验证：
 * - /api/ai/chatGPT 收 {msg} 返回 {code, data: 完整回复文本}；
 * - /api/filetree/createDocWithMd 会用内核 Lute 解析 kramdown，
 *   超级块 IAL 必须另起一行紧跟 }}} 之后才能落属性；
 * - 块级公式须用 $$...$$（\[...\] 里的 ^ 会被解析成 <sup> 丢失）。
 */

/** 文档定位信息。 */
export interface DocInfo {
    id: string;
    /** 笔记本 id。 */
    notebook?: string;
    /** 文档 .sy 路径。 */
    path?: string;
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
 * 送入 AI 的文档内容上限（超长截断）。真机实测：内核 AI 代理约 30 秒
 * 硬超时，12k 字符源会超时空返回；6k 字符约 22 秒稳定返回（12 题）。
 */
const MAX_SOURCE_CHARS = 6000;

/** AI 调用超时（毫秒）：模型卡住时状态条报错，而不是永远「转换中」。 */
const AI_TIMEOUT_MS = 300_000;

/** 取文档定位信息（标题/笔记本/路径）。 */
export async function getDocInfo(docId: string): Promise<DocInfo | undefined> {
    const {data} = await fetchSyncPost("/api/query/sql", {
        stmt: `SELECT id, box, content FROM blocks WHERE id = '${docId}' AND type = 'd' LIMIT 1`,
    });
    const row = (data as {id: string; box: string; content: string;}[] | null)?.[0];
    if (!row) return undefined;
    const info: DocInfo = {id: row.id, notebook: row.box, title: row.content || "未命名"};
    const loc = await fetchSyncPost("/api/filetree/getPathByID", {id: docId});
    info.path = (loc.data as {path?: string;} | null)?.path;
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

/**
 * 把文档转换成习题文档。AI 先判定能不能转（不能则带原因返回），
 * 能则解析其题目块并生成《原标题·习题》同级文档。
 */
export async function convertDocToQuestions(docIdRaw: string, t: (key: string) => string): Promise<ConvertResult> {
    const docId = extractBlockId(docIdRaw);
    const info = await getDocInfo(docId);
    if (!info?.notebook) {
        return {canConvert: false, message: t("convertNoDoc"), count: 0};
    }
    const kd = await fetchSyncPost("/api/block/getBlockKramdown", {id: docId});
    const kramdown = String((kd.data as {kramdown?: string;} | null)?.kramdown ?? "");
    if (!kramdown.trim()) {
        return {canConvert: false, message: t("convertEmptyDoc"), count: 0};
    }
    const source = kramdown.length > MAX_SOURCE_CHARS ?
        `${kramdown.slice(0, MAX_SOURCE_CHARS)}\n<!-- 内容过长已截断 -->` :
        kramdown;

    const ai = await Promise.race([
        fetchSyncPost("/api/ai/chatGPT", {msg: buildPrompt(source)}),
        new Promise((resolve) => setTimeout(() => resolve({code: -1, msg: "timeout"}), AI_TIMEOUT_MS)),
    ]) as {code: number; msg: string; data: unknown;};
    if (ai.code !== 0) {
        const reason = ai.msg === "timeout" ? t("convertTimeout") : ai.msg;
        return {canConvert: false, message: `${t("convertAiFailed")}${reason}`, count: 0};
    }
    const reply = String(ai.data ?? "");
    if (!reply.trim()) {
        // 内核代理 30 秒硬超时会这样返回：code 0 但内容为空
        return {canConvert: false, message: t("convertEmptyReply"), count: 0};
    }
    const verdict = parseVerdict(reply);
    const questions = extractQuestions(reply).filter((q) => q.includes('part="stem"'));
    if (!verdict.can) {
        return {canConvert: false, message: verdict.reason || t("convertRefused"), count: 0};
    }
    if (questions.length === 0) {
        return {canConvert: false, message: t("convertNoQuestions"), count: 0};
    }

    const parentPath = parentOf(info.path ?? "/");
    const created = await createExerciseDoc(info.notebook, parentPath, info.title, questions.join("\n\n"));
    return {
        canConvert: true,
        message: `${verdict.reason}`,
        docId: created.id,
        title: created.title,
        count: questions.length,
    };
}

/** 出题 prompt（格式规则全部真机验证，改动前先回归 createDocWithMd 落盘）。 */
function buildPrompt(source: string): string {
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
{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single" custom-plugin-wengu-knowledge="考点" custom-plugin-wengu-chapter="章节" custom-plugin-wengu-difficulty="3"}

硬性规则：
1. 容器超级块以 {{{row 开始、}}} 结束；容器属性 {: ...} 必须另起一行紧跟在 }}} 之后，该行只包含 {: ...}。
2. type 取 single/multiple/judge/fill/brief；单选多选 answer 写字母（如 B / AD），判断写 √ 或 ×，填空用 | 分隔多个可接受答案，简答写要点。
3. 子块 part 取 stem/option-0/answer/solution（不要生成 mine 作答块）；题干可多段（都用 part="stem"）。
4. 公式写法：行内用 $...$，块级用 $$...$$ 各占一行；禁止使用 \\[ \\] 记法。
5. 保留原文的公式与代码；一个选项块里可以写多个选项。
6. 题量与文档内容相称：内容少时至少 1 道，内容丰富时 5~10 道，覆盖主要知识点。

文档内容：
${source}`;
}

/** 解析 AI 的判定（CAN_CONVERT / REASON 行）。 */
function parseVerdict(reply: string): {can: boolean; reason: string;} {
    const vm = /CAN_CONVERT\s*[:：]\s*(yes|no|是|否|true|false)/i.exec(reply);
    const can = vm !== null ?
        /^(yes|是|true)$/i.test(vm[1]) :
        /QUESTIONS\s*[:：]/.test(reply);
    const rm = /REASON\s*[:：]\s*([^\n]+)/i.exec(reply);
    return {can, reason: (rm?.[1] ?? "").trim()};
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

/** "/a/b.sy" → "/a"；"/x.sy" → "/"。 */
function parentOf(path: string): string {
    const cut = path.lastIndexOf("/");
    return cut <= 0 ? "/" : path.slice(0, cut);
}

/** 生成《标题·习题》文档；先去掉已有的 ·习题 后缀避免「·习题·习题」，同名冲突追加时间戳。 */
async function createExerciseDoc(
    notebook: string,
    parentPath: string,
    baseTitle: string,
    markdown: string,
): Promise<{id: string; title: string;}> {
    const safe = baseTitle.replace(/[\\/:*?"<>|]/g, "-").replace(/(·习题)+$/, "").trim() || "习题";
    const titles = [`${safe}·习题`, `${safe}·习题${Date.now().toString(36)}`];
    let lastMsg = "";
    for (const title of titles) {
        const path = `${parentPath === "/" ? "" : parentPath}/${title}.sy`;
        const res = await fetchSyncPost("/api/filetree/createDocWithMd", {notebook, path, markdown});
        if (res.code === 0 && res.data) {
            return {id: String(res.data), title};
        }
        lastMsg = res.msg;
    }
    throw new Error(lastMsg || "createDocWithMd failed");
}
