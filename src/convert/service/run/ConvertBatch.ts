import { aiTitle, fmt } from "../../../ui/shared";
import { tKey } from "../../../ui/Notify";
import { buildPrompt, type StepContext } from "../../../ai/prompts/convert";
import { questionPreview } from "../draft/ConvertDetect";
import type { QuestionPreview } from "../draft/ConvertDetect";
import { extractBlockId, getDocInfo } from "../core/ConvertService";
import { buildNormIndex } from "../source/CursorWindow";
import { planShards } from "../source/ShardPlan";
import { advanceSegs, hashContent } from "../source/SetSegments";
import { applyKnowDrafts } from "../draft/QuestionDraft";
import { buildKnowledgeIndex } from "../knowledge/KnowledgeLink";
import type { KnowledgeIndex } from "../knowledge/KnowledgeLink";
import { makeKnowAwareAi } from "../knowledge/KnowRoute";
import { aiStopHandle, newAiGroupId, type AiSessionGroup } from "../../../ai/client";
import { AI_STOPPED, aiSessions } from "../../../ai/data/AiSessions";
import { SetWriter } from "../output/SetWriter";
import type { QuestionBank } from "../../../bank/data/QuestionBank";
import { setTypeUnion } from "../../../bank/data/BankSets";
import { knowTreesOf } from "../../../bank/data/KnowTrees";
import { QuestionType } from "../../../types";
import type { WenguMaterial, WenguQuestion } from "../../../types";
import { KernelBlock } from "../../../siyuan/block";
import { runSegment } from "./ConvertSegment";
import type { SegmentBatch, SegmentDeps, SegmentResult } from "./ConvertSegment";
import {
    countMissingImages,
    gate,
    isBlankSource,
    MAX_CONCURRENCY,
    percentOf,
    SHARDS_PER_WORKER,
    TYPE_I18N,
} from "./ConvertBatchTypes";

import type {
    BatchedResult,
    ConvertProgress,
    ConvertProgressRecord,
    ResumeInfo,
    SubmitPlan,
} from "./ConvertBatchModel";

/**
 * 数据形态层原出口保留（跨模块与既有单测自本模块 import，纯 re-export 保签名）：
 * 交付计划与四个载体的实际定义在 `./ConvertBatchModel`（20260915 拆出）。
 */
export type {
    BatchedResult,
    ConvertProgress,
    ConvertProgressRecord,
    ResumeInfo,
    SubmitPlan,
} from "./ConvertBatchModel";

/** 源判空加固的原出口保留（既有单测自本模块 import，纯 re-export 保签名）。 */
export { isBlankSource } from "./ConvertBatchTypes";

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
 * 常量/纯函数层在 `ConvertBatchTypes`（并发上限、源判空、百分比、闸门、
 * 题型 i18n 键），**数据形态层在 `ConvertBatchModel`**（交付计划与四个跨模块
 * 载荷，20260915 拆出压 500 行红线）；落库交付按家族惯例分 **plan/apply
 * 两层**——`planSubmit` 只算（写库参数 / 题数 / 批号 / 新游标），
 * `applySubmit` 照做（写库 + 落盘 + 改名 + 报进度），拆出时逐句搬运、
 * 编排次序未动。
 *
 * 并发度 = 1 时目标片数也是 1，逐字回到改造前的行为。增量重转换仍走确定性
 * 结构切块 + 指纹三态分类（SrcChunk/ConvertIncrement），不受本模块影响。
 */

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
        /** 每批落库后的断点检查点（Issue #62）：载荷即「此刻可续跑的进度
         *  记录」，由批量队列逐篇持久化（单篇流程不接）。⚠️ 中途值
         *  `batches` 只能是**已落库批数**（与收口记录的「AI 调用批数」
         *  两个口径，中途无从得知后者）。 */
        onCheckpoint?(rec: ConvertProgressRecord): void;
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
    const trackGroup = opts.trackGroup ?? {
        id: newAiGroupId(),
        title: aiTitle(tKey, "aiTitleConvert", { name: info.title }),
    };
    const kd = await KernelBlock.kramdown(docId);
    // 剥原文的块 id IAL 行（含引用前缀变体）：AI 出题用不到块 id，
    // 留着会被原样抄进解析/题干落成裸文本（真机踩坑）
    const kramdown = String((kd.data as { kramdown?: string } | null)?.kramdown ?? "").replace(
        /^\s*(?:>\s*)?\{:[^}\n]*\bid="[^"]*"[^\n]*$/gm,
        ""
    );
    // 源判空加固（Issue #42）：带 id 的文档根 IAL 已被上面那条正则剥掉、
    // `trim()` 足以挡住空壳；这里再收口一遍**不带 id 的属性行**与空围栏
    // 残渣，免得同类的垃圾源白烧一次 AI 调用才被判「不能出题」。
    // 纯读侧判空，不改 kramdown 本体，不碰 questionHash 冻结口径。
    if (!kramdown.trim() || isBlankSource(kramdown)) return zero("failed", t("convertEmptyDoc"));

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
            }); // 学科在 openSet 后补（首批报出时题集已在）
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
    /** 学科（Issue #83）：各片首批判定行顺带报出，**首个非空**即该卷学科
     *  （判不出写「无」→ 归 undefined，整篇无学科即不落字段、判别回退题型
     *  并集）。落库走 SetWriter.openSet 的「只填不改」（见 submit）。 */
    let genSubject: string | undefined;

    /** 归一化索引（@@TO 片段定位用，长文档只建一次，跨片共享）。 */
    const normIndex = buildNormIndex(kramdown);
    /** 已落库累积视图（渐进预览直用）与本次运行写入清单（丢弃回收）。 */
    const previewList: WenguQuestion[] = [];
    const previewMats: WenguMaterial[] = [];
    const writtenQids: string[] = [];
    const generatedKds: string[] = [];
    let count = 0;
    /** 已落库批数：submit 每落一批 +1（进度回调 ConvertProgress.batch 的
     *  口径）。AI 批可能零产物而不发 submit，故它与收口的「AI 调用批数」
     *  不是一回事——两者必须各累各的，混用即双重累计。 */
    let flushedBatches = 0;
    let emptyBatches = 0; // AI 批返回可解析题目数为 0 的批数（完成消息附警告）
    let anchorMiss = 0; // @@TO 缺失/定位失败的批数（兜底推进，可能漏窗口末尾残题）
    let refused = ""; // 首片首批判定「不能出题」的原因（零产物收口时用）
    let firstError = "";
    /** 学科是否已落库（Issue #83；首批报出后写一次，后续批次不再重复调） */
    let subjectWritten = false;
    let userAborted = false;
    let flushedCursor = baseFrom; // 已落库的连续前缀末尾（续跑断点）
    const internal = new AbortController();
    /** 本流程的「用户终止」总闸（唯一写入点）：置标记 + 断在途 fetch +
     *  worker 池收口。页内停止钮（relayAbort）与面板「停止」（aiStopHandle）
     *  走的是同一个 abortFlow = 「面板点停 ≡ 页内停止」，不是只断一笔 fetch。
     *  ⚠️ 不能只调 internal.abort()：收口会判成「AI 失败」（Issue #72）。 */
    const abortFlow = (): void => {
        userAborted = true;
        // 带 AI_STOPPED 理由：在途那笔据此记「停止」而非「失败」（Issue #88）。
        // ⚠️ 下面兄弟失败的 internal.abort() **不带**理由——两者必须能分辨。
        internal.abort(AI_STOPPED);
    };
    const relayAbort = (): void => abortFlow();
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

    /** 交付计划的**纯计算层**（audit #109 点名的 pair plan/apply 惯例：
     *  本文件此前是家族里的唯一例外）。只读当前内存态，不调内核、不写库、
     *  不发通知——批号与题数口径因此可直测（产物见 SubmitPlan）。 */
    const planSubmit = (batch: SegmentBatch): SubmitPlan => {
        // 题集不存在即建（本次首个 submit），存在则续挂；两路都带
        // `subject`（**只填不改**：新建落首批报出的学科，续跑的存量题集
        // 首次补上、已带学科的不被覆写）。既有题集只在首批报出后补一次。
        // plan 侧的判据与 apply 侧一致：`open` 只决定 apply 是否走 openSet。
        const open = !setId || (genSubject && !subjectWritten);
        const nq = batch.drafts.filter((d) => !d.material).length;
        // 行名任务名化（Issue #88）：批号（本批是全片第几批）与题数（本批
        // 产出几道题）此刻才知道——AI 会话面板那行从此是「生成第 12 批
        // · 8 题」而非类别名「转换」。**逐片批号**：片是并行单元，跨片
        // 累加序不确定；片内序即用户读到的「第几批」，不会因并发漂移。
        const retitle = batch.sid
            ? fmt(t("aiRecordConvertBatch"), { i: String(batch.batchNo), n: String(nq) })
            : undefined;
        return { open, nq, nextCursor: Math.max(flushedCursor, batch.end), retitle };
    };

    /** 计划的**执行层**：写库 + 落盘 + 改名 + 报进度。返回本批落库题数。
     *  编排次序与拆出前逐字一致（openSet → append → segs/整篇哈希 →
     *  flush → 断点检查点 → 进度回调）。 */
    const applySubmit = async (batch: SegmentBatch, plan: SubmitPlan): Promise<number> => {
        if (plan.open) {
            setId = await writer.openSet({
                setId,
                title: info.title,
                srcId: docId,
                hPath: info.hPath,
                subject: genSubject,
            });
            if (genSubject) subjectWritten = true;
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
        if (batch.sid && plan.retitle) aiSessions()?.retitle(batch.sid, plan.retitle);
        // 落库批数的推进（plan 算好、apply 照做；见 SubmitPlan）
        count += plan.nq;
        flushedBatches++;
        flushedCursor = plan.nextCursor;
        // 源级哈希 + 分段边界表（Issue #74）：每批落库后记一段
        // `{s, e, h}`（e=**本批实际落库游标**，段首尾相接、连续覆盖
        // [0, flushedCursor]），并把整篇哈希写进题集——重导据此判「源未
        // 变更」（零动作）与「第 k 段起变更」（从该段起重转）。续跑时在
        // 既有段表上**继续追加**、整篇哈希以续跑时的源为准覆写。
        // 放在 flush 前后都安全（同一份内存数据），取 flush 前写入以便
        // 与记录同批落盘。
        const segSet = setId ? opts.bank.peek()?.sets?.[setId] : undefined;
        if (segSet) {
            segSet.segs = advanceSegs(segSet.segs, batch.start, flushedCursor, kramdown);
            segSet.srcContentHash = hashContent(kramdown);
        }
        await opts.bank.flush(); // 每批即落盘（崩溃安全，终止/丢弃语义建立在已落库上）
        // 断点检查点（Issue #62）：本批已落库，此刻崩溃可从 flushedCursor 续跑
        if (opts.onCheckpoint && setId) {
            opts.onCheckpoint({
                setId,
                title: info.title,
                offset: flushedCursor,
                batches: flushedBatches, // 已落库批数（非「AI 调用批数」，见 opts 注释）
                total: 0, // 中途未知
                count,
            });
        }
        opts.onProgress({
            phase: flushedCursor >= kramdown.length ? "writing" : "generating",
            batch: flushedBatches,
            total: 0,
            count,
            lastBatch: plan.nq,
            readPct: readPct(),
            newStems,
            setId,
            title: info.title,
            questions: [...previewList],
            materials: [...previewMats],
        });
        return plan.nq;
    };

    /** 交付一批：等本片前驱落库完成 → plan → apply（落库/改名/报进度）。 */
    const submit = async (idx: number, batch: SegmentBatch): Promise<number> => {
        if (idx > 0) await gates[idx - 1].promise; // 片序闸门（连续前缀）
        if (internal.signal.aborted) return 0;
        const linked = batch.byAlias ? applyKnowDrafts(batch.drafts, batch.byAlias) : 0;
        knowLinked += linked;
        // 纯计算先定下写库参数/题数/批号，执行层照做（见 planSubmit 注释）。
        // 注意 **先 plan 再 apply**：apply 内部的 openSet 会给 setId 铸新值，
        // 落库目标一律读 apply 里**此刻**的 setId（不能把旧值传进来）。
        return applySubmit(batch, planSubmit(batch));
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
        reportSubject: (subject) => {
            // 首个非空即该卷学科（同卷各片一致，后续片只是不同意措辞）
            if (subject && !genSubject) genSubject = subject;
        },
        makeCall: (step: () => StepContext | undefined, onSid: (sid: string) => void) =>
            makeKnowAwareAi({
                modelId: opts.modelId,
                signal: internal.signal,
                knowIndex,
                label: info.title,
                group: trackGroup,
                // 生成调用的登记 id 回传（Issue #88）：批落库后据它把面板行名
                // 改成「生成第 N 批 · M 题」——**与下面的 abort.onSid 并存**，
                // 两条链各管一段（改名 / 停止）
                onGenerateSid: onSid,
                // 面板「停止」接线（Issue #72）：面板对该流任一 running
                // 记录点停 = 走 abortFlow，与页内停止钮**同一总闸**（置
                // 「用户终止」标记 + 断在途 fetch + worker 池收口 → 单篇转
                // 保留/丢弃抉择、队列篇间收口），不是只断一笔 fetch。
                // 句柄的 signal 传 internal.signal 而非 opts.signal：后者是
                // TYPES 检测等其他链路的中止源，接成 stop 会把批次收口误判
                // 成「用户终止」）。
                abort: aiStopHandle(internal.signal, abortFlow),
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
    // 收口统计：各片 **AI 调用批数**之和——最终结果与进度记录的 batches/total
    // 用它。它与进度回调的 flushedBatches（「已落库批数」）互不相干却同时
    // 发生，20260910 分片并行改造一度把两者累进同一变量，面板/终止提示的批数
    // 因此约为实际值两倍；此处刻意分名分账。
    let aiBatches = 0;
    for (const r of segs) {
        if (!r) continue;
        aiBatches += r.batches;
        emptyBatches += r.emptyBatches;
        anchorMiss += r.anchorMiss;
    }
    if (userAborted || firstError) {
        await opts.bank.flush().catch((): void => undefined); // 已落库部分先保住（保留抉择的标的）
        return {
            status: userAborted ? "aborted" : "failed",
            message: userAborted ? "" : `${t("convertAiFailed")}${firstError}`,
            count,
            batches: aiBatches,
            total: aiBatches,
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
                batches: aiBatches,
                total: aiBatches,
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
        batches: aiBatches,
        total: aiBatches,
        doneOffset: kramdown.length,
        writtenQids,
    };
}
