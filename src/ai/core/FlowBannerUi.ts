/**
 * 流级横幅的**纯展示判定**（Issue #77，带单测）：把注册表快照 + 两击
 * 确认态 + i18n 取词，折算成组件直接渲染的视图模型。放在 core 里而不是
 * 组件内，是为了让「停止钮几时出、文案是什么、按钮 disabled 与否」这些
 * 口径可被单测锁死（组件零 <style>、只做渲染）。
 */

import type { AiFlowSnapshot } from "./FlowRegistry";

/** 横幅视图模型（组件只读渲染）。 */
export interface AiFlowBannerView {
    /** 流名。 */
    title: string;
    /** 进度摘要（可空）。 */
    progress: string;
    /** 附加统计（可空；批量队列六态计数）。 */
    extra: string;
    /** running：出停止钮（两击确认文案随 armed 变）。 */
    stopping: boolean;
    /** choice：出保留/丢弃钮。 */
    choosing: boolean;
    /** 停止钮文案键（组件取词；armed 时是「再击确认停止」）。 */
    stopKey: string;
}

/**
 * 折算视图模型。armed=该流的停止钮正处于两击确认态（`ai-flow:{id}`）。
 * 快照为空即无横幅（返回 undefined）。
 */
export function bannerViewOf(snap: AiFlowSnapshot | undefined, armed: boolean): AiFlowBannerView | undefined {
    if (!snap) return undefined;
    const choosing = snap.phase === "choice";
    return {
        title: snap.title,
        progress: snap.progress ?? "",
        extra: snap.extra ?? "",
        stopping: !choosing && !!snap.stop,
        choosing,
        stopKey: armed ? "aiFlowStopConfirm" : "aiFlowStop",
    };
}
