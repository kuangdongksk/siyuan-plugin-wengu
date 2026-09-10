import { fmt } from "../../../ui/shared";
import { buildPrompt, type StepContext } from "../../../ai/prompts/convert";
import { questionPreview } from "../draft/ConvertDetect";
import type { QuestionPreview } from "../draft/ConvertDetect";
import { extractBlockId, getDocInfo } from "../core/ConvertService";
import { buildNormIndex } from "../source/CursorWindow";
import { planShards } from "../source/ShardPlan";
import { applyKnowDrafts } from "../draft/QuestionDraft";
import { buildKnowledgeIndex } from "../knowledge/KnowledgeLink";
import type { KnowledgeIndex } from "../knowledge/KnowledgeLink";
import { makeKnowAwareAi } from "../knowledge/KnowRoute";
import { newAiGroupId, type AiSessionGroup } from "../../../ai/client";
import { SetWriter } from "../output/SetWriter";
import type { QuestionBank } from "../../../bank/data/QuestionBank";
import { setTypeUnion } from "../../../bank/data/BankSets";
import { knowTreesOf } from "../../../bank/data/KnowTrees";
import { QuestionType } from "../../../types";
import type { WenguMaterial, WenguQuestion } from "../../../types";
import { KernelBlock } from "../../../siyuan/block";
import { runSegment } from "./ConvertSegment";
import type { SegmentBatch, SegmentDeps, SegmentResult } from "./ConvertSegment";

/**
 * 分片并行转换编排（20260910，见 AGENTS.md「convert 域」）：逐段自推进的
 * 批边界由 AI 的 `@@TO` 决定，下一批窗口起点依赖本批产出——这条链是硬的，
 * 只能串行（40 万字符 ≈ 67 批 ≈ 25 分钟）。本模块在它外面加一层**分片
 * 并行**，把两种粒度拆开：
 *
 * 1. `planShards` 把源卷切成 N 片：切点**按可靠性分级就近择取**（标题行 >
 *    超级块/分割线 > 题号行 > 空行 > 行首，见 ShardPlan）——源格式千奇百怪
 *    （规范 markdown / 旧版落文档产物 / 粘贴网页 / OCR 纯文本）都能拿到片；
 *    切点不保证落在题边界时给片尾补一段重叠上下文（`shard.tail`，正文插
 *    `[END]` 标记，被切断的题由后一片完整处理）；候选不足则自动减少片数，
 *    最少单片 = 改造前的串行行为，零风险退化；
 * 2. N 个片以 `parallel` 条流水线并发跑（worker 池），**每片内部仍是原来的
 *    自推进循环**（ConvertSegment：批边界照旧由 `@@TO` 决定，「题干与解答
 *    同批、不切题」的性质完全保留）；
 * 3. 产物经**片序闸门**按片序落库（`submit` 里 `await gate[i-1]`）——乱序
 *    落库会让题单顺序与材料链（`lastMaterialId`：小题引用文中紧邻其前的
 *    材料）跨片错位。闸门保证题库里始终是按源顺序的**连续前缀**，因此续跑
 *    断点仍是单游标，终止「保留」的语义与串行时代完全一致；
 * 4. 每片首批顺带输出判定与题型（判定合并进首批生成，无独立检测轮）。
 *
 * 并发度 = 1 时目标片数也是 1，逐字回到改造前的行为。增量重转换仍走确定性
 * 结构切块 + 指纹三态分类（SrcChunk/ConvertIncrement），不受本模块影响。
 */

/** 同时最多跑几条片流水线（= 同时最多几个在途 AI 调用）。 */
const MAX_CONCURRENCY = 4;

/** 目标片数 = 并发度 × 该系数：片数略多于流水线数，让 worker 池消化片长
 *  不均（多出的片排队，避免某片超长变成尾巴）。 */
const SHARDS_PER_WORKER = 2;

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

/** 已读百分比（逐段模式的「批总数」事前未知，用原文消费比例做进度）。 */
function percentOf(cursor: number, total: number): number {
    if (total <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round((cursor / total) * 100)));
}

/** 片级闸门：片 i 的落库要等片 i-1 落库完成（见文件头注释第 3 点）。 */
function gate(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

/** 题型 i18n 键（完成消息展示首批报出的题型并集）。 */
const TYPE_I18N: Record<QuestionType, string> = {
    [QuestionType.Single]: "typeSingle",
    [QuestionType.Multiple]: "typeMultiple",
    [QuestionType.Judge]: "typeJudge",
    [QuestionType.Fill]: "typeFill",
    [QuestionType.Brief]: "typeBrief",
    [QuestionType.Steps]: "typeSteps",
    [QuestionType.Cloze]: "typeCloze",
    [QuestionType.Match]: "typeMatch",
    [QuestionType.Essay]: "typeEssay",
    [QuestionType.Trans]: "typeTrans",
};

/** 转换进度回调（页内转换条/转换管理面板展示）。 */
export interface ConvertProgress {
    /** generating=逐段生成中；writing=收尾落盘中（detect 已随独立检测退役）。 */
    phase: "detect" | "generating" | "writing";
    /** 已落库批数（逐段模式=已落库的窗口数；batch=i 表示第 i 批刚落库）。 */
    batch: number;
    /** 总批数——批数由 AI 决定、事前未知，恒 0（展示走 readPct）。 */
    total: number;
    /** 已生成题数（累积）。 */
    count: number;
    /** 刚完成那批生成的题数（首批前为 0）。 */
    lastBatch: number;
    /** 已读原文百分比（并行下 = 各片进度之和，不落库也计入）。 */
    readPct?: number;
    /** 前置检测到的现成题数（判定已合并进首批生成，恒不提供）。 */
    detected?: number;
    /** 检测有分段计数失败，总数是下限（显示 N+）。 */
    detectedTruncated?: boolean;
    /** 刚完成那批的题目预览（渐进展示）。 */
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
 *  已生成部分是题库里的真实记录（每批已 flush），记录只欠断点游标。
 *  分片并行下落库恒为按源顺序的连续前缀，断点因此仍是单游标。 */
export interface ConvertProgressRecord {
    /** 保留的（部分）题集 id。 */
    setId?: string;
    title: string;
    /** 已生成覆盖到的源文档字符偏移（=续跑游标）。 */
    offset: number;
    /** 已完成批数 / 总批数（展示用；逐段模式两者都是已处理批数）。 */
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
    /** 已生成覆盖到的源文档偏移（续跑游标）。 */
    offset: number;
    /** 上次保留的（部分）题集 id。 */
    setId?: string;
}

/** 分片并行转换主流程。终止时返回 aborted + 已写入 qid（待抉择）。 */
export async function convertDocBatched(
    docIdRaw: string,
    opts: {
        t: (key: string) => string;
        modelId: string;
        fillToChoice: boolean;
        bigToSteps: boolean;
        /** 并发片流水线数（1=串行=改造前行为；上限 MAX_CONCURRENCY）。 */
        parallel?: number;
        signal?: AbortSignal;
        resume?: ResumeInfo;
        /** 知识点根文档 id（书架/书/章），非空时路由小节并注入知识点反链。 */
        knowRoots?: string[];
        /** 题库（落库唯一通道）。 */
        bank: QuestionBank;
        /** 动作分组（AI 会话面板树归并）：生成/路由挂同组；缺省=本流程
         *  自生成一组。 */
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
    // 动作分组（AI 会话面板树归并）：生成/路由挂同组
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
    // 继续生成：开跑前接管既有题集（首批期间终止也有 setId 可保留/丢弃；
    // 题集已不存在=记录失效，归一为全新转换）。游标=记录里的断点偏移。
    let setId: string | undefined;
    let cursor = 0;
    if (opts.resume?.setId) {
        const data = await opts.bank.all();
        if (data.sets?.[opts.resume.setId]) {
            setId = await writer.openSet({
                setId: opts.resume.setId,
                title: info.title,
                srcId: docId,
                hPath: info.hPath,
            });
            cursor = Math.max(0, opts.resume.offset);
        }
    }
    // 断点已越过文档末尾（记录残留的完成态/源文档被改短）：按已完成收口
    // 到旧题集，不再走生成循环（否则零产物分支会把续跑语义搞混）
    if (setId && cursor >= kramdown.length) {
        return {
            status: "done",
            message: t("convertResumeSettled"),
            setId,
            title: info.title,
            count: 0,
            batches: 0,
            total: 0,
            doneOffset: kramdown.length,
            writtenQids: [],
        };
    }
    const baseFrom = cursor; // 续跑起点（已读百分比的零点）

    // 知识点索引（建失败降级为不加反链，不阻断转换）
    let knowIndex: KnowledgeIndex | undefined;
    if (opts.knowRoots?.length) {
        knowIndex = await buildKnowledgeIndex(opts.knowRoots, await knowTreesOf(opts.bank)).catch(
            (): undefined => undefined
        );
    }
    let knowLinked = 0;

    /** 题型先验：续跑用题集既有记录的题型并集（零 AI）；全新转换由各片
     *  首批生成顺带报出。多片并行的首批题型取**并集**（同卷各片题型一致，
     *  并集即该卷题型规则集）。 */
    let genTypes: QuestionType[] | undefined;
    if (setId) {
        const prior = await setTypeUnion(opts.bank, setId);
        genTypes = prior.length > 0 ? prior : undefined;
    }

    /** 归一化索引（@@TO 片段定位用，长文档只建一次，跨片共享）。 */
    const normIndex = buildNormIndex(kramdown);
    /** 已落库累积视图（渐进预览直用）与本次运行写入清单（丢弃回收）。 */
    const previewList: WenguQuestion[] = [];
    const previewMats: WenguMaterial[] = [];
    const writtenQids: string[] = [];
    const generatedKds: string[] = [];
    let count = 0;
    let batchNo = 0;
    let emptyBatches = 0; // AI 批返回可解析题目数为 0 的批数（完成消息附警告）
    let anchorMiss = 0; // @@TO 缺失/定位失败的批数（兜底推进，可能漏窗口末尾残题）
    let refused = ""; // 首片首批判定「不能出题」的原因（零产物收口时用）
    let firstError = "";
    let userAborted = false;
    let flushedCursor = baseFrom; // 已落库的连续前缀末尾（续跑断点）
    const internal = new AbortController();
    const relayAbort = (): void => {
        userAborted = true;
        internal.abort();
    };
    opts.signal?.addEventListener("abort", relayAbort);

    // 分片规划：并发度 1 时单片（逐字回到改造前行为）；续跑只规划断点之后
    // 的剩余部分（断点落在片中间时天然接续）。
    const conc = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(opts.parallel ?? 1) || 1));
    const shards = planShards(kramdown, conc === 1 ? 1 : conc * SHARDS_PER_WORKER, baseFrom);
    if (shards.length === 0) {
        opts.signal?.removeEventListener("abort", relayAbort);
        return zero("done", t("convertResumeSettled"));
    }
    const gates = shards.map(() => gate());
    const segs = new Array<SegmentResult | undefined>(shards.length);
    /** 各片当前游标（已读百分比 = 各片进度之和，未落库也计入）。 */
    const segCursor = shards.map((s) => s.start);
    const readPct = (): number => {
        let done = 0;
        for (let i = 0; i < shards.length; i++) done += segCursor[i] - shards[i].start;
        return percentOf(baseFrom + done, kramdown.length);
    };

    /** 交付一批：等本片前驱落库完成 → 写入 → flush → 报进度。返回落库题数。 */
    const submit = async (idx: number, batch: SegmentBatch): Promise<number> => {
        if (idx > 0) await gates[idx - 1].promise; // 片序闸门（连续前缀）
        if (internal.signal.aborted) return 0;
        const linked = batch.byAlias ? applyKnowDrafts(batch.drafts, batch.byAlias) : 0;
        knowLinked += linked;
        if (!setId) {
            setId = await writer.openSet({ title: info.title, srcId: docId, hPath: info.hPath });
        }
        const out = await writer.append(
            setId,
            batch.drafts.map((d) => ({ draft: d, srcKey: batch.srcKey, srcHash: batch.srcHash }))
        );
        writtenQids.push(...out.qids);
        previewList.push(...out.questions);
        previewMats.push(...out.materials);
        const newStems: QuestionPreview[] = [];
        let qno = count;
        for (const u of out.units) {
            generatedKds.push(u.kd);
            if (!u.material) {
                qno++;
                newStems.push(questionPreview(u.kd, qno));
            }
        }
        const nq = batch.drafts.filter((d) => !d.material).length;
        count += nq;
        batchNo++;
        flushedCursor = Math.max(flushedCursor, batch.end);
        await opts.bank.flush(); // 每批即落盘（崩溃安全，终止/丢弃语义建立在已落库上）
        opts.onProgress({
            phase: flushedCursor >= kramdown.length ? "writing" : "generating",
            batch: batchNo,
            total: 0,
            count,
            lastBatch: nq,
            readPct: readPct(),
            newStems,
            setId,
            title: info.title,
            questions: [...previewList],
            materials: [...previewMats],
        });
        return nq;
    };

    /** 片执行依赖（每片一份 makeCall——stepCtx 是片内状态）。 */
    const depsOf = (idx: number): SegmentDeps => ({
        kramdown,
        normIndex,
        signal: internal.signal,
        single: shards.length === 1,
        t,
        reportTypes: (types) => {
            const merged = new Set<QuestionType>(genTypes ?? []);
            for (const x of types) merged.add(x);
            genTypes = [...merged];
        },
        makeCall: (step: () => StepContext | undefined) =>
            makeKnowAwareAi({
                modelId: opts.modelId,
                signal: internal.signal,
                knowIndex,
                label: info.title,
                group: trackGroup,
                buildPrompt: (source, rule, list) =>
                    buildPrompt(source, opts.fillToChoice, opts.bigToSteps, rule, list, genTypes, step()),
            }),
        submit: (batch) => {
            segCursor[idx] = Math.max(segCursor[idx], batch.end);
            return submit(idx, batch);
        },
    });

    // worker 池：并发跑各片；任一片失败即中止其余片（已落库部分仍是连续前缀）
    let nextShard = 0;
    const worker = async (): Promise<void> => {
        for (;;) {
            const idx = nextShard++;
            if (idx >= shards.length || internal.signal.aborted) return;
            const r = await runSegment(shards[idx], depsOf(idx));
            segCursor[idx] = Math.max(segCursor[idx], r.cursor);
            segs[idx] = r;
            gates[idx].resolve(); // 释放下一片的落库闸门
            if (r.error) {
                firstError = r.error;
                internal.abort();
                return;
            }
            if (idx === 0 && r.refused) refused = r.refused;
            if (opts.signal?.aborted) return;
        }
    };
    try {
        await Promise.all(Array.from({ length: Math.min(conc, shards.length) }, () => worker()));
    } finally {
        // 异常路径也要放行所有闸门（有片未启动时不给后续片留下永不 resolve 的等待）
        for (const g of gates) g.resolve();
        opts.signal?.removeEventListener("abort", relayAbort);
    }
    for (const r of segs) {
        if (!r) continue;
        batchNo += r.batches;
        emptyBatches += r.emptyBatches;
        anchorMiss += r.anchorMiss;
    }
    if (userAborted || firstError) {
        await opts.bank.flush().catch((): void => undefined); // 已落库部分先保住（保留抉择的标的）
        return {
            status: userAborted ? "aborted" : "failed",
            message: userAborted ? "" : `${t("convertAiFailed")}${firstError}`,
            count,
            batches: batchNo,
            total: batchNo,
            doneOffset: flushedCursor,
            setId,
            title: setId ? info.title : undefined,
            writtenQids,
        };
    }

    // 全程零产物（含续跑零新增）：续跑时题集保持原样按完成收口，全新
    // 转换按无题失败（首片首批判定说不宜出题时用它给的原因）
    if (writtenQids.length === 0 && previewMats.length === 0) {
        if (setId) {
            return {
                status: "done",
                message: t("convertResumeSettled"),
                setId,
                title: info.title,
                count: 0,
                batches: batchNo,
                total: batchNo,
                doneOffset: kramdown.length,
                writtenQids,
            };
        }
        return zero("failed", refused || t("convertNoQuestions"));
    }
    // 插图自检：完成消息里附警告提示重新转换
    const missingImgs = countMissingImages(kramdown, generatedKds.join("\n\n"));
    const imgWarn = missingImgs > 0 ? ` ${fmt(t("convertImagesMissing"), { n: String(missingImgs) })}` : "";
    // 批级空产出自检：AI 某批返回空/不可解析时对应源段被跳过——静默
    // 「成功」漏题难排查，完成消息附警告（复用 imgWarn 拼接模式）
    const emptyWarn = emptyBatches > 0 ? ` ${fmt(t("convertBatchEmpty"), { n: String(emptyBatches) })}` : "";
    // 定位失败自检：兜底推进可能跳过窗口末尾残题，同样要点名
    const anchorWarn = anchorMiss > 0 ? ` ${fmt(t("convertAnchorLost"), { n: String(anchorMiss) })}` : "";
    const doneMsg: string[] = [];
    if (genTypes && genTypes.length > 0) {
        doneMsg.push(fmt(t("convertTypeList"), { types: genTypes.map((x) => t(TYPE_I18N[x])).join("、") }));
    }
    if (knowLinked > 0) doneMsg.push(fmt(t("convertKnowCount"), { n: String(knowLinked) }));
    return {
        status: "done",
        message: doneMsg.join(" · ") + imgWarn + emptyWarn + anchorWarn,
        setId: setId!,
        title: info.title,
        count,
        batches: batchNo,
        total: batchNo,
        doneOffset: kramdown.length,
        writtenQids,
    };
}
