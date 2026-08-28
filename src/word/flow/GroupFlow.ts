import type { WenguWordProgress } from "../core/WordStore";
import { groupSizeOf } from "../core/WordStore";
import { rebuildTail } from "../core/WordTiming";
import type { WordView } from "../core/WordView";

/**
 * 组机制编排（自 WordView.advanceAfterFinish 拆出，压 500 行红线）。
 * 友元函数直接读写 WordView 的会话字段，语义与拆出前一致——组满交
 * AI 复盘、AI 落盘后本地重排余量、会话收尾冲不满的尾组。
 *
 * 触发口径按会话轨区分（redesign §二.3）：fresh=毕业数（每毕业
 * groupSize 个词触发一次）、队列轨（review/star）=卡数。AI 落盘重排
 * 只对队列轨有意义（fresh 的在学词不消费队列，FSRS 态变化由复习会话
 * 自然吃到）。
 */

/** 组边界是否触发（纯函数，单测锁定）：本卡计入会话计数（队列轨=每卡、
 *  fresh=毕业）且计数恰为组大小整数倍。「计入」门槛挡掉 fresh 非毕业卡
 *  在整数倍上的反复命中——20260829 审查：fresh 轨 finishCount 只在毕业
 *  递增，旧裸取模判定开局 0 与两次毕业之间的每个整数倍上每张卡都触发，
 *  把单卡画像逐张交 AI 复盘。 */
export function groupBoundaryDue(counted: boolean, count: number, size: number): boolean {
    return counted && count % size === 0;
}

/** 组边界收尾：每组满时把本组作答画像交 AI；上组 AI 已落盘则先重排队列余量。 */
export function settleGroupBoundary(v: WordView, p: WenguWordProgress, counted: boolean): void {
    if (!groupBoundaryDue(counted, v.finishCount, groupSizeOf(p))) return;
    const batch = v.groupLog;
    v.groupLog = [];
    if (v.aiDirty && v.ui.queueKind !== "fresh") {
        // AI 已落盘：本地即时重排余量，下一组吃到（不等待）
        v.aiDirty = false;
        v.queue = rebuildTail(p, v.ui.queueKind === "star" ? "star" : "review", v.queue, v.pos, v.hardList, v.doneSet);
    }
    void v.ai.runGroup(
        batch,
        p,
        () => v.store.save(p),
        () => {
            v.aiDirty = true;
        }
    );
}

/** 会话收尾：不满一组也把剩余画像交 AI（异步）。 */
export function flushGroupFor(v: WordView): void {
    if (v.groupLog.length === 0 || !v.ui.progress) return;
    const batch = v.groupLog;
    v.groupLog = [];
    void v.ai.runGroup(
        batch,
        v.ui.progress,
        () => v.store.save(v.ui.progress!),
        () => undefined
    );
}
