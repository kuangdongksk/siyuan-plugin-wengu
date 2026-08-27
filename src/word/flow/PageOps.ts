import { buildQueue, rollToday } from "../core/WordStore";
import type { WordView } from "../core/WordView";

/**
 * 页面导航动作（自 WordView 拆出压 500 行红线，友元直访视图字段）：
 * home 的四个入口（复习/新学/星标/统计）与起点面板开关。隔夜翻转
 * 在入口统一做（对齐旧 paint 首行行为）。
 */

export function goReviewFor(v: WordView): void {
    rollToday(v.ui.progress!);
    v.ui.mode = "card";
    v.rebuildQueue("review");
}

export function goFreshFor(v: WordView): void {
    rollToday(v.ui.progress!);
    const { review } = buildQueue(v.ui.progress!);
    if (review.length > 0) {
        v.ui.mode = "askreview"; // 有到期复习 → 先弹「先复习」
    } else {
        v.ui.mode = "card";
        v.rebuildQueue("fresh");
    }
}

export function goFreshAnywayFor(v: WordView): void {
    v.ui.mode = "card";
    v.rebuildQueue("fresh");
}

export function goStarFor(v: WordView): void {
    rollToday(v.ui.progress!);
    v.ui.mode = "card";
    v.rebuildQueue("star");
}

export function showStatsFor(v: WordView): void {
    rollToday(v.ui.progress!);
    v.ui.mode = "stats";
    v.syncAi();
}

export function goHomeFor(v: WordView): void {
    rollToday(v.ui.progress!);
    v.ui.mode = "home";
    v.syncAi();
}

export function setStartFor(v: WordView): void {
    v.ui.mode = "setstart";
}

export function applyStartFor(v: WordView): void {
    v.startCtl().apply();
    v.ui.mode = "home";
    v.syncAi();
}

export function cancelSetFor(v: WordView): void {
    v.ui.mode = "home";
}
