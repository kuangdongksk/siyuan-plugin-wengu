import {fetchSyncPost} from "siyuan";
import {agentChat} from "./AgentClient";
import {
    buildPrompt,
    createExerciseDoc,
    extractBatchQuestions,
    extractBlockId,
    getDocInfo,
    parseVerdict,
    resolveTarget,
} from "./ConvertService";
import type {
    ConvertResult,
    DocInfo,
} from "./ConvertService";
import {
    applyKnowLinks,
    buildKnowledgeIndex,
    makeKnowAwareAi,
} from "./KnowledgeLink";
import type {
    KnowSection,
    KnowledgeIndex,
} from "./KnowledgeLink";
import {fmt} from "./ui";

/**
 * 分批转换编排（从 ConvertService 拆出）：长文档按空行边界切块逐批
 * 生成，批次结果累积在内存，完成（或终止保留）时一次性
 * createDocWithMd 落盘——真机 3.8.0 验证没有可靠的「追加到已有文档」
 * 通道（updateBlock 多块并一段/丢内容、transactions insert 无效），
 * 所以进度持久化只记「已生成到源文档的字符偏移 + 已建文档 id」，
 * 继续生成 = 拉旧文档 kramdown 并入累积、从偏移处续跑剩余批。
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

/** 检测窗口：检测调用只看前 N 字符（输入越长内核 AI 越易超时；
 *  超窗时 AI 只数可见部分并带 + 号（如 12+），UI 如实展示。 */
const DETECT_CHARS = 12000;

/** 前置检测：能否出题 + 原文现成题目数（试卷题库才有意义）。
 *  truncated=文档超出检测窗口，count 是可见部分的下限（N+）。 */
export interface DetectResult {
    can: boolean;
    reason: string;
    /** 原文现成题目数；讲义/无法判定为 undefined。 */
    count?: number;
    /** 文档超出检测窗口，计数只覆盖可见前缀。 */
    truncated?: boolean;
}

/** 检测超时短一些：输出只有三行。 */
const DETECT_TIMEOUT_MS = 120_000;

export async function detectQuestions(
    source: string,
    modelId: string,
    signal?: AbortSignal,
): Promise<DetectResult> {
    const truncated = source.length > DETECT_CHARS;
    const head = truncated ?
        `${source.slice(0, DETECT_CHARS)}\n<!-- 内容过长已截断 -->` :
        source;
    const reply = await agentChat(
        `你是思源笔记出题助手的前置检查。判断下面的文档是否适合出题，并统计其中现成题目的数量。
输出严格三行，格式之外不要输出任何文字：
CAN_CONVERT: yes 或 no
COUNT: 数字（原文中现成题目的总数；讲义/笔记等没有现成题目时输出 0；若下方内容带「已截断」标记，只数可见部分并在数字后紧跟一个加号，如 12+）
REASON: 一句话说明（注明文档类型：试卷题库或讲义笔记；不能转换时说明原因）
文档内容：
${head}`,
        modelId,
        DETECT_TIMEOUT_MS,
        signal,
    );
    const verdict = parseVerdict(reply);
    const cm = /COUNT\s*[:：]\s*(\d+)\s*(\+)?/i.exec(reply);
    const count = cm ? Number(cm[1]) : undefined;
    return {can: verdict.can, reason: verdict.reason, count, truncated: truncated && !!cm};
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
    /** 渐进落盘的习题文档（每批重建，id 会变；页签据此渐进呈现）。 */
    docId?: string;
    title?: string;
}

/** 弹窗预览行：题号 + 题型 + 题干片段。 */
export interface QuestionPreview {
    no: number;
    type: string;
    stem: string;
}

/** 从题目 kramdown 抽预览：题型属性 + 去标记后的题干开头（截 80 字）。 */
export function questionPreview(kd: string, no: number): QuestionPreview {
    const type = /custom-plugin-wengu-type="([a-z]+)"/.exec(kd)?.[1] ?? "";
    const stem = kd
        .split(/\r?\n/)
        .filter((l) =>
            !/^\s*\{:/.test(l) && // IAL 属性行
            !/^\s*\{\{\{/.test(l) && // 超级块定界
            !/^\s*\}\}\}/.test(l) &&
            !/^\s*>/.test(l) && // 答案/解析引述
            !/^\s*[-*]\s/.test(l) // 选项列表
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    return {no, type, stem: stem.slice(0, 80)};
}

/** 终止保留的进度记录（prefs 持久化，重开思源后可继续生成）。 */
export interface ConvertProgressRecord {
    /** 保留的（部分）习题文档 id。 */
    docId: string;
    title: string;
    /** 已生成覆盖到的源文档字符偏移。 */
    offset: number;
    /** 已完成批数 / 总批数（展示用）。 */
    batches: number;
    total: number;
    /** 已生成题数。 */
    count: number;
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
    /** 上次保留的习题文档（其内容并入本次结果）。 */
    docId: string;
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
        /** 生成位置：空=原文档同目录；否则生成到指定父文档下面。 */
        targetRaw?: string;
        /** 知识点根文档 id（书架/书/章），非空时路由小节并注入知识点反链。 */
        knowRoots?: string[];
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

    // 继续生成：旧文档内容并入累积，只跑剩余批
    let existing = "";
    if (opts.resume) {
        const old = await fetchSyncPost("/api/block/getBlockKramdown", {id: opts.resume.docId});
        existing = String((old.data as {kramdown?: string;} | null)?.kramdown ?? "");
    }
    const allChunks = chunkKramdown(kramdown);
    const chunks = opts.resume ? allChunks.filter((c) => c.offset >= opts.resume!.offset) : allChunks;

    // 知识点索引（建失败降级为不加反链，不阻断转换）
    let knowIndex: KnowledgeIndex | undefined;
    if (opts.knowRoots?.length) {
        knowIndex = await buildKnowledgeIndex(opts.knowRoots).catch((): undefined => undefined);
    }
    let knowLinked = 0;

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
    let lastBatch: number;
    // 目标位置提前解析（每批渐进重建都用到）；失败直接早退
    const loc = await resolveTarget(info, opts.targetRaw ?? "", t);
    if (!loc.ok) {
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
    // 渐进式落盘：每批后删除重建累积文档（内核无追加通道，删+建是本地快操作），
    // 生成期间文档树里即可查看已生成部分；重建失败不阻断生成，末尾兜底落盘。
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
    // 批调用 = 知识点路由（有配置时）+ 生成，通道选择见 makeKnowAwareAi
    const callAi = makeKnowAwareAi({
        modelId: opts.modelId,
        parallel,
        signal: internal.signal,
        knowIndex,
        buildPrompt: (source, rule, list) => buildPrompt(source, opts.fillToChoice, opts.bigToSteps, rule, list),
    });
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
        try {
            if (created) await removeDoc(created.id);
            created = await createExerciseDoc(loc.notebook, loc.parentPath, info.title, markdown, docId);
            if (opts.resume && !oldResumeRemoved) {
                await removeDoc(opts.resume.docId);
                oldResumeRemoved = true;
            }
        } catch (_) {
            created = undefined;
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
            let gen: {reply: string; byAlias?: Map<string, KnowSection>;};
            try {
                gen = await callAi(chunks[i].text);
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
            let qs = extractBatchQuestions(gen.reply);
            if (gen.byAlias && qs.length > 0) {
                const applied = applyKnowLinks(qs, gen.byAlias);
                qs = applied.out;
                knowLinked += applied.linked;
            }
            results[i] = qs;
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
    // 渐进重建已落盘则直接用；中途重建失败过才在这里兜底创建
    if (!created) {
        created = await createExerciseDoc(loc.notebook, loc.parentPath, info.title, markdown, docId);
    }
    const doneMsg: string[] = [];
    if (detected !== undefined && detected > 0) {
        doneMsg.push(fmt(t("convertDetectedCount"), {n: String(detected)}) + (detectedTruncated ? "+" : ""));
    }
    if (knowLinked > 0) doneMsg.push(fmt(t("convertKnowCount"), {n: String(knowLinked)}));
    return {
        status: "done",
        message: doneMsg.join(" · "),
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
