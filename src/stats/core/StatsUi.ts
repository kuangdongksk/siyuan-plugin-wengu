import type { WeakCause, WeakTopRow } from "../../bank/data/WeaknessStore";
import type { WenguDocStats, WenguQuizStats } from "../StatsService";
import type { StatsCtl } from "./StatsCtl";

/**
 * 统计面板的响应态形状（四件套之一，模式见 docs/svelte-migration.md）。
 * 浮层单例（openStatsPanel/destroyStatsPanel 的外部契约不变），tab/
 * 装载态进 ui；两 tab 的数据模型装载后整体重赋值触发重绘。
 */

/** 子组件经 context 取的载荷。 */
export interface StatsCtx {
    ctl: StatsCtl;
    ui: StatsUi;
    t: (key: string) => string;
}

export const STATS_CTX = Symbol("wengu-stats");

/** 总览扩展块数据（错题概况 + 薄弱知识点 + 错因分布，D6）。 */
export interface OverviewExtra {
    /** 错题概况（缓存未就绪时 undefined，显示占位）。 */
    wrong?: { pending: number; mastered: number };
    weakRows: WeakTopRow[];
    causeDist: { cause: WeakCause; n: number }[];
}

export interface StatsUi {
    tab: "overview" | "doc";
    /** loading=tab 装载中（切 tab 即置位），ready=内容可渲染。 */
    phase: "loading" | "ready";
    /** 总览页模型（该 tab 装载完成后就位）。 */
    overview?: { stats: WenguQuizStats; extra: OverviewExtra };
    /** 详情页模型（该 tab 装载完成后就位；rounds 图表与评分记录表
     *  共用，AI 建议 prompt 也读它）。 */
    doc?: WenguDocStats;
}

/** 初始态（$state 包装在 StatsApp 内完成；tab 初值由 attach 覆写）。 */
export function initialStatsUi(): StatsUi {
    return { tab: "overview", phase: "loading" };
}
