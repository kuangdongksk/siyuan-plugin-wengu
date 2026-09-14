import { esc, fmt } from "../../../ui/shared";
import {
    beginAiFlow,
    chooseAiFlow,
    endAiFlow,
    progressAiFlow,
    type AiFlowChoice,
    type AiFlowCounts,
    type AiFlowEntryItem,
    type AiFlowQueue,
    type AiFlowStatField,
} from "../../../ai/core/FlowRegistry";
import { flowBar } from "../../../ai/core/FlowBannerUi";
import {
    batchHeadText,
    convertRunSnapshot,
    discardConvertRun,
    keepConvertRun,
    progressStatusText,
    stopConvertRun,
    subscribeConvertRun,
    type ConvertBatchItem,
    type ConvertRunSnapshot,
} from "./ConvertRun";

/**
 * 转换族 × 流级横幅（Issue #77）：把 ConvertRun 单例的**既有状态机**映射
 * 成 ai 域通用注册表（ai/core/FlowRegistry）里的一条流，让面板顶部的横幅
 * 成为整卷/批量转换的停止与收口入口。
 *
 * 设计取舍：横幅**不**被 ConvertRun 直接调用，而是订阅既有的
 * `subscribeConvertRun`（快照每推进一步都通知）后单向同步——好处有三：
 *  1. `ConvertBatch`（在途 #74 的战场）**一行都不用改**，冲突面为零；
 *  2. 状态机仍是唯一真相（横幅只是它的一个视图），不会出现两套进度数字；
 *  3. 「end 必达」由快照收敛（无快照即无横幅）天然保证——任何收口路径
 *     （done/failed/aborted→抉择落定）最终都让快照变 undefined。
 *
 * 流 id 固定（转换有 active 单例，同时只会有一条）：同 id 重复 begin 是
 * 幂等刷新，不会与其它流互相顶掉。
 *
 * **结构折算（Issue #85）**：设计稿的构成条/六态计数/分篇清单需要结构化
 * 数据，而 `FlowRegistry` 是**通用注册表**（不得泄漏 convert 类型）。故
 * 本模块承担「ConvertRun 快照 → 通用形态」的折算：`queue.items` 用
 * `{index,name,state,reason,note,metric}`、`queue.counts` 用六态数字、
 * `stats` 用 `{hint,value}`，注册表侧零业务字段。
 */

/** 转换流的横幅 id（active 单例 ⇒ 固定 id；同 id begin 幂等）。 */
export const CONVERT_FLOW_ID = "convert";

let unsub: (() => void) | undefined;
let lastPhase = "";
/** 已渲染的计数（避免每次进度推进都重建 queue 对象触发无谓重渲）。 */
let lastCountsKey = "";

/** 剥 HTML 标签（转换文案函数回的是 HTML 安全串，横幅要纯文本）。
 *  纯字符串处理——横幅可能在任何时刻同步（含单测），不引入 DOM 依赖。 */
function plain(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

/** 六态计数（**必须含 queued**，Issue #85 验收：排队是跑动期最该看到的
 *  一态；`stopped` 单列——它是「被停的那一篇」，与「进行中」不同色）。 */
export function countsOf(items: ConvertBatchItem[]): AiFlowCounts {
    const n = (s: ConvertBatchItem["status"]): number => items.filter((x) => x.status === s).length;
    return {
        done: n("done"),
        skipped: n("skipped"),
        running: n("running"),
        failed: n("failed"),
        cancelled: n("cancelled"),
        queued: n("queued"),
        stopped: n("stopped"),
    };
}

/** 计数的指纹（只有真的变了才重建 queue，减少无谓重渲）。 */
function countsKeyOf(c: AiFlowCounts): string {
    return `${c.done}/${c.skipped}/${c.running}/${c.stopped ?? 0}/${c.failed}/${c.cancelled}/${c.queued}`;
}

/** 分篇行的备注列（设计稿 dr-note 是「本篇局部量」，如「本批 8 题 · 轮次 3」）。 */
function noteOf(t: (k: string) => string, item: ConvertBatchItem): string {
    if (item.status === "running" && item.progress) {
        const p = item.progress;
        return p.readPct !== undefined
            ? fmt(t("aiFlowRowNoteRead"), { p: String(p.readPct) })
            : fmt(t("aiFlowRowNoteBatch"), { c: String(p.count) });
    }
    if (item.status === "stopped") return fmt(t("aiFlowRowNoteGenerated"), { c: String(item.count) });
    if (item.status === "cancelled") return t("aiFlowRowNoteCancelled");
    if (item.status === "queued") return t("aiFlowRowNoteQueued");
    if (item.status === "skipped") return t("aiFlowRowNoteSkipped");
    if (item.status === "done") return t("aiFlowRowNoteDone");
    // 失败行：设计稿备注是「已重试 2 次 · 不阻塞后续篇」——我们没有重试计数
    //（批次失败即翻牌），只落真实成立的那半（宁缺勿错，不编造次数）
    if (item.status === "failed") return t("aiFlowRowNoteFailed");
    return "";
}

/** 分篇行的指标列（右对齐 mono）。 */
function metricOf(t: (k: string) => string, item: ConvertBatchItem): string {
    if (item.status === "running" && item.progress?.readPct !== undefined) {
        return fmt(t("aiFlowRowMetricRead"), { p: String(item.progress.readPct) });
    }
    if (item.count > 0) return fmt(t("aiFlowRowMetricCount"), { c: String(item.count) });
    return "—";
}

/**
 * 快照 → 队列维度（通用形态；**不含任何 convert 类型**）。
 * 分篇清单**全量**交给注册表，截断与窗口标注由渲染侧纯逻辑决定（面板与
 * 页内两条链共用同一份窗口口径）。
 */
function queueOf(t: (k: string) => string, snap: ConvertRunSnapshot): AiFlowQueue | undefined {
    const items = snap.batch?.items ?? [];
    if (items.length === 0) return undefined;
    const counts = countsOf(items);
    const running = items.findIndex((x) => x.status === "running");
    const stopped = items.findIndex((x) => x.status === "stopped");
    const settled = items.filter((x) => x.status !== "running" && x.status !== "queued").length;
    const current = running >= 0 ? running + 1 : stopped >= 0 ? stopped + 1 : Math.max(1, settled);
    const rows: AiFlowEntryItem[] = items.map((x) => ({
        index: x.index + 1,
        name: x.title,
        state: x.status,
        reason: x.status === "failed" ? plain(x.message || t("convertNoQuestions")) : undefined,
        note: noteOf(t, x),
        metric: metricOf(t, x),
    }));
    return { title: snap.batch?.title, total: items.length, current, counts, items: rows };
}

/** 富统计行（数字单独拎给渲染侧强调；两态首段不同——停止态「停在第 i/N 篇」）。 */
function statsOf(
    t: (k: string) => string,
    snap: ConvertRunSnapshot,
    queue: AiFlowQueue | undefined
): AiFlowStatField[] {
    const out: AiFlowStatField[] = [];
    // 「第 **12**/24 篇」：数字加粗、单位（/24 篇）与说明词都在加粗外
    if (queue) {
        const head = snap.pendingChoice ? t("aiFlowStatStoppedAt") : t("aiFlowStatAt");
        out.push({ hint: head, value: String(queue.current ?? 0), tail: `/${queue.total} ${t("aiFlowUnitItem")}` });
    }
    // ⚠️ 停止态快照**不带 progress**（aborted 槽只留 pending + items），直接读
    // snap.progress 会让停止屏只剩「停在第 i/N 篇」一段——设计稿的停止屏是
    // 四段（停在第 i/N 篇 · 本篇已读 % · 累计 c 题 · 已生成 b 批）。故停止态
    // 从「被停的那一篇」（state=stopped）与 pending 取数，口径与跑动态同源。
    const stoppedItem = snap.pendingChoice ? snap.batch?.items.find((x) => x.status === "stopped") : undefined;
    const p = snap.progress;
    const readPct = p?.readPct ?? stoppedItem?.progress?.readPct;
    if (readPct !== undefined) out.push({ hint: t("aiFlowStatRead"), value: `${readPct}%` });
    // 「累计 c 题」在队列屏是**队列累计**（各篇已落库题数之和，设计稿 148 =
    // 9 篇完成 + 46 + 32 + …），不是当前篇的数——直接拿 p.count 会把「累计」
    // 写成一篇的量。单篇流（无 queue）的 p.count 本就是该文档累计，照旧。
    const cum = queue
        ? ((snap.pendingChoice ? snap.pending?.count : undefined) ??
          (snap.batch?.items ?? []).reduce((n, x) => n + x.count, 0))
        : p?.count;
    if (cum !== undefined) out.push({ hint: t("aiFlowStatTotal"), value: String(cum), tail: ` ${t("aiFlowUnitQ")}` });
    const batches = snap.pendingChoice ? snap.pending?.batches : p?.batch;
    if (batches !== undefined && batches > 0) {
        out.push({ hint: t("aiFlowStatBatches"), value: String(batches), tail: ` ${t("aiFlowUnitBatch")}` });
    }
    return out;
}

/** 单流进度条（无队列维度时；pct 由既有 progress 读数来）。 */
function barOf(t: (k: string) => string, snap: ConvertRunSnapshot): ReturnType<typeof flowBar> | undefined {
    const pct = snap.progress?.readPct;
    if (pct === undefined) return undefined;
    return flowBar(pct, fmt(t("aiFlowStatRead"), { p: String(pct) }));
}

/** 快照 → 进度摘要（页内转换条与横幅**同一份文案函数**，口径一致）。 */
function progressOf(t: (k: string) => string, snap: ConvertRunSnapshot): string {
    if (snap.pendingChoice && snap.pending) {
        return plain(
            esc(
                fmt(t("convertStopped"), {
                    c: String(snap.pending.count),
                    b: String(snap.pending.batches),
                    n: String(snap.pending.total),
                })
            )
        );
    }
    if (snap.batch) return plain(batchHeadText(t, snap.batch));
    return snap.progress ? plain(progressStatusText(t, snap.progress)) : t("converting");
}

/** 副标题（设计稿 fb-title 的第二行）：批量队列「批量队列 ·《卷名》」、
 *  单流「单篇 ·《卷名》」。分隔符与书名号是**语言相关写法**，整串归 i18n
 *  模板（代码里拼会把中英两套写法各钉死一次）；卷名取不到时只出前段
 *  （不留孤零零的分隔符）。 */
function subtitleOf(t: (k: string) => string, snap: ConvertRunSnapshot): string {
    const head = snap.batch ? t("aiFlowSubBatch") : t("aiFlowSubSingle");
    const title = snap.batch?.title || snap.title || "";
    return title ? fmt(t("aiFlowSub"), { head, title }) : head;
}

/** 待抉择态的保留/丢弃接线（与页内转换条同一条导出函数，零新通道）。 */
function choiceOf(): AiFlowChoice {
    return { keep: () => void keepConvertRun(), discard: () => discardConvertRun() };
}

/** 按当前快照同步横幅（订阅回调与首次同步共用）。 */
function sync(t: (k: string) => string): void {
    const snap = convertRunSnapshot();
    const phase = !snap ? "none" : snap.pendingChoice ? "choice" : "running";
    if (phase === "none") {
        if (lastPhase !== "none") endAiFlow(CONVERT_FLOW_ID);
        lastPhase = phase;
        lastCountsKey = "";
        return;
    }
    if (phase !== lastPhase) {
        // 起流：主标题随阶段定（跑动中 / 已停止等待抉择）；stop=整条流的总闸；
        // 停止钮**范围词随粒度**（批量「停止整批转换」/ 单篇「停止转换」，
        // 设计稿 Q4「动作名即范围」）——必须在起流时定，故 queueOf 先算一次
        const q0 = queueOf(t, snap);
        beginAiFlow({
            id: CONVERT_FLOW_ID,
            title: phase === "choice" ? t("aiFlowTitleStopped") : t("aiFlowTitleRunning"),
            stop: stopOf,
            stopKey: q0 ? "aiFlowStopBatch" : "aiFlowStopSingle",
        });
        lastPhase = phase;
    }
    const queue = queueOf(t, snap);
    const key = queue ? countsKeyOf(queue.counts) : "";
    const stats = { fields: statsOf(t, snap, queue) };
    // 构成条/计数只在**真的变了**时重建（进度推进很频繁，全量重建会让
    // Svelte 每 tick 重渲整条清单）
    const queuePatch = queue && (key !== lastCountsKey || phase === "choice") ? queue : undefined;
    if (queue) lastCountsKey = key;
    const payload = {
        subtitle: subtitleOf(t, snap),
        stats,
        bar: barOf(t, snap),
        queue: queuePatch,
        stopped: phase === "choice",
    };
    if (phase === "choice") chooseAiFlow(CONVERT_FLOW_ID, progressOf(t, snap), choiceOf());
    else progressAiFlow(CONVERT_FLOW_ID, progressOf(t, snap), undefined, payload);
    // 抉择态的 queue/stats 也要落地（chooseAiFlow 不动结构化字段，单独推）
    if (phase === "choice") progressAiFlow(CONVERT_FLOW_ID, undefined, undefined, payload);
}

/** 停止动作 = 页内转换条的停止钮**同一处**（不新造中止通道）。 */
function stopOf(): void {
    stopConvertRun();
}

/**
 * 接线（转换入口启动时调一次；幂等）。t 由视图侧传——横幅文案要 i18n，
 * 注册表本身不碰取词（同 ai/flow 的口径）。
 */
export function attachConvertFlow(t: (k: string) => string): void {
    if (unsub) {
        sync(t);
        return;
    }
    unsub = subscribeConvertRun(() => sync(t));
    sync(t);
}

/** 退订（视图销毁；横幅由 end 收口，不靠这里清）。 */
export function detachConvertFlow(): void {
    unsub?.();
    unsub = undefined;
    lastPhase = "";
    lastCountsKey = "";
}
