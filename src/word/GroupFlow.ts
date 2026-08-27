import type { WenguWordProgress } from "./WordStore";
import { groupSizeOf } from "./WordStore";
import { NEW_LADDER } from "./WordQuiz";
import { rebuildTail } from "./WordTiming";
import type { WordView } from "./WordView";

/**
 * 组机制编排（自 WordView.advanceAfterFinish 拆出，压 500 行红线）。
 * 友元函数直接读写 WordView 的会话字段（queue/pos/sessionNew 等对
 * 本模块开放可见性），语义与拆出前一致——组满交 AI 复盘、AI 落盘后
 * 本地重排余量、会话收尾冲不满的尾组。
 */

/** 组边界收尾：每组满时把本组作答画像交 AI；上组 AI 已落盘则先重排队列余量。 */
export function settleGroupBoundary(v: WordView, p: WenguWordProgress): void {
    if (v.finishCount % groupSizeOf(p) !== 0) return;
    const batch = v.groupLog;
    v.groupLog = [];
    if (v.aiDirty) {
        // AI 已落盘：本地即时重排余量，下一组吃到（不等待）
        v.aiDirty = false;
        const r = rebuildTail(p, v.ui.queueKind, v.queue, v.pos, v.hardList, v.doneSet, v.sessionNew, (i) =>
            v.sessionNew.has(i) ? Math.max(1, NEW_LADDER.length - (v.ladderDone.get(i) ?? 0)) : 1
        );
        v.queue = r.queue;
        for (const i of r.newcomers) v.sessionNew.add(i);
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
