import {fetchSyncPost} from "siyuan";
import {agentChat} from "./AgentClient";
import {
    AI_TIMEOUT_MS,
    buildPrompt,
    createExerciseDoc,
    extractBatchQuestions,
    extractBlockId,
    getDocInfo,
    hasChildDocs,
    MAX_SOURCE_CHARS,
    parseVerdict,
    replaceDocInPlace,
    ReplaceInplaceError,
    resolveTarget,
} from "./ConvertService";
import type {
    ConvertResult,
    DocInfo,
} from "./ConvertService";
import {fmt} from "./ui";

/**
 * 分批转换编排（从 ConvertService 拆出）：长文档按空行边界切块逐批
 * 生成，批次结果累积在内存，完成（或终止保留）时一次性
 * createDocWithMd 落盘——真机 3.8.0 验证没有可靠的「追加到已有文档」
 * 通道（updateBlock 多块并一段/丢内容、transactions insert 无效），
 * 所以进度持久化只记「已生成到源文档的字符偏移 + 已保留内容」，
 * 继续生成 = 上次保留内容并入累积、从偏移处续跑剩余批。
 *
 * 落盘双模式（writeMode）：inplace=删原文档同路径同标题重建（原文进
 * 回收站）；newdoc=《标题·习题》另存新文档（旧默认，配 source-doc
 * 配对清理）。inplace 要求原文档无子文档。
 */

/** 单批字符上限（略小于 MAX_SOURCE_CHARS，给 prompt 头部留余量）。 */
const CHUNK_CHARS = 5000;

/** 源文档切块（确定性：同一切分规则，偏移可作为续跑标记）。 */
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
        if (text) out.push({text, offset: start});
        start = end;
    }
    return out;
}

/** 前置检测：能否出题 + 原文现成题目数（试卷题库才有意义）。 */
export interface DetectResult {
    can: boolean;
    reason: string;
    /** 原文现成题目数；讲义/无法判定为 undefined。 */
    count?: number;
}

/** 检测超时短一些：输出只有三行。 */
const DETECT_TIMEOUT_MS = 120_000;

export async function detectQuestions(
    source: string,
    modelId: string,
    signal?: AbortSignal,
): Promise<DetectResult> {
    const head = source.length > MAX_SOURCE_CHARS ?
        `${source.slice(0, MAX_SOURCE_CHARS)}\n<!-- 内容过长已截断 -->` :
        source;
    const reply = await agentChat(
        `你是思源笔记出题助手的前置检查。判断下面的文档是否适合出题，并统计其中现成题目的数量。
输出严格三行，格式之外不要输出任何文字：
CAN_CONVERT: yes 或 no
COUNT: 数字（原文中现成题目的总数；讲义/笔记等没有现成题目时输出 0；被截断无法计数时输出 unknown）
REASON: 一句话说明（注明文档类型：试卷题库或讲义笔记；不能转换时说明原因）
文档内容：
${head}`,
        modelId,
        DETECT_TIMEOUT_MS,
        signal,
    );
    const verdict = parseVerdict(reply);
    const cm = /COUNT\s*[:：]\s*(\d+|unknown)/i.exec(reply);
    const count = cm && /^\d+$/.test(cm[1]) ? Number(cm[1]) : undefined;
    return {can: verdict.can, reason: verdict.reason, count};
}

/** 转换进度回调（弹窗状态行展示）。 */
export interface ConvertProgress {
    /** detect=前置检测中；generating=逐批生成中；writing=落盘中。 */
    phase: "detect" | "generating" | "writing";
    /** 已完成批数。 */
    batch: number;
    /** 总批数。 */
    total: number;
    /** 已生成题数（累积）。 */
    count: number;
    /** 前置检测到的现成题数（未确定为空）。 */
    detected?: number;
}

/** 终止保留的进度记录（prefs 持久化，重开思源后可继续生成）。
 *  另存模式保留部分习题文档（docId）；原位模式原文档不动，已生成
 *  kramdown 直接存进记录（kramdown）。 */
export interface ConvertProgressRecord {
    /** 保留的（部分）习题文档 id（另存模式）。 */
    docId?: string;
    title: string;
    /** 已生成覆盖到的源文档字符偏移。 */
    offset: number;
    /** 已完成批数 / 总批数（展示用）。 */
    batches: number;
    total: number;
    /** 已生成题数。 */
    count: number;
    /** 已生成的题目 kramdown（原位模式续跑并入）。 */
    kramdown?: string;
}

/** 批式转换结果：done=全部完成；aborted=用户终止（未落盘）。 */
export interface BatchedResult {
    status: "done" | "aborted" | "failed";
    message: string;
    /** done 时的新习题文档。 */
    docId?: string;
    title?: string;
    count: number;
    /** 已完成批数 / 总批数。 */
    batches: number;
    total: number;
    /** 已生成覆盖到的源文档字符偏移（继续生成的断点）。 */
    doneOffset: number;
    /** 已累积的题目 kramdown（aborted 时由弹窗决定保留/丢弃）。 */
    kramdown: string;
}

/** 继续生成的入参：上次终止保留的进度。 */
export interface ResumeInfo {
    /** 已生成覆盖到的源文档偏移。 */
    offset: number;
    /** 上次保留的部分习题文档（另存模式，内容并入本次结果）。 */
    docId?: string;
    /** 上次保留的题目 kramdown（原位模式，内容并入本次结果）。 */
    kramdown?: string;
}

/** 分批转换主流程。终止时返回 aborted + 已累积内容（不落盘）。 */
export async function convertDocBatched(
    docIdRaw: string,
    opts: {
        t: (key: string) => string;
        modelId: string;
        fillToChoice: boolean;
        bigToSteps: boolean;
        signal?: AbortSignal;
        resume?: ResumeInfo;
        /** 落盘模式：inplace=原位替换原文档；newdoc=另存《·习题》（默认）。 */
        writeMode?: "inplace" | "newdoc";
        /** 生成位置（仅 newdoc）：空=原文档同目录；否则生成到指定父文档下面。 */
        targetRaw?: string;
        onProgress(p: ConvertProgress): void;
    },
): Promise<BatchedResult> {
    const {t} = opts;
    const docId = extractBlockId(docIdRaw);
    const info = await getDocInfo(docId);
    if (!info?.notebook) {
        return {
            status: "failed",
            message: t("convertNoDoc"),
            count: 0,
            batches: 0,
            total: 0,
            doneOffset: 0,
            kramdown: "",
        };
    }
    // 原位替换会连子文档一起删——有子文档直接拦，提示改走另存
    if (opts.writeMode === "inplace" && await hasChildDocs(docId)) {
        return {
            status: "failed",
            message: t("convertInplaceChildren"),
            count: 0,
            batches: 0,
            total: 0,
            doneOffset: 0,
            kramdown: "",
        };
    }
    const kd = await fetchSyncPost("/api/block/getBlockKramdown", {id: docId});
    const kramdown = String((kd.data as {kramdown?: string;} | null)?.kramdown ?? "");
    if (!kramdown.trim()) {
        return {
            status: "failed",
            message: t("convertEmptyDoc"),
            count: 0,
            batches: 0,
            total: 0,
            doneOffset: 0,
            kramdown: "",
        };
    }

    // 继续生成：上次保留内容并入累积（另存=旧部分文档 kramdown，
    // 原位=记录里的 kramdown），只跑剩余批
    let existing = "";
    if (opts.resume) {
        if (opts.resume.kramdown) {
            existing = opts.resume.kramdown;
        } else if (opts.resume.docId) {
            const old = await fetchSyncPost("/api/block/getBlockKramdown", {id: opts.resume.docId});
            existing = String((old.data as {kramdown?: string;} | null)?.kramdown ?? "");
        }
    }
    const allChunks = chunkKramdown(kramdown);
    const chunks = opts.resume ? allChunks.filter((c) => c.offset >= opts.resume!.offset) : allChunks;

    let detected: number | undefined;
    if (!opts.resume) {
        opts.onProgress({phase: "detect", batch: 0, total: chunks.length, count: 0});
        try {
            const d = await detectQuestions(kramdown, opts.modelId, opts.signal);
            if (!d.can) {
                return {
                    status: "failed",
                    message: d.reason || t("convertRefused"),
                    count: 0,
                    batches: 0,
                    total: chunks.length,
                    doneOffset: 0,
                    kramdown: "",
                };
            }
            detected = d.count;
        } catch (e) {
            if ((e as Error)?.name === "AbortError") {
                return {
                    status: "aborted",
                    message: "",
                    count: 0,
                    batches: 0,
                    total: chunks.length,
                    doneOffset: 0,
                    kramdown: existing.trim() ? existing : "",
                };
            }
            // 检测失败不阻断：继续逐批生成（批内仍有 CAN_CONVERT 兜底）
        }
    }

    const parts: string[] = [];
    let doneOffset = opts.resume?.offset ?? 0;
    let count = 0;
    for (let i = 0; i < chunks.length; i++) {
        opts.onProgress({phase: "generating", batch: i, total: chunks.length, count, detected});
        let reply: string;
        try {
            reply = await agentChat(
                buildPrompt(chunks[i].text, opts.fillToChoice, opts.bigToSteps),
                opts.modelId,
                AI_TIMEOUT_MS,
                opts.signal,
            );
        } catch (e) {
            const err = e as Error;
            if (err?.name === "AbortError") {
                return {
                    status: "aborted",
                    message: "",
                    count,
                    batches: i,
                    total: chunks.length,
                    doneOffset,
                    kramdown: [existing, ...parts].filter(Boolean).join("\n\n"),
                };
            }
            const reason = err?.name === "TimeoutError" ? t("convertTimeout") : String(err?.message ?? e);
            return {
                status: "failed",
                message: `${t("convertAiFailed")}${reason}`,
                count,
                batches: i,
                total: chunks.length,
                doneOffset,
                kramdown: [existing, ...parts].filter(Boolean).join("\n\n"),
            };
        }
        const questions = extractBatchQuestions(reply);
        if (questions.length > 0) {
            parts.push(questions.join("\n\n"));
            count += questions.length;
        }
        doneOffset = chunks[i].offset + chunks[i].text.length;
        opts.onProgress({phase: "generating", batch: i + 1, total: chunks.length, count, detected});
    }

    opts.onProgress({phase: "writing", batch: chunks.length, total: chunks.length, count, detected});
    const markdown = [existing, ...parts].filter(Boolean).join("\n\n");
    if (!markdown.trim()) {
        return {
            status: "failed",
            message: t("convertNoQuestions"),
            count: 0,
            batches: 0,
            total: 0,
            doneOffset: 0,
            kramdown: "",
        };
    }
    // 插图自检：源文档的图片行没被带进生成结果（真机案例：AI 读不了
    // 图、把带图题整题跳过），完成消息里附警告提示重新转换
    const srcImgs = new Set(kramdown.match(/!\[\]\([^)\s]+\)/g) ?? []);
    const outImgs = new Set(markdown.match(/!\[\]\([^)\s]+\)/g) ?? []);
    let missingImgs = 0;
    for (const img of srcImgs) {
        if (!outImgs.has(img)) missingImgs++;
    }
    const imgWarn = missingImgs > 0 ? ` ${fmt(t("convertImagesMissing"), {n: String(missingImgs)})}` : "";
    // 落盘：原位=删旧同路径同标题重建（不加 source-doc 配对——源即本文档）；
    // 另存=解析生成位置（targetRaw 空=原文档同目录；hPath 标题路径定位）
    if (opts.writeMode === "inplace") {
        let replaced: {id: string; title: string;};
        try {
            replaced = await replaceDocInPlace(info, markdown);
        } catch (e) {
            if (e instanceof ReplaceInplaceError) {
                // 写盘时刻状态已变（原文档被删/中途建了子文档）：按终止
                // 处理，已生成内容不丢——挪走子文档后可继续生成剩余部分
                return {
                    status: "aborted",
                    message: e.reason === "hasChildren" ? t("convertInplaceChildren") : t("convertNoDoc"),
                    count,
                    batches: chunks.length,
                    total: chunks.length,
                    doneOffset,
                    kramdown: markdown,
                };
            }
            throw e;
        }
        return {
            status: "done",
            message: (detected !== undefined && detected > 0 ?
                fmt(t("convertDetectedCount"), {n: String(detected)}) :
                "") + imgWarn,
            docId: replaced.id,
            title: replaced.title,
            count,
            batches: chunks.length,
            total: chunks.length,
            doneOffset: kramdown.length,
            kramdown: markdown,
        };
    }
    const loc = await resolveTarget(info, opts.targetRaw ?? "", t);
    if (!loc.ok) {
        return {
            status: "failed",
            message: loc.message,
            count,
            batches: chunks.length,
            total: chunks.length,
            doneOffset,
            kramdown: markdown,
        };
    }
    const created = await createExerciseDoc(loc.notebook, loc.parentPath, info.title, markdown, docId);
    return {
        status: "done",
        message: (detected !== undefined && detected > 0 ?
            fmt(t("convertDetectedCount"), {n: String(detected)}) :
            "") + imgWarn,
        docId: created.id,
        title: created.title,
        count,
        batches: chunks.length,
        total: chunks.length,
        doneOffset: kramdown.length,
        kramdown: markdown,
    };
}

/** 终止保留 / 继续生成完成后的落盘：把累积 kramdown 建成习题文档。 */
export async function writeExerciseDoc(
    info: DocInfo,
    markdown: string,
    srcDocId = "",
    targetRaw = "",
    t: (key: string) => string = () => "",
): Promise<{id: string; title: string;}> {
    const loc = await resolveTarget(info, targetRaw, t);
    if (!loc.ok) throw new Error(loc.message);
    return createExerciseDoc(loc.notebook, loc.parentPath, info.title, markdown, srcDocId);
}

/** 继续生成完成后删掉上次终止保留的旧文档（换成完整新文档）。 */
export async function removeDoc(docId: string): Promise<void> {
    try {
        await fetchSyncPost("/api/filetree/removeDocByID", {id: docId});
    } catch (_) {
        // 删除失败不影响主流程（旧文档保留）
    }
}

/** 单发结果包装（兼容弹窗的 onDone 汇报）。 */
export function toConvertResult(r: BatchedResult): ConvertResult {
    return {
        canConvert: r.status === "done",
        message: r.message,
        docId: r.docId,
        title: r.title,
        count: r.count,
    };
}
