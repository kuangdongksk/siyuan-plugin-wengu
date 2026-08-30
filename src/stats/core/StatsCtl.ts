import { runAgentTextOrPanel } from "../../ai/agentPanel";
import { wrongOverviewNow } from "../../review";
import { buildDocStats, buildQuizStats, buildStatsPrompt } from "../StatsService";
import type { StatsPanelDeps } from "../index";
import type { StatsUi } from "./StatsUi";

/**
 * 统计面板控制器（四件套之一，模块级单例——浮层的打开/关闭由外部
 * 契约 openStatsPanel/destroyStatsPanel 驱动）。tab 切换与装载的代际
 * 护栏（快速切 tab 防旧请求晚到覆写）沿袭旧实现；数据只读聚合
 * （会话历史 + 视图已装载的文档榜/题目），无额外 SQL。
 */
export class StatsCtl {
    private ui?: StatsUi;
    private deps?: StatsPanelDeps;
    private alive = false;
    /** renderTab 代际（快速切 tab 防旧请求晚到覆写）。 */
    private tabGen = 0;

    attach(ui: StatsUi, deps: StatsPanelDeps): void {
        this.ui = ui;
        this.deps = deps;
        this.alive = true;
        ui.tab = deps.tab ?? "overview";
        void this.loadTab();
    }

    detach(): void {
        this.tabGen++;
        this.alive = false;
        this.ui = undefined;
        this.deps = undefined;
    }

    setTab(tab: "overview" | "doc"): void {
        if (!this.ui || this.ui.tab === tab) return;
        this.ui.tab = tab;
        void this.loadTab();
    }

    private async loadTab(): Promise<void> {
        const ui = this.ui;
        const d = this.deps;
        if (!ui || !d) return;
        const gen = ++this.tabGen;
        ui.phase = "loading";
        if (ui.tab === "overview") {
            const sessions = (await d.history?.allSessions()) ?? [];
            if (gen !== this.tabGen || !this.alive) return;
            ui.overview = {
                stats: buildQuizStats(sessions),
                extra: {
                    wrong: wrongOverviewNow(),
                    weakRows: d.weakness?.topSync(8) ?? [],
                    causeDist: d.weakness?.causeDistSync() ?? [],
                },
            };
        } else {
            const sessions = (await d.history?.docSessions(d.docId)) ?? [];
            if (gen !== this.tabGen || !this.alive) return;
            const title = d.docs.find((x) => x.id === d.docId)?.title || d.docId;
            ui.doc = buildDocStats(title, sessions, d.fullList);
        }
        ui.phase = "ready";
    }

    /** 文档榜行点击：切刷题文档（视图 load 完成后重开面板 tab=doc）。 */
    switchDoc(docId: string): void {
        const d = this.deps;
        if (d && docId && docId !== d.docId) d.switchDoc(docId);
    }

    /** 「进错题本」/错题行点击：关面板并定位复习模式（qid 定位单题回看）。 */
    enterReview(qid?: string): void {
        this.deps?.enterReview(qid);
    }

    /** AI 学习建议：首选思源内置智能体（可追问），失配降级页内拉取。 */
    runAi(btn: HTMLButtonElement, out: HTMLElement): Promise<void> {
        const d = this.deps;
        if (!d || !this.ui?.doc) return Promise.resolve();
        return runAgentTextOrPanel({
            prompt: buildStatsPrompt(this.ui.doc),
            btn,
            out,
            modelId: d.aiModelId,
            loadingText: d.t("statsAiLoading"),
            emptyText: d.t("convertEmptyReply"),
            failPrefix: d.t("convertAiFailed"),
        });
    }
}

/** stats 模块级单例。 */
export const statsCtl = new StatsCtl();
