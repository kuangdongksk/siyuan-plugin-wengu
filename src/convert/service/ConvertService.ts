import { KernelQuery } from "../../siyuan/query";
import { KernelDoc } from "../../siyuan/doc";

/**
 * AI 转换服务的内核侧原语：源文档定位/读取与判定解析（出题 prompt
 * 20260910 起收口进 ai/prompts/convert）。20260903 起转换产物**直写
 * 题库**（SetWriter），本模块不再含任何落盘文档通道
 * （createExerciseDoc/appendBlockToDoc 等已随「不落文档」整体退役）。
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
