import type { WordView } from "../core/WordView";

/**
 * 卡级杂项动作（自 WordView 拆出压 500 行红线）：与组机制无关、
 * 但依赖会话状态机的小操作，友元函数直读视图公开字段。
 */

/** 一键重过难词（完成屏「重过难词」）：难词清空重建队列从头来。 */
export function redoHardFor(v: WordView): void {
    if (v.hardList.length === 0) return;
    v.queue = [...v.hardList];
    v.hardList = [];
    v.ui.hardN = 0;
    v.pos = 0;
    v.sessionNew = new Set<number>();
    v.ui.mode = "card";
    v.enterPrompt();
}
