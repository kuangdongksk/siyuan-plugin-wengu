import { fmt } from "../../../ui/shared";
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
import { aiSessions } from "../../../ai/data/AiSessions";
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

/**
 * 源 kramdown 是否「空得只剩残渣」（Issue #42）：逐行剥掉 IAL 属性行与
 * 围栏标记行后，看还剩不剩实质性字符。
 *
 * ⚠️ **这不是空壳文档的判据主力**（复审实测校正，别当根因写）：
 * `getBlockKramdown` 回的文档根 IAL 一定带 `id="…"`，上面那条剥 id 的
 * 正则已经吃掉了它，`!kramdown.trim()` 早已把这批空壳挡住。本函数真正
 * 多挡的是**不带 id 的属性行**（`{: title="…"}` 这类分叉模板残渣）与
 * **空代码围栏**——它们同样会白烧一次 AI 调用。属加固，不是修复根因。
 *
 * 只做「有没有正文」的二值判定，**不改 kramdown 本体**——AI 出题用的是
 * 未改动的 `kramdown`，剥行只是判空的一次性视图。
 *
 * 导出仅为单测（转换主流程唯一消费点就在本文件）。
 */
export function isBlankSource(md: string): boolean {
    for (const line of md.split("\n")) {
        const t = line
            .replace(/^\s*(?:>\s*)?\{:[^}\n]*\}\s*$/, "") // 整行 IAL（含引用前缀）
            .replace(/^\s*```.*$/, "") // 围栏开合标记（无正文的空代码块）
            .trim();
        if (t) return false;
    }
    return true;
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
    /** 已完成批数 / 总批数（展示用；逐段模式两者都是**实际 AI 调用批数**，
     *  含零产物批、不含纯标题跳过窗口——与 SegmentResult.batches 同口径）。 */
    batches: number;
    total: number;
    /** 已生成题数。 */
    count: number;
    /** 批量转换（Issue #37）维度：本记录属于一个串行队列时才有值——索引
     *  0 起、总篇数、队列标题（=根文档标题，面板总行展示「第 x/N 篇 ·
     *  队列名」）、`rootId`（队列根文档 id，面板「继续生成」据此恢复
     *  **整个队列**，Issue #62）。**只加不改名**：单篇转换的记录不带此键、
     *  存量队列记录不带 rootId（「继续生成」退化为单篇续跑），装载侧照旧
     *  （数据演进守则：optional + 无 backfill，不 bump version）。 */
    batch?: { index: number; total: number; groupTitle?: string; rootId?: string };
}

/** 批式转换结果：done=全部完成；aborted=用户终止（已落库部分待抉择）。 */
export interface BatchedResult {
    status: "done" | "aborted" | "failed";
    message: string;
    /** 本转换的题集 id（有落库产物时）。 */
    setId?: string;
    title?: string;
    count: number;
    /** 已完成批数 / 总批数（口径=**实际 AI 调用批数**，含零产物批、不含
     *  纯标题跳过窗口；与进度回调 ConvertProgress.batch「已落库批数」是两个
     *  不同口径，见收口处注释）。 */
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
    const trackGroup = opts.trackGroup ?? { id: newAiGroupId(), title: `转换 · ${info.title}` };
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
    /** 本流程的「用户终止」总闸（唯一写入点）：置标记（收口判据）+
     *  断在途 fetch + worker 池收口。页内停止钮（relayAbort）与 AI 会话
     *  面板的「停止」（aiStopHandle 接线）走的是**同一个** abortFlow——
     *  「面板点停 = 等价于页内停止」就是这条线，不是只断当前一笔 fetch。
     *  ⚠️ 不能只调 internal.abort()：那会让收口判成「AI 失败」而非
     *  「用户终止」（Issue #72 实现期踩到）。 */
    const abortFlow = (): void => {
        userAborted = true;
        internal.abort();
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

    /** 交付一批：等本片前驱落库完成 → 写入 → flush → 报进度。返回落库题数。 */
    const submit = async (idx: number, batch: SegmentBatch): Promise<number> => {
        if (idx > 0) await gates[idx - 1].promise; // 片序闸门（连续前缀）
        if (internal.signal.aborted) return 0;
        const linked = batch.byAlias ? applyKnowDrafts(batch.drafts, batch.byAlias) : 0;
        knowLinked += linked;
        // 题集不存在即建（本次首个 submit），存在则续挂；两路都带
        // `subject`（**只填不改**：新建落首批报出的学科，续跑的存量题集
        // 首次补上、已带学科的不被覆写）。既有题集只在首批报出后补一次。
        if (!setId || (genSubject && !subjectWritten)) {
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
        const nq = batch.drafts.filter((d) => !d.material).length;
        // 行名任务名化（Issue #88）：批号（本批是全片第几批）与题数（本批
        // 产出几道题）此刻才知道——AI 会话面板那行从此是「生成第 12 批
        // · 8 题」而非类别名「转换」。**逐片批号**：片是并行单元，跨片
        // 累加序不确定；片内序即用户读到的「第几批」，不会因并发漂移。
        if (batch.sid) {
            aiSessions()?.retitle(
                batch.sid,
                fmt(t("aiRecordConvertBatch"), {
                    i: String(batch.batchNo),
                    n: String(nq),
                })
            );
        }
        count += nq;
        flushedBatches++;
        flushedCursor = Math.max(flushedCursor, batch.end);
        // 源级哈希 + 分段边界表（Issue #74）：每批落库后记一段
        // `{s, e, h}`（e=**本批实际落库游标**，段首尾相接、连续覆盖
        // [0, flushedCursor]），并把整篇哈希写进题集——重导据此判「源未
        // 变更」（零动作）与「第 k 段起变更」（从该段起重转）。续跑时在
        // 既有段表上**继续追加**、整篇哈希以续跑时的源为准覆写。
        // 放在 flush 前后都安全（同一份内存数据），取 flush 前写入以便
        // 与记录同批落盘。
        const segSet = opts.bank.peek()?.sets?.[setId];
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
