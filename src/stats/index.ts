import { runAgentTextOrPanel } from "../ai/agentPanel";
import type { HistoryStore } from "../quiz/service/HistoryStore";
import { wrongOverviewNow } from "../review";
import { roundsOption, StatsChartHost, trendOption } from "./StatsCharts";
import { renderDocStatsHtml, renderOverviewHtml, renderStatsShell, type OverviewExtra } from "./StatsHtml";
import { buildDocStats, buildQuizStats, buildStatsPrompt, modeLabel } from "./StatsService";
import type { WeakCause, WeakTopRow } from "../bank/data/WeaknessStore";
import type { WenguDoc, WenguQuestion } from "../types";
import { esc, fmt } from "../ui/shared";

/**
 * 统计面板编排（浮层，模块级单例）：总览 / 本文档详情两 tab。
 * 数据只读聚合——会话历史（HistoryStore）+ 视图已装载的文档榜与
 * 题目列表，无额外 SQL；文档榜行点击下钻走视图 switchDoc，装载
 * 完成后由视图重开面板（tab=doc）。视图重渲染会清 DOM，须先调
 * destroyStatsPanel 防 echarts 泄漏。
 */

/** AI 建议超时（毫秒），与轮报告一致。 */

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

let current: StatsPanel | undefined;

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
    fullListOf(): import("../types").WenguQuestion[];
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

export function openStatsPanel(deps: StatsPanelDeps): void {
    destroyStatsPanel();
    current = new StatsPanel(deps);
    current.open();
}

export function destroyStatsPanel(): void {
    if (current) {
        current.destroy();
        current = undefined;
    }
}

class StatsPanel {
    private readonly layer = document.createElement("div");
    private readonly charts = new StatsChartHost();
    private tab: "overview" | "doc";

    constructor(private readonly d: StatsPanelDeps) {
        this.tab = d.tab ?? "overview";
        this.layer.className = "wengu-stats-wrap";
    }

    open(): void {
        this.layer.innerHTML = renderStatsShell(this.d.t, this.tabsHtml(), "");
        this.d.el.appendChild(this.layer);
        this.charts.startListen();
        this.bindHead();
        void this.renderTab();
    }

    destroy(): void {
        this.charts.dispose();
        this.layer.remove();
    }

    private tabsHtml(): string {
        const btn = (id: "overview" | "doc", label: string) =>
            `<button class="b3-button b3-button--outline wengu-stats-tab${
                this.tab === id ? " wengu-stats-tab-cur" : ""
            }" data-tab="${id}">${esc(label)}</button>`;
        const title = this.d.docs.find((x) => x.id === this.d.docId)?.title ?? "";
        const short = title.length > 12 ? `${title.slice(0, 12)}…` : title;
        return (
            btn("overview", this.d.t("statsTabOverview")) +
            (this.d.docId ? btn("doc", fmt(this.d.t("statsTabDoc"), { title: short || this.d.docId })) : "")
        );
    }

    private bindHead(): void {
        this.layer.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) =>
            b.addEventListener("click", () => {
                if (this.tab === b.dataset.tab) return;
                this.tab = b.dataset.tab === "doc" ? "doc" : "overview";
                this.refreshTabs();
                void this.renderTab();
            })
        );
        this.layer.querySelector("[data-act='stats-close']")?.addEventListener("click", () => destroyStatsPanel());
    }

    /** 只重绘 tab 按钮的选中态，不动内容区。 */
    private refreshTabs(): void {
        this.layer.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => {
            b.classList.toggle("wengu-stats-tab-cur", b.dataset.tab === this.tab);
        });
    }

    private async renderTab(): Promise<void> {
        const body = this.layer.querySelector<HTMLElement>("[data-stats-body]");
        if (!body) return;
        this.charts.dispose();
        this.charts.startListen();
        body.innerHTML = `<div class="wengu-muted">${esc(this.d.t("loading"))}</div>`;
        if (this.tab === "overview") {
            const sessions = (await this.d.history?.allSessions()) ?? [];
            const stats = buildQuizStats(sessions);
            const extra: OverviewExtra = {
                wrong: wrongOverviewNow(),
                weakRows: this.d.weakness?.topSync(8) ?? [],
                causeDist: this.d.weakness?.causeDistSync() ?? [],
            };
            body.innerHTML = renderOverviewHtml(this.d.t, stats, this.d.docs, this.d.docId, extra);
            this.mountChart(body, "trend", trendOption(stats.recent, this.d.t));
            this.bindDocRows(body);
            this.bindReviewEntries(body);
        } else {
            const sessions = (await this.d.history?.docSessions(this.d.docId)) ?? [];
            const title = this.d.docs.find((x) => x.id === this.d.docId)?.title || this.d.docId;
            const s = buildDocStats(title, sessions, this.d.fullList);
            body.innerHTML = renderDocStatsHtml(this.d.t, {
                docTitle: s.docTitle,
                total: s.total,
                wrongTotal: s.wrongs.length,
                rounds: s.rounds.map((r) => ({
                    startedAt: r.startedAt,
                    mode: modeLabel(r.mode),
                    answered: r.answered,
                    correct: r.correct,
                    elapsedSec: r.elapsedSec,
                })),
                wrongs: s.wrongs,
            });
            this.mountChart(body, "rounds", roundsOption(s.rounds, this.d.t));
            this.bindAi(body, s);
            this.bindReviewEntries(body); // 错题清单行 → 错题本定位回看
        }
    }

    private mountChart(body: HTMLElement, key: string, option: ReturnType<typeof trendOption>): void {
        const el = body.querySelector<HTMLElement>(`[data-chart='${key}']`);
        if (el) this.charts.mount(el, option);
    }

    private bindDocRows(body: HTMLElement): void {
        body.querySelectorAll<HTMLElement>("[data-docid]").forEach((row) =>
            row.addEventListener("click", () => {
                const id = row.dataset.docid ?? "";
                if (id && id !== this.d.docId) this.d.switchDoc(id);
            })
        );
    }

    /** 总览「进错题本」按钮 + 详情错题行 → 关面板进复习模式（D6 联动）。 */
    private bindReviewEntries(body: HTMLElement): void {
        body.querySelector("[data-act='enter-review']")?.addEventListener("click", () => this.d.enterReview());
        body.querySelectorAll<HTMLElement>("[data-wrong-qid]").forEach((row) =>
            row.addEventListener("click", () => this.d.enterReview(row.dataset.wrongQid ?? ""))
        );
    }

    private bindAi(body: HTMLElement, s: ReturnType<typeof buildDocStats>): void {
        const btn = body.querySelector<HTMLButtonElement>("[data-act='ai-stats']");
        const out = body.querySelector<HTMLElement>("[data-ai]");
        if (!btn || !out) return;
        btn.addEventListener("click", () => void this.runAi(btn, out, buildStatsPrompt(s)));
    }

    /** AI 学习建议：首选思源内置智能体（可追问），失配降级页内拉取。 */
    private async runAi(btn: HTMLButtonElement, out: HTMLElement, prompt: string): Promise<void> {
        await runAgentTextOrPanel({
            prompt,
            btn,
            out,
            modelId: this.d.aiModelId,
            loadingText: this.d.t("statsAiLoading"),
            emptyText: this.d.t("convertEmptyReply"),
            failPrefix: this.d.t("convertAiFailed"),
        });
    }
}
