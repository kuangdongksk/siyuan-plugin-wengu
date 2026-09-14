/**
 * 流级横幅的**纯展示判定**（Issue #77 起、Issue #85 扩到设计稿口径，带
 * 单测）：把注册表快照 + 两击确认态 + i18n 取词，折算成组件直接渲染的
 * 视图模型。放在 core 里而不是组件内，是为了让「构成条怎么分段、六态
 * 计数怎么分色与压暗、分篇清单展示哪一段、停止钮几时出」这些口径可被
 * 单测锁死（组件零 `<style>`、只做渲染）。
 *
 * 设计稿 `design/convert-stop-redesign.html` 的三屏对应：
 *  - `flow-banner--run`  批量队列跑动中 → seg + counts + 分篇清单
 *  - `flow-banner--stop` 停止后抉择态   → 左线 + badge + 「前往页内转换条抉择」
 *  - `redesign-single-running` 单流态   → bar + stats，无 seg/counts/清单
 *
 * ⚠️ **两屏各 6 个 chip**（不是 7）：设计稿跑动屏列「完成/跳过/进行中/失败/
 * 取消/排队」、停止屏列「完成/跳过/停止/失败/取消/排队」——**进行中与停止
 * 共用一格**（同位置、同主题色，语义上互斥）。多列一条零值 chip 即与稿不符。
 */

import { fmt } from "../../ui/shared";
import type {
    AiFlowBar,
    AiFlowCounts,
    AiFlowEntryItem,
    AiFlowItemState,
    AiFlowQueue,
    AiFlowSnapshot,
} from "./FlowRegistry";

/** 构成条的一段：一个色类 + flex 权重（=篇数），零篇的段不出。 */
export interface AiFlowSeg {
    /** 样式类（`wengu-aiflow-seg-done` 等；与设计稿 s-* 一一对应）。 */
    cls: string;
    /** flex 权重（该态篇数）。 */
    weight: number;
}

/** 六态计数的 chip（零值压暗 `isZero`）。 */
export interface AiFlowChip {
    key: string;
    /** 计数值。 */
    n: number;
    /** 零值（样式压暗 + 数字换弱化色）。 */
    isZero: boolean;
}

/** 分篇清单的一行（渲染侧形态）。 */
export interface AiFlowRow {
    /** 补零后的两位序号（设计稿 dr-idx 是 mono 两位）。 */
    idx: string;
    name: string;
    /** 状态词（已取词）。 */
    stateText: string;
    /** 状态色类（st-done/st-run/st-fail；缺省=默认弱色）。 */
    stateCls: string;
    /** 状态点样式类（dot--done 等）。 */
    dotCls: string;
    note: string;
    metric: string;
    /** 当前行（主题色高亮）。 */
    current: boolean;
    /** 取消行（篇名删除线）。 */
    cancelled: boolean;
    /** 排队行（篇名压弱化色——「还没跑」与「跑过了」在行上要分得开）。 */
    queued: boolean;
}

/** 分篇清单的展示窗口（表头右侧「第 a–b 篇 · 共 N 篇」标注用）。 */
export interface AiFlowListWindow {
    from: number;
    to: number;
    total: number;
    label: string;
}

/** 横幅视图模型（组件只读渲染）。 */
export interface AiFlowBannerView {
    /** 主标题。 */
    title: string;
    /** 副标题（可空=不出）。 */
    subtitle: string;
    /** 旧口径的进度摘要（无结构化数据时才渲染；可空）。 */
    progress: string;
    /** 附加统计（旧口径；六批流的纯文本）。 */
    extra: string;
    /** 富统计字段（数字单独强调；`tail` 是数字后的计量单位，不进加粗）。 */
    stats: { hint: string; value: string; tail: string }[];
    /** 单流进度条（无 queue 且 bar 在场时出；0~100）。 */
    bar?: number;
    barLabel: string;
    /** 构成条分段（有 queue 时；全零/无 queue 则空数组=不出条）。 */
    segs: AiFlowSeg[];
    /** 构成条的 aria-label（已取词、成品串；无 queue 时为空串）。 */
    segLabel: string;
    /** 总篇数（counts 的 lead「共 N 篇」）。 */
    total: number;
    /** counts 的 lead 成品文案（「共 24 篇」；i18n 模板，含计量单位）。 */
    totalLabel: string;
    /** 六态 chips（有 queue 时；顺序固定，**进行中与停止共用一格**——
     *  设计稿两屏各 6 chip，跑动屏出「进行中」、停止屏出「停止」）。 */
    chips: AiFlowChip[];
    /** 分篇清单行（展开且非空时；收起时为空数组）。 */
    rows: AiFlowRow[];
    listWindow?: AiFlowListWindow;
    /** 清单是否可以展开（有 queue 且篇数 ≥1）。 */
    expandable: boolean;
    /** 展开态（组件持有；回显给渲染侧）。 */
    expanded: boolean;
    /** 停止态视觉（左线 + 暖底 + badge + 「前往页内转换条抉择」链）。 */
    stopped: boolean;
    /** running：出停止钮（两击确认文案随 armed 变）。 */
    stopping: boolean;
    /** choice：出保留/丢弃钮（**不回退** #77 既有行为）。 */
    choosing: boolean;
    /** 停止钮文案键（组件取词；armed 时是「再击确认停止」）。
     *  **动作名即范围**（设计稿 Q4）：批量「停止整批转换」/ 单篇「停止转换」
     *  ——停的是整条流，用户不必先读文档才知道范围。 */
    stopKey: string;
}

/** i18n 取词入口（strip 文案前缀 → 渲染侧拼装；组件不碰取词）。 */
type T = (k: string) => string;

/** 六态的顺序与样式类（**渲染顺序固定**，与设计稿 counts 行逐字一致）。 */
const CHIP_ORDER: { key: string; cls: string }[] = [
    { key: "aiFlowChipDone", cls: "done" },
    { key: "aiFlowChipSkipped", cls: "skip" },
    { key: "aiFlowChipRunning", cls: "run" },
    { key: "aiFlowChipStopped", cls: "stop" },
    { key: "aiFlowChipFailed", cls: "fail" },
    { key: "aiFlowChipCancelled", cls: "cancel" },
    { key: "aiFlowChipQueued", cls: "queued" },
];

/** 分篇行状态 → 样式类/状态点/状态词键（设计稿 doc-row 的六态）。 */
const ROW_STATE: Record<AiFlowItemState, { cls: string; dot: string; key: string }> = {
    done: { cls: "st-done", dot: "done", key: "aiFlowChipDone" },
    skipped: { cls: "st-done", dot: "skip", key: "aiFlowRowSkipped" },
    running: { cls: "st-run", dot: "run", key: "aiFlowChipRunning" },
    stopped: { cls: "st-run", dot: "stop", key: "aiFlowRowStopped" },
    failed: { cls: "st-fail", dot: "fail", key: "aiFlowChipFailed" },
    cancelled: { cls: "", dot: "cancel", key: "aiFlowChipCancelled" },
    queued: { cls: "", dot: "queued", key: "aiFlowChipQueued" },
};

/** 构成条分段的顺序 = **设计稿的 DOM 视觉序**（done → skip → fail →
 *  run/stop → cancel → queued）：稿里跑动屏是 s-done/s-skip/s-fail/s-run/
 *  s-queued，停止屏是 …/s-fail/s-stop/s-cancel —— 红段在主题段**之前**。
 *  ⚠️ 别拿 chips 的顺序来排条：chips 是 done/skip/run/stop/fail/cancel/
 *  queued，两处口径本就不同（稿的停止屏 aria 跟**条**走、chips 另排）。 */
const SEG_ORDER: { key: AiFlowItemState; cls: string }[] = [
    { key: "done", cls: "done" },
    { key: "skipped", cls: "skip" },
    { key: "failed", cls: "fail" },
    { key: "running", cls: "run" },
    { key: "stopped", cls: "stop" },
    { key: "cancelled", cls: "cancel" },
    { key: "queued", cls: "queued" },
];

/** 计数取值：stopped 态下 running 篇（被停的那篇）算进 stopped 段。 */
function segCounts(counts: AiFlowCounts): Record<AiFlowItemState, number> {
    const stopped = counts.stopped ?? 0;
    return {
        done: counts.done,
        skipped: counts.skipped,
        running: Math.max(0, counts.running - stopped),
        stopped,
        failed: counts.failed,
        cancelled: counts.cancelled,
        queued: counts.queued,
    };
}

/**
 * 构成条分段（纯函数、带单测）：**按篇数 flex 分段**，零篇的段不出
 * （出零权重段会挤出一条 2px 的缝）。总篇数为 0 时返回空数组（不出条）。
 */
export function flowSegs(queue: AiFlowQueue | undefined): AiFlowSeg[] {
    if (!queue || queue.total <= 0) return [];
    const n = segCounts(queue.counts);
    return SEG_ORDER.filter((s) => n[s.key] > 0).map((s) => ({ cls: s.cls, weight: n[s.key] }));
}

/** 构成条 aria-label（成品串；无 queue/总篇数 0 时为空串=不出条）。 */
export function flowSegLabel(t: T, queue: AiFlowQueue | undefined): string {
    if (!queue || queue.total <= 0) return "";
    const n = segCounts(queue.counts);
    const unit = t("aiFlowUnitItem");
    const parts = SEG_ORDER.filter((s) => n[s.key] > 0).map((s) => `${t(rowKeyOf(s.key))} ${n[s.key]} ${unit}`);
    // 顿号/逗号是**语言相关标点**（英文用 ", "），故连接符与前后缀一起归
    // i18n 模板——旧 aiFlowBatchCounts 也是整串模板的口径。
    return fmt(t("aiFlowSegLabel"), { parts: parts.join(t("aiFlowSegJoin")), n: String(queue.total) });
}

/** 段/行共用的状态词键（构成条的 aria-label 与 counts 行同一组词）。 */
function rowKeyOf(state: AiFlowItemState): string {
    const found = CHIP_ORDER.find((c) => c.cls === STATE_TO_CHIP[state]);
    return found?.key ?? "aiFlowChipQueued";
}

/** 状态 → counts chip 的 cls（seg 与 chip 的分色一一对应）。 */
const STATE_TO_CHIP: Record<AiFlowItemState, string> = {
    done: "done",
    skipped: "skip",
    running: "run",
    stopped: "stop",
    failed: "fail",
    cancelled: "cancel",
    queued: "queued",
};

/** 六态 chips（**顺序固定**；零值 `isZero` 压暗——设计稿 chip.is-zero）。 */
export function flowChips(counts: AiFlowCounts): AiFlowChip[] {
    const n = segCounts(counts);
    const pick: Record<string, number> = {
        done: n.done,
        skip: n.skipped,
        run: n.running,
        stop: n.stopped,
        fail: n.failed,
        cancel: n.cancelled,
        queued: n.queued,
    };
    // **进行中与停止共用一格**（设计稿两屏各 6 chip）：跑动屏出「进行中」
    //（取消 0 照常列、is-zero 压暗），停止屏出「停止」而**不再列零值
    //「进行中」**——两态各留一条零值 chip 是设计稿的明示口径（跑动屏的
    // is-zero 示例正是「取消 0」），多列一条即与稿不符（7 chip）。
    const out = CHIP_ORDER.filter(
        (c) => !(c.cls === "stop" && pick.stop === 0) && !(c.cls === "run" && pick.stop > 0)
    ).map((c) => ({ key: c.key, n: pick[c.cls] ?? 0, isZero: (pick[c.cls] ?? 0) === 0 }));
    return out;
}

/** 分篇清单的一行（状态词 + 原因后缀，与 convert 域 batchItemStatusText 同口径）。 */
function rowOf(t: T, item: AiFlowEntryItem, currentIndex: number): AiFlowRow {
    const meta = ROW_STATE[item.state];
    const stateText = item.reason ? `${t(meta.key)} · ${item.reason}` : t(meta.key);
    return {
        idx: String(item.index).padStart(2, "0"),
        name: item.name,
        stateText,
        stateCls: meta.cls,
        dotCls: meta.dot,
        note: item.note ?? "",
        metric: item.metric ?? "",
        current: currentIndex > 0 && item.index === currentIndex,
        cancelled: item.state === "cancelled",
        queued: item.state === "queued",
    };
}

/**
 * 清单展示窗口（当前篇居中，不足则向两端补齐；带单测）：
 * 设计稿屏 ① 展示「第 9–14 篇 · 共 24 篇」——当前第 12 篇不在正中而是
 * 窗口起点对齐 9（6 行窗口）。这里取**以当前行为最后 1/3 处**的 6 行窗口，
 * 与设计稿实测窗口形态一致；窗口不足 6 行时向起点补齐。
 */
export const LIST_WINDOW = 6;

export function listWindowOf(total: number, current: number): { from: number; to: number } {
    if (total <= LIST_WINDOW) return { from: 1, to: total };
    const cur = Math.min(Math.max(current, 1), total);
    // 当前行落在窗口第 4 位（0 起：当前在倒数第 3）——设计稿第 12 篇在 6 行
    // 窗口里是第 4 行（9,10,11,12,13,14）
    let from = cur - 3;
    if (from < 1) from = 1;
    if (from + LIST_WINDOW - 1 > total) from = total - LIST_WINDOW + 1;
    return { from, to: from + LIST_WINDOW - 1 };
}

/**
 * 折算视图模型。armed=该流的停止钮正处于两击确认态（`ai-flow:{id}`）；
 * expanded=分篇清单展开态（组件持有时回传）。快照为空即无横幅（返回
 * undefined）。
 */
export function bannerViewOf(
    snap: AiFlowSnapshot | undefined,
    armed: boolean,
    expanded = false,
    t: T = (k) => k
): AiFlowBannerView | undefined {
    if (!snap) return undefined;
    const choosing = snap.phase === "choice";
    const stopped = choosing || snap.stopped === true;
    const queue = snap.queue;
    const hasQueue = !!queue && queue.total > 0;
    const win = hasQueue ? listWindowOf(queue.total, queue.current ?? 0) : undefined;
    const rows = queue && hasQueue && expanded ? sliceRows(t, queue, win!) : [];
    return {
        title: snap.title,
        subtitle: snap.subtitle ?? "",
        progress: snap.progress ?? "",
        extra: snap.extra ?? "",
        stats: snap.stats?.fields.map((f) => ({ hint: f.hint, value: f.value, tail: f.tail ?? "" })) ?? [],
        bar: hasQueue ? undefined : snap.bar?.pct,
        barLabel: snap.bar?.label ?? "",
        segs: flowSegs(queue),
        segLabel: flowSegLabel(t, queue),
        total: hasQueue ? queue.total : 0,
        totalLabel: hasQueue ? fmt(t("aiFlowTotal"), { n: String(queue.total) }) : "",
        chips: hasQueue ? flowChips(queue.counts) : [],
        rows,
        listWindow:
            hasQueue && expanded && win
                ? {
                      from: win.from,
                      to: win.to,
                      total: queue.total,
                      label: fmt(t("aiFlowListRange"), {
                          a: String(win.from),
                          b: String(win.to),
                          n: String(queue.total),
                      }),
                  }
                : undefined,
        expandable: hasQueue,
        expanded,
        stopped,
        stopping: !choosing && !!snap.stop,
        choosing,
        stopKey: stopKeyOf(snap, armed),
    };
}

/** 停止钮取词：**两击确认**优先（任何流都换「再击确认停止」）；否则用
 *  业务域登记的范围词（`stopKey`，缺省=通用「停止」）——**动作名即范围**
 *  （设计稿 Q4：批量「停止整批转换」/ 单篇「停止转换」）。范围词由登记侧
 *  给而不是这里按「有没有队列维度」猜：六批流同样没有队列维度，猜会把
 *  它们的钮错写成「停止转换」。 */
function stopKeyOf(snap: AiFlowSnapshot, armed: boolean): string {
    if (armed) return "aiFlowStopConfirm";
    return snap.stopKey ?? "aiFlowStop";
}

/** 窗口切片（窗口由 listWindowOf 定；行状态词在这里取词）。 */
function sliceRows(t: T, queue: AiFlowQueue, win: { from: number; to: number }): AiFlowRow[] {
    const cur = queue.current ?? 0;
    return queue.items.slice(win.from - 1, win.to).map((item) => rowOf(t, item, cur));
}

/** 单流态构造帮手（转换族/索引流用；纯函数便于单测）。 */
export function flowBar(pct: number, label: string): AiFlowBar {
    return { pct: Math.max(0, Math.min(100, Math.round(pct))), label };
}
