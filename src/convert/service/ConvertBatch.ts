import { detectQuestions, questionPreview } from "./ConvertDetect";
import type { QuestionPreview } from "./ConvertDetect";
import { buildPrompt, extractBlockId, getDocInfo } from "./ConvertService";
import { isHeadingOnlyChunk, structuralChunks } from "./SrcChunk";
import { applyKnowDrafts, parseDrafts } from "./QuestionDraft";
import type { DraftUnit } from "./QuestionDraft";
import { shuffleDraftOptions } from "./OptionShuffle";
import { buildKnowledgeIndex, makeKnowAwareAi } from "./KnowledgeLink";
import type { KnowSection, KnowledgeIndex } from "./KnowledgeLink";
import { newAiGroupId, type AiSessionGroup } from "../../ai/client";
import { SetWriter } from "./SetWriter";
import type { QuestionBank } from "../../bank/data/QuestionBank";
import { knowTreesOf } from "../../bank/data/KnowTrees";
import type { WenguMaterial, WenguQuestion } from "../../types";
import { KernelBlock } from "../../siyuan/block";
import { fmt } from "../../ui/shared";

/**
 * 分批转换编排（从 ConvertService 拆出）：长文档按**结构切块**（标题
 * 边界 + 指纹，SrcChunk）逐批生成，批结果按「连续完成前缀」经 SetWriter
 * **直写题库**（20260903 起不再落文档——题目内容唯一真相在题库，
 * BankRecord.kramdown 契约形态不变）。并发池（parallel>1）按连续前缀
 * 拼装，题目顺序始终是原文档的忠实前缀；每批落库即 flush（崩溃安全，
 * 终止「保留」零额外动作、「丢弃」按写入 qid 清单回收）。
 */

/** 插图自检：源文档的图片行没被带进生成结果的条数（0=无缺，真机
 *  案例：AI 读不了图、把带图题整题跳过）。 */
function countMissingImages(srcMd: string, outMd: string): number {
    const srcImgs = new Set(srcMd.match(/!\[\]\([^)\s]+\)/g) ?? []);
    const outImgs = new Set(outMd.match(/!\[\]\([^)\s]+\)/g) ?? []);
    let n = 0;
    for (const img of srcImgs) {
        if (!outImgs.has(img)) n++;
    }
    return n;
}

/** 检测数的展示文案（"检测共 N 题"，分段计数有失败段时带 +）。 */
function detectedText(detected: number | undefined, truncated: boolean, t: (key: string) => string): string {
    return detected !== undefined && detected > 0
        ? fmt(t("convertDetectedCount"), { n: String(detected) }) + (truncated ? "+" : "")
        : "";
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
    /** 前置检测到的现成题数（未确定为空；分段计数覆盖全文）。 */
    detected?: number;
    /** 检测有分段计数失败（长文档分段并行），总数是下限（显示 N+）。 */
    detectedTruncated?: boolean;
    /** 刚完成那批的题目预览（弹窗渐进展示）。 */
    newStems?: QuestionPreview[];
    /** 本转换的题集 id（首批落库起有值；页签据此渐进呈现）。 */
    setId?: string;
    title?: string;
    /** 已落库题目的累积解析视图（渐进预览直用，无内核 IO）。 */
    questions?: WenguQuestion[];
    /** 已落库材料的累积视图（材料组预览）。 */
    materials?: WenguMaterial[];
}

/** 终止/失败保留的进度记录（prefs 持久化，重开思源后可继续生成）：
 *  已生成部分是题库里的真实记录（每批已 flush），记录只欠断点偏移。 */
export interface ConvertProgressRecord {
    /** 保留的（部分）题集 id。 */
    setId?: string;
    title: string;
    /** 已生成覆盖到的源文档字符偏移。 */
    offset: number;
    /** 已完成批数 / 总批数（展示用）。 */
    batches: number;
    total: number;
    /** 已生成题数。 */
    count: number;
}

/** 批式转换结果：done=全部完成；aborted=用户终止（已落库部分待抉择）。 */
export interface BatchedResult {
    status: "done" | "aborted" | "failed";
    message: string;
    /** 本转换的题集 id（有落库产物时）。 */
    setId?: string;
    title?: string;
    count: number;
    /** 已完成批数 / 总批数。 */
    batches: number;
    total: number;
    /** 已生成覆盖到的源文档字符偏移（继续生成的断点）。 */
    doneOffset: number;
    /** 本次运行写入的题目 id（「全部丢弃」按它回收）。 */
    writtenQids: string[];
}

/** 继续生成的入参：上次终止保留的进度（题集已在题库里，接续写入）。 */
export interface ResumeInfo {
    /** 已生成覆盖到的源文档偏移。 */
    offset: number;
    /** 上次保留的（部分）题集 id。 */
    setId?: string;
}

/** 分批转换主流程。终止时返回 aborted + 已写入 qid（待抉择）。 */
export async function convertDocBatched(
    docIdRaw: string,
    opts: {
        t: (key: string) => string;
        modelId: string;
        fillToChoice: boolean;
        bigToSteps: boolean;
        /** 并发批次数（1=串行）。 */
        parallel?: number;
        signal?: AbortSignal;
        resume?: ResumeInfo;
        /** 知识点根文档 id（书架/书/章），非空时路由小节并注入知识点反链。 */
        knowRoots?: string[];
        /** 题库（落库唯一通道）。 */
        bank: QuestionBank;
        /** 动作分组（AI 会话面板树归并）：检测/生成/路由挂同组；缺省=
         *  本流程自生成一组。 */
        trackGroup?: AiSessionGroup;
        onProgress(p: ConvertProgress): void;
    }
): Promise<BatchedResult> {
    const { t } = opts;
    const docId = extractBlockId(docIdRaw);
    /** 零进度早退（各前置拦截的清一色形态）。 */
    const zero = (status: BatchedResult["status"], message: string, total = 0): BatchedResult => ({
        status,
        message,
        count: 0,
        batches: 0,
        total,
        doneOffset: 0,
        writtenQids: [],
    });
    const info = await getDocInfo(docId);
    if (!info?.notebook) return zero("failed", t("convertNoDoc"));
    // 动作分组（AI 会话面板树归并）：检测/生成/路由挂同组；入参未带则
    // 本流程自生成一组
    const trackGroup = opts.trackGroup ?? { id: newAiGroupId(), title: `转换 · ${info.title}` };
    const kd = await KernelBlock.kramdown(docId);
    // 剥原文的块 id IAL 行（含引用前缀变体）：AI 出题用不到块 id，
    // 留着会被原样抄进解析/题干落成裸文本（真机踩坑）
    const kramdown = String((kd.data as { kramdown?: string } | null)?.kramdown ?? "").replace(
        /^\s*(?:>\s*)?\{:[^}\n]*\bid="[^"]*"[^\n]*$/gm,
        ""
    );
    if (!kramdown.trim()) return zero("failed", t("convertEmptyDoc"));

    const writer = new SetWriter(opts.bank);
    // 继续生成：开跑前接管既有题集（detect/首批期间终止也有 setId 可
    // 保留/丢弃；题集已不存在=记录失效，归一为全新转换）
    let resume: ResumeInfo | undefined;
    let setId: string | undefined;
    if (opts.resume?.setId) {
        const data = await opts.bank.all();
        if (data.sets?.[opts.resume.setId]) {
            setId = await writer.openSet({
                setId: opts.resume.setId,
                title: info.title,
                srcId: docId,
                hPath: info.hPath,
            });
            resume = { offset: opts.resume.offset, setId };
        }
    }
    const allChunks = structuralChunks(kramdown);
    // 进度偏移越过当前源文档末尾（记录残留的完成态/源文档被改短）：
    // 按已完成收口到旧题集，不再走生成循环——否则 chunks 为空会走
    // 到末尾「零产物」分支，把续跑语义搞混
    if (resume?.setId && allChunks.length > 0) {
        const last = allChunks[allChunks.length - 1];
        if (resume.offset >= last.offset + last.text.length) {
            return {
                status: "done",
                message: t("convertResumeSettled"),
                setId: resume.setId,
                title: info.title,
                count: 0,
                batches: 0,
                total: 0,
                doneOffset: kramdown.length,
                writtenQids: [],
            };
        }
    }
    const chunks = resume ? allChunks.filter((c) => c.offset >= resume.offset) : allChunks;

    // 知识点索引（建失败降级为不加反链，不阻断转换）
    let knowIndex: KnowledgeIndex | undefined;
    if (opts.knowRoots?.length) {
        knowIndex = await buildKnowledgeIndex(opts.knowRoots, await knowTreesOf(opts.bank)).catch(
            (): undefined => undefined
        );
    }
    let knowLinked = 0;

    let detected: number | undefined;
    let detectedTruncated = false;
    if (!resume) {
        opts.onProgress({ phase: "detect", batch: 0, total: chunks.length, count: 0, lastBatch: 0 });
        try {
            const d = await detectQuestions(kramdown, opts.modelId, opts.signal, trackGroup);
            if (!d.can) return zero("failed", d.reason || t("convertRefused"), chunks.length);
            detected = d.count;
            detectedTruncated = !!d.truncated;
        } catch (e) {
            if ((e as Error)?.name === "AbortError") {
                return zero("aborted", "", chunks.length);
            }
            // 检测失败不阻断：继续逐批生成（批内仍有 CAN_CONVERT 兜底）
        }
    }

    // 结果按「连续完成前缀」拼装，题目顺序与落库顺序始终是原文档的忠实
    // 前缀；并发度受供应商限流约束，由弹窗选择。
    const parallel = Math.max(1, Math.min(4, Math.floor(opts.parallel ?? 1)));
    const results: (DraftUnit[] | undefined)[] = new Array(chunks.length).fill(undefined);
    let cursor = 0;
    let contiguous = 0;
    let firstError = "";
    let userAborted = false;
    let emptyBatches = 0; // AI 该批返回可解析题目数为 0 的批数（完成消息附警告，原静默跳过漏题难排查）
    const internal = new AbortController();
    const relayAbort = (): void => {
        userAborted = true;
        internal.abort();
    };
    opts.signal?.addEventListener("abort", relayAbort);
    // 批调用 = 知识点路由（有配置时）+ 生成，独立会话通道见 makeKnowAwareAi
    const callAi = makeKnowAwareAi({
        modelId: opts.modelId,
        signal: internal.signal,
        knowIndex,
        label: info.title,
        group: trackGroup,
        buildPrompt: (source, rule, list) => buildPrompt(source, opts.fillToChoice, opts.bigToSteps, rule, list),
    });
    /** 已落库累积视图（渐进预览直用）与本次运行写入清单（丢弃回收）。 */
    const previewList: WenguQuestion[] = [];
    const previewMats: WenguMaterial[] = [];
    const writtenQids: string[] = [];
    const generatedKds: string[] = [];
    let count = 0;
    let lastBatch = 0;
    let doneOffset = resume?.offset ?? 0;
    /** 连续前缀推进：按文档序拼装、计数、逐批落库与进度上报。
     *  材料单元随题目一起入库（材料正文进 bank.materials），但不占题数
     *  与预览行号。经 flushChain 互斥串行执行：并发池下多 worker 同时进
     *  openSet/append 会两段前缀乱序插入、首建窗口重叠建出两份题集。 */
    const runFlushPrefix = async (): Promise<void> => {
        const newStems: QuestionPreview[] = [];
        const batchUnits: { draft: DraftUnit; srcKey?: string; srcHash?: string }[] = [];
        while (contiguous < chunks.length && results[contiguous]) {
            const ds = results[contiguous]!;
            batchUnits.push(
                ...ds.map((d) => ({ draft: d, srcKey: chunks[contiguous].key, srcHash: chunks[contiguous].hash }))
            );
            const nq = ds.filter((d) => !d.material);
            count += nq.length;
            lastBatch = nq.length;
            doneOffset = chunks[contiguous].offset + chunks[contiguous].text.length;
            contiguous++;
        }
        if (batchUnits.length === 0) return;
        if (!setId) {
            setId = await writer.openSet({ title: info.title, srcId: docId, hPath: info.hPath });
        }
        const out = await writer.append(setId, batchUnits);
        writtenQids.push(...out.qids);
        previewList.push(...out.questions);
        previewMats.push(...out.materials);
        let qno = count - out.units.filter((u) => !u.material).length;
        for (const u of out.units) {
            generatedKds.push(u.kd);
            if (!u.material) {
                qno++;
                newStems.push(questionPreview(u.kd, qno));
            }
        }
        await opts.bank.flush(); // 每批即落盘（崩溃安全，终止/丢弃语义都建立在已落库上）
        opts.onProgress({
            phase: contiguous >= chunks.length ? "writing" : "generating",
            batch: contiguous,
            total: chunks.length,
            count,
            lastBatch,
            detected,
            detectedTruncated,
            newStems,
            setId,
            title: info.title,
            questions: [...previewList],
            materials: [...previewMats],
        });
    };
    let flushChain: Promise<void> = Promise.resolve();
    const flushPrefix = (): Promise<void> => {
        const run = flushChain.then(runFlushPrefix, runFlushPrefix);
        const noop = (): void => undefined;
        flushChain = run.then(noop, noop); // 链面吞错保后续可排（真实错误由 run 抛给 worker）
        return run;
    };
    const worker = async (): Promise<void> => {
        for (;;) {
            if (firstError || userAborted) return;
            const i = cursor++;
            if (i >= chunks.length) return;
            // 纯标题块（章标题下直接挂子标题）零内容：不发 AI（发了也只是
            // CAN_CONVERT:no 白耗一次调用），按空批记账推进断点
            if (isHeadingOnlyChunk(chunks[i].text)) {
                results[i] = [];
                continue;
            }
            let gen: { reply: string; byAlias?: Map<string, KnowSection> };
            try {
                gen = await callAi(chunks[i].text);
            } catch (e) {
                if (opts.signal?.aborted) return; // 用户终止由 relayAbort 收口
                const err = e as Error;
                if (!firstError) {
                    firstError =
                        err?.name === "TimeoutError" || err?.name === "AbortError"
                            ? t("convertTimeout")
                            : String(err?.message ?? e);
                    internal.abort(); // 首个失败取消兄弟任务
                }
                return;
            }
            // 行协议 → draft（洗牌/知识点在 draft 层）→ SetWriter 落库
            const drafts = parseDrafts(gen.reply);
            if (drafts.length === 0) emptyBatches++;
            drafts.forEach(shuffleDraftOptions);
            if (gen.byAlias && drafts.length > 0) knowLinked += applyKnowDrafts(drafts, gen.byAlias);
            // 源块键与指纹随记录落库（增量重转换三态分类依据）
            results[i] = drafts;
            // 落库失败与 AI 失败同权重：记 firstError 收口成 failed 带部分
            // 内容——原直接抛出会把整轮结果丢给最外层 catch，进度不记账、
            // 不可续跑（20260829 审查）
            try {
                await flushPrefix();
            } catch (e) {
                if (opts.signal?.aborted) return;
                if (!firstError) {
                    firstError = String((e as Error)?.message ?? e);
                    internal.abort();
                }
                return;
            }
        }
    };
    try {
        await Promise.all(Array.from({ length: Math.min(parallel, chunks.length) }, () => worker()));
    } finally {
        opts.signal?.removeEventListener("abort", relayAbort); // 原仅成功路径解除，异常路径监听器残留
    }
    if (userAborted || firstError) {
        await opts.bank.flush().catch((): void => undefined); // 已落库部分先保住（保留抉择的标的）
        return {
            status: userAborted ? "aborted" : "failed",
            message: userAborted ? "" : `${t("convertAiFailed")}${firstError}`,
            count,
            batches: contiguous,
            total: chunks.length,
            doneOffset,
            setId,
            title: setId ? info.title : undefined,
            writtenQids,
        };
    }

    // 全程零产物（含续跑零新增）：续跑时题集保持原样按完成收口，全新
    // 转换按无题失败
    if (writtenQids.length === 0 && previewMats.length === 0) {
        if (setId) {
            return {
                status: "done",
                message: t("convertResumeSettled"),
                setId,
                title: info.title,
                count: 0,
                batches: chunks.length,
                total: chunks.length,
                doneOffset: kramdown.length,
                writtenQids,
            };
        }
        return zero("failed", t("convertNoQuestions"));
    }
    // 插图自检：完成消息里附警告提示重新转换
    const missingImgs = countMissingImages(kramdown, generatedKds.join("\n\n"));
    const imgWarn = missingImgs > 0 ? ` ${fmt(t("convertImagesMissing"), { n: String(missingImgs) })}` : "";
    // 批级空产出自检：AI 某批返回空/不可解析时对应源段被跳过——原静默
    // 「成功」漏题难排查，完成消息附警告（复用 imgWarn 拼接模式）
    const emptyWarn = emptyBatches > 0 ? ` ${fmt(t("convertBatchEmpty"), { n: String(emptyBatches) })}` : "";
    const detectedMsg = detectedText(detected, detectedTruncated, t);
    const doneMsg: string[] = [];
    if (detectedMsg) doneMsg.push(detectedMsg);
    if (knowLinked > 0) doneMsg.push(fmt(t("convertKnowCount"), { n: String(knowLinked) }));
    return {
        status: "done",
        message: doneMsg.join(" · ") + imgWarn + emptyWarn,
        setId: setId!,
        title: info.title,
        count,
        batches: chunks.length,
        total: chunks.length,
        doneOffset: kramdown.length,
        writtenQids,
    };
}
