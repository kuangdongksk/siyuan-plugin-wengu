import { esc, fmt } from "../../../ui/shared";
import { beginAiFlow, chooseAiFlow, endAiFlow, progressAiFlow, type AiFlowChoice } from "../../../ai/core/FlowRegistry";
import {
    batchHeadText,
    convertRunSnapshot,
    discardConvertRun,
    keepConvertRun,
    progressStatusText,
    stopConvertRun,
    subscribeConvertRun,
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
 */

/** 转换流的横幅 id（active 单例 ⇒ 固定 id；同 id begin 幂等）。 */
export const CONVERT_FLOW_ID = "convert";

let unsub: (() => void) | undefined;
let lastPhase = "";

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
    if (snap.batch) return plain(batchHeadText(t, snap.batch)) + batchProgressOf(t, snap);
    return snap.progress ? plain(progressStatusText(t, snap.progress)) : t("converting");
}

/** 批量队列的构成条（六态计数；零值照常列全，压暗由渲染侧样式承担——
 *  与页内分篇行同源口径，不只是「跑动的篇」）。 */
function batchProgressOf(t: (k: string) => string, snap: ConvertRunSnapshot): string {
    const items = snap.batch?.items ?? [];
    if (items.length === 0) return "";
    const n = (s: string): number => items.filter((x) => x.status === s).length;
    // 六态：done/skipped/stopped/failed/cancelled/queued（running 单列，
    // 它就是「第 i/N 篇」那句本身）
    return (
        " · " +
        fmt(t("aiFlowBatchCounts"), {
            d: String(n("done")),
            k: String(n("skipped")),
            s: String(n("stopped")),
            f: String(n("failed")),
            c: String(n("cancelled")),
        })
    );
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
        return;
    }
    if (phase !== lastPhase) {
        // 起流：标题固定「AI 转习题」；stop=整条流的总闸（页内停止同一处）
        beginAiFlow({ id: CONVERT_FLOW_ID, title: t("convertBtn"), stop: stopOf });
        lastPhase = phase;
    }
    if (phase === "choice") chooseAiFlow(CONVERT_FLOW_ID, progressOf(t, snap), choiceOf());
    else progressAiFlow(CONVERT_FLOW_ID, progressOf(t, snap));
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
}
