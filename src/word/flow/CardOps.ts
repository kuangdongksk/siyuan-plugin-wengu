import type { WordView } from "../core/WordView";

/**
 * 卡级杂项动作（自 WordView 拆出压 500 行红线）：与组机制无关、
 * 但依赖会话状态机的小操作，友元函数直读视图公开字段。
 */

/** 一键重过难词（完成屏「重过难词」）：难词清空重建队列从头来——
 *  按队列轨 review 跑（题型轮换 + FSRS 复习步进 + 隔卡重现）。
 *  会话进度三件一并清零：重过是独立一轮——原延续上一会话的
 *  finishCount/doneSet/groupLog，重过词全在旧 doneSet 里被 buildQueue
 *  过滤掉，撞上组边界整数倍且组 AI 已落盘时 rebuildTail 产出空尾、
 *  剩余待重过词被静默吞（20260829 三轮审查 P1）。 */
export function redoHardFor(v: WordView): void {
    if (v.hardList.length === 0) return;
    v.queue = [...v.hardList];
    v.hardList = [];
    v.ui.hardN = 0;
    v.pos = 0;
    v.freshWin = new Map();
    v.doneSet.clear();
    v.learned.clear();
    v.groupLog = [];
    v.finishCount = 0;
    v.ui.queueKind = "review";
    v.ui.mode = "card";
    v.enterPrompt();
}
