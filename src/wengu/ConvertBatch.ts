import {fetchSyncPost} from "siyuan";
import {
    agentChat,
    agentChatConcurrent,
} from "./AgentClient";
import {
    detectQuestions,
    questionPreview,
} from "./ConvertDetect";
import type {QuestionPreview} from "./ConvertDetect";
import {
    AI_TIMEOUT_MS,
    buildPrompt,
    createExerciseDoc,
    extractBatchQuestions,
    extractBlockId,
    getDocInfo,
    hasChildDocs,
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
 * 生成，批次结果累积在内存——真机 3.8.0 验证没有可靠的「追加到已有
 * 文档」通道（updateBlock 多块并一段/丢内容、transactions insert
 * 无效），所以只能删旧重建式落盘。
 *
 * 落盘双模式（writeMode）：inplace=**终态一次性**原位替换（转换期间
 * 原文档不动，完成时删旧同路径同标题重建，写盘时刻重查位置/子文档，
 * 见 ConvertService.replaceDocInPlace）；newdoc=另存《标题·习题》+
 * **渐进式落盘**（每批删旧重建累积文档，文档树实时长大，页签渐进
 * 呈现）。并发池（parallel>1 走 chatGPT 通道）按「连续完成前缀」
 * 拼装，题目顺序始终是原文档的忠实前缀。
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

/** 转换进度回调（弹窗状态行展示）。 */
export interface ConvertProgress {
    /** detect=前置检测中；generating=逐批生成中；writing=落盘中。 */
    phase: "detect" | "generating" | "writing";
    /** 已完成批数（batch=i 表示第 i+1 批正在进行）。 */
    batch: number;
    /** 总批数。 */
    total: number;
    /** 已生成题数（累积）。 */
    count: number;
    /** 刚完成那批生成的题数（首批前为 0）。 */
    lastBatch: number;
    /** 前置检测到的现成题数（未确定为空）。 */
    detected?: number;
    /** 检测只覆盖了前缀（长文档），总数是下限（显示 N+）。 */
    detectedTruncated?: boolean;
    /** 刚完成那批的题目预览（弹窗渐进展示）。 */
    newStems?: QuestionPreview[];
    /** 渐进落盘的习题文档（每批重建，id 会变；页签据此渐进呈现，
     *  原位模式无渐进文档、不出现）。 */
    docId?: string;
    title?: string;
}

/** 终止/失败保留的进度记录（prefs 持久化，重开思源后可继续生成）。
 *  渐进/另存模式保留部分习题文档（docId）；原位模式原文档不动，
 *  已生成 kramdown 直接存进记录（kramdown）。 */
export interface ConvertProgressRecord {
    /** 保留的（部分）习题文档 id（渐进/另存模式）。 */
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
    /** 上次保留的部分习题文档（渐进/另存模式，内容并入本次结果）。 */
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
        /** 并发批次数（1=串行 agent/chat；2~4=chatGPT 并发通道）。 */
        parallel?: number;
        signal?: AbortSignal;
        resume?: ResumeInfo;
        /** 落盘模式：inplace=原位替换原文档；newdoc=另存《·习题》（默认）。 */
        writeMode?: "inplace" | "newdoc";
        /** 生成位置（仅 newdoc）：空=原文档同目录；否则指定父文档下面。 */
        targetRaw?: string;
        onProgress(p: ConvertProgress): void;
    },
): Promise<BatchedResult> {
    const {t} = opts;
    const inplace = opts.writeMode === "inplace";
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
    // 原位替换会连子文档一起删——开始即拦（写盘时刻 replaceDocInPlace 还会重查）
    if (inplace && await hasChildDocs(docId)) {
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

    // 继续生成：上次保留内容并入累积（渐进/另存=旧部分文档 kramdown，
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
    let detectedTruncated = false;
    if (!opts.resume) {
        opts.onProgress({phase: "detect", batch: 0, total: chunks.length, count: 0, lastBatch: 0});
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
            detectedTruncated = !!d.truncated;
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
    let lastBatch = 0;
    // 目标位置提前解析（渐进重建每批用到；仅另存模式，原位写盘自定位）
    const loc = inplace ? undefined : await resolveTarget(info, opts.targetRaw ?? "", t);
    if (loc && !loc.ok) {
        return {
            status: "failed",
            message: loc.message,
            count: 0,
            batches: 0,
            total: chunks.length,
            doneOffset: 0,
            kramdown: "",
        };
    }
    // 渐进式落盘（仅另存）：每批后删除重建累积文档，生成期间文档树里
    // 即可查看已生成部分；重建失败不阻断生成，末尾兜底落盘。原位模式
    // 转换期间原文档不动（不能每批删一次源文档），终态一次性替换。
    let created: {id: string; title: string;} | undefined;
    let oldResumeRemoved = false;
    // 检测完成即报一次（batch=0：第 1 批即将开始），让「检测共 N 题」尽早可见
    opts.onProgress({
        phase: "generating",
        batch: 0,
        total: chunks.length,
        count: 0,
        lastBatch: 0,
        detected,
        detectedTruncated,
    });
    // 并发池（parallel=1 串行走 agent/chat，可选模型；>1 走可并发的
    // chatGPT 通道，模型跟随设置默认——agent/chat 并发会被内核拒绝，
    // 真机 20260823 验证见 AGENTS.md）。结果按「连续完成前缀」拼装，
    // 题目顺序与渐进文档始终是原文档的忠实前缀；并发度受供应商限流
    // 约束，由弹窗选择。
    const parallel = Math.max(1, Math.min(4, Math.floor(opts.parallel ?? 1)));
    const results: (string[] | undefined)[] = new Array(chunks.length).fill(undefined);
    let cursor = 0;
    let contiguous = 0;
    let firstError = "";
    let userAborted = false;
    const internal = new AbortController();
    const relayAbort = (): void => {
        userAborted = true;
        internal.abort();
    };
    opts.signal?.addEventListener("abort", relayAbort);
    const callAi = (chunk: SourceChunk): Promise<string> => {
        const prompt = buildPrompt(chunk.text, opts.fillToChoice, opts.bigToSteps);
        return parallel > 1 ?
            agentChatConcurrent(prompt, AI_TIMEOUT_MS, internal.signal) :
            agentChat(prompt, opts.modelId, AI_TIMEOUT_MS, internal.signal);
    };
    /** 连续前缀推进：按文档序拼装、计数、渐进重建与进度上报。 */
    const flushPrefix = async (): Promise<void> => {
        const newStems: QuestionPreview[] = [];
        while (contiguous < chunks.length && results[contiguous]) {
            const qs = results[contiguous]!;
            if (qs.length > 0) {
                parts.push(qs.join("\n\n"));
                count += qs.length;
                lastBatch = qs.length;
                qs.forEach((kd, j) => newStems.push(questionPreview(kd, count - qs.length + j + 1)));
            }
            doneOffset = chunks[contiguous].offset + chunks[contiguous].text.length;
            contiguous++;
        }
        if (newStems.length === 0) return;
        const markdown = [existing, ...parts].filter(Boolean).join("\n\n");
        if (!inplace) {
            try {
                if (created) await removeDoc(created.id);
                created = await createExerciseDoc(loc!.notebook, loc!.parentPath, info.title, markdown, docId);
                if (opts.resume?.docId && !oldResumeRemoved) {
                    await removeDoc(opts.resume.docId);
                    oldResumeRemoved = true;
                }
            } catch (_) {
                created = undefined;
            }
        }
        opts.onProgress({
            phase: contiguous >= chunks.length ? "writing" : "generating",
            batch: contiguous,
            total: chunks.length,
            count,
            lastBatch,
            detected,
            detectedTruncated,
            newStems,
            ...(created ? {docId: created.id, title: created.title} : {}),
        });
    };
    const worker = async (): Promise<void> => {
        for (;;) {
            if (firstError || userAborted) return;
            const i = cursor++;
            if (i >= chunks.length) return;
            let reply: string;
            try {
                reply = await callAi(chunks[i]);
            } catch (e) {
                if (opts.signal?.aborted) return; // 用户终止由 relayAbort 收口
                const err = e as Error;
                if (!firstError) {
                    firstError = err?.name === "TimeoutError" || err?.name === "AbortError" ?
                        t("convertTimeout") :
                        String(err?.message ?? e);
                    internal.abort(); // 首个失败取消兄弟任务
                }
                return;
            }
            results[i] = extractBatchQuestions(reply);
            await flushPrefix();
        }
    };
    await Promise.all(Array.from({length: Math.min(parallel, chunks.length)}, () => worker()));
    opts.signal?.removeEventListener("abort", relayAbort);
    if (userAborted || firstError) {
        return {
            status: userAborted ? "aborted" : "failed",
            message: userAborted ? "" : `${t("convertAiFailed")}${firstError}`,
            count,
            batches: contiguous,
            total: chunks.length,
            doneOffset,
            docId: created?.id,
            title: created?.title,
            kramdown: [existing, ...parts].filter(Boolean).join("\n\n"),
        };
    }

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
    const detectedMsg = detected !== undefined && detected > 0 ?
        fmt(t("convertDetectedCount"), {n: String(detected)}) + (detectedTruncated ? "+" : "") :
        "";
    // 落盘：原位=写盘时刻重查后删旧同路径同标题重建（不加 source-doc
    // 配对——源即本文档；旧配对改指新 id 见 replaceDocInPlace）；
    // 另存=渐进重建已落盘则直接用，中途失败过才在这里兜底创建
    if (inplace) {
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
        if (opts.resume?.docId) await removeDoc(opts.resume.docId);
        return {
            status: "done",
            message: detectedMsg + imgWarn,
            docId: replaced.id,
            title: replaced.title,
            count,
            batches: chunks.length,
            total: chunks.length,
            doneOffset: kramdown.length,
            kramdown: markdown,
        };
    }
    if (!created) {
        created = await createExerciseDoc(loc!.notebook, loc!.parentPath, info.title, markdown, docId);
    }
    return {
        status: "done",
        message: detectedMsg + imgWarn,
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
