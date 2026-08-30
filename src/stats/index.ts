import type { HistoryStore } from "../quiz/service/HistoryStore";
import { mountSvelteApp, type MountedSvelteApp } from "../ui/mountApp";
import StatsApp from "./component/StatsApp.svelte";
import type { WeakCause, WeakTopRow } from "../bank/data/WeaknessStore";
import type { WenguDoc, WenguQuestion } from "../types";

/**
 * 统计面板编排（浮层，Svelte 化 20260830，四件套见 core/component/）：
 * 总览 / 本文档详情两 tab。数据只读聚合——会话历史（HistoryStore）+
 * 视图已装载的文档榜与题目列表，无额外 SQL；文档榜行点击下钻走视图
 * switchDoc，装载完成后由视图重开面板（tab=doc）。视图重渲染/销毁
 * 须先调 destroyStatsPanel（echarts dispose 防泄漏——QuizView.destroy
 * 已兜底，此前漏清是挂账项）。
 */

export interface StatsPanelDeps {
    el: HTMLElement;
    t: (k: string) => string;
    history?: HistoryStore;
    docs: WenguDoc[];
    docId: string;
    fullList: WenguQuestion[];
    /** 文档榜行点击：切刷题文档（视图 load 完成后重开面板）。 */
    switchDoc(docId: string): void;
    /** 薄弱画像（总览扩展块：Top 知识点 + 错因分布）。 */
    weakness?: { topSync(n: number): WeakTopRow[]; causeDistSync(): { cause: WeakCause; n: number }[] };
    /** 「进错题本」/错题行点击：关面板并定位复习模式（qid 定位单题回看）。 */
    enterReview(qid?: string): void;
    aiModelId: string;
    /** 打开时直落的 tab（默认总览）。 */
    tab?: "overview" | "doc";
}

export interface StatsViewAccess {
    container(): HTMLElement;
    t(key: string): string;
    historyStore(): HistoryStore | undefined;
    weaknessStore():
        { topSync(n: number): WeakTopRow[]; causeDistSync(): { cause: WeakCause; n: number }[] } | undefined;
    docsOf(): {
        id: string;
        title?: string;
        hPath?: string;
        total: number;
        attempted: number;
        rightCount: number;
        totalTime: number;
    }[];
    docIdOf(): string;
    fullListOf(): WenguQuestion[];
    switchDocSelect(id: string): void;
    markReopenStats(tab: "overview" | "doc"): void;
    enterReviewMode(opt: { docId?: string; qid?: string }): void;
    aiModelId(): string;
}

/** 由视图能力组装 StatsPanelDeps 并打开（QuizView.openStatsPanelAt 的拆出体）。 */
export function openStatsPanelFor(v: StatsViewAccess, tab: "overview" | "doc"): void {
    openStatsPanel({
        el: v.container(),
        t: v.t,
        history: v.historyStore(),
        docs: v.docsOf(),
        docId: v.docIdOf(),
        fullList: v.fullListOf(),
        switchDoc: (id) => {
            v.markReopenStats("doc");
            v.switchDocSelect(id);
        },
        weakness: v.weaknessStore(),
        enterReview: (qid) => v.enterReviewMode(qid ? { qid } : {}),
        aiModelId: v.aiModelId(),
        tab,
    });
}

/* ── 浮层单例（旧 StatsPanel 类的等价物） ── */

let statsApp: MountedSvelteApp | undefined;
/** 宿主壳（.wengu-stats-wrap 定位层，组件根从 .wengu-stats-layer 起）。 */
let statsHost: HTMLElement | undefined;

export function openStatsPanel(deps: StatsPanelDeps): void {
    destroyStatsPanel();
    statsHost = document.createElement("div");
    statsHost.className = "wengu-stats-wrap";
    deps.el.appendChild(statsHost);
    statsApp = mountSvelteApp(StatsApp, statsHost, { deps, onClose: destroyStatsPanel });
}

export function destroyStatsPanel(): void {
    statsApp?.unmount();
    statsApp = undefined;
    statsHost?.remove();
    statsHost = undefined;
}
