import { runAgentTextOrPanel } from "../../ai/agentPanel";
import { buildStatsPrompt } from "../../ai/prompts/misc";
import { wrongOverviewNow } from "../../review";
import { plainText } from "../../ui/shared";
import { buildDocStats, buildQuizStats } from "../StatsService";
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
    /** 面板**尚未挂载**时收到的考点检索词（Issue #135 §7.a 首点路径）。
     *  attach 在组件的 onMount 里（Svelte 把 onMount 排进微任务），故
     *  「面板未开 → 先开面板 → 立刻按考点检索」那一次 loadKcap 必然早于
     *  attach（此刻 this.ui 还是 undefined）。不接这一手就静默丢掉首次
     *  点击（浮层开了、却停在常规详情页），用户得再点一次 chip。 */
    private pendingKcap?: string;

    attach(ui: StatsUi, deps: StatsPanelDeps): void {
        this.ui = ui;
        this.deps = deps;
        this.alive = true;
        ui.tab = deps.tab ?? "overview";
        void this.loadTab();
        // 补做挂载前收到的那次检索（tab 已置 doc，loadTab 的同步段已读过它）
        const pending = this.pendingKcap;
        if (pending) {
            this.pendingKcap = undefined;
            this.loadKcap(pending);
        }
    }

    detach(): void {
        this.tabGen++;
        this.alive = false;
        this.ui = undefined;
        this.deps = undefined;
        // 挂载前那条检索词随面板一起作废（下次开面板不复现上一次查询）
        this.pendingKcap = undefined;
    }

    setTab(tab: "overview" | "doc"): void {
        if (!this.ui || this.ui.tab === tab) return;
        this.ui.tab = tab;
        this.ui.kcap = undefined; // 切 tab 即退出考点检索视图
        void this.loadTab();
    }

    /** 考点检索（Issue #135 §7.a）：题卡 `.wengu-kchip` 点击落点。
     *  在当前题集内按 knowledge 精确匹配列题（覆盖当前文档可立即给结果），
     *  **不切工作区、不弹二级浮层**——最小可用语义；「全局考点 Tab」属后续迭代。 */
    loadKcap(knowledge: string): void {
        if (!knowledge) return;
        const ui = this.ui;
        const d = this.deps;
        if (!ui || !d) {
            // 面板未挂载：记下来，attach 时补做（见 pendingKcap 注释）
            this.pendingKcap = knowledge;
            return;
        }
        const rows = d.fullList
            .map((q, i) => ({ q, index: i + 1 }))
            .filter(({ q }) => (q.knowledge ?? "") === knowledge || (q.chapter ?? "") === knowledge)
            .map(({ q, index }) => ({
                docTitle: `${d.t("qnumsTitle")} ${index}`,
                qid: q.id,
                stemSummary: plainText(q.stemMd ?? "", 80),
                wrongCount: q.wrongCount ?? 0,
            }));
        ui.kcap = knowledge;
        ui.kcapRows = rows;
        ui.tab = "doc";
    }

    /** 挂载前攒下的检索词（测试用只读出口，防「静默丢弃」回归）。 */
    pendingKcapNow(): string | undefined {
        return this.pendingKcap;
    }

    /** 退出考点检索视图（回常规详情）。 */
    clearKcap(): void {
        const ui = this.ui;
        if (!ui) return;
        ui.kcap = undefined;
        ui.kcapRows = undefined;
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
