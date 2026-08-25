import type { App } from "siyuan";
import type { AnswerHost } from "./AnswerFlow";
import { bindCardEvents, restoreAnsweredCards, revealAll } from "./AnswerFlow";
import { collectCardThoughts, renderMainShell, renderNumsHtml, renderSubheadHtml } from "./CardHtml";
import type { CardHtmlModel } from "./CardParts";
import type { ConvertProgressRecord } from "./ConvertBatch";
import { convertDoneText, openConvertForView, showStatus, updateConvertBtn } from "./ConvertHost";
import { reconcileKnowledgeRefs } from "./BankReconcile";
import { CollectionFlow } from "./CollectionFlow";
import type { HistoryStore, WenguSession } from "./HistoryStore";
import { pushSessionAnswer } from "./HistoryStore";
import { bindAnnotationLayer, hideBar, type AnnoCallbacks } from "./AnnoFlow";
import { addClue, bindClueJudge, refreshClueRow } from "./ClueFlow";
import { buildDrillUnits, renderUnitsHtml, type DrillUnit } from "./DrillUnits";
import { bindGroupUnits, focusQuestion, restoreGroupScrolls } from "./MaterialFlow";
import { bindNumRail } from "./NumRail";
import { ProgressivePreview } from "./ProgressivePreview";
import { ProtyleHost } from "./ProtyleHost";
import type { QuestionBank } from "./QuestionBank";
import type { WenguPrefsIo } from "./QuizLoader";
import { loadPrefs, loadQuizState, savePrefs } from "./QuizLoader";
import { bindCardActions } from "./RegenDialog";
import { lockAllCards, manualFinishRound, roundFinishCtx, showRoundReportNow } from "./RoundReport";
import type { WeaknessStore } from "./WeaknessStore";
import type { WenguSettingsShape as SettingsDialogShape } from "./SettingsDialog";
import { beginDrillFor, bindStartPanel, renderStartPanel, startPanelModelFor } from "./StartPanel";
import { destroyStatsPanel, openStatsPanelFor } from "./StatsPanel";
import { TimerBinder, timerHostFor } from "./TimerBinder";
import { bindHeadFor } from "./ViewBindings";
import { TimerController } from "./TimerController";
import type { WenguDoc, WenguMaterial, WenguQuestion, WenguRevealMode } from "./types";
import { esc } from "./ui";

/** 温故刷题页签视图（编排层），各模块见 docs/design-review.md。 */
export class QuizView implements AnswerHost {
    /** i18n 取值（public：AnswerHost 接口按结构匹配）。 */
    readonly t: (key: string) => string;
    /** 视图根元素（public：ClueHost 结构匹配）。 */
    readonly el: HTMLElement;
    private readonly app?: App;
    private readonly storage?: {
        load: () => Promise<unknown>;
        save: (v: WenguPrefsIo) => Promise<unknown>;
    };
    private readonly settings?: SettingsDialogShape;
    private readonly history?: HistoryStore;
    private readonly weakness?: WeaknessStore;
    private readonly bank?: QuestionBank;
    readonly openSettings?: () => void;
    private readonly colFlow: CollectionFlow;
    private readonly timer = new TimerController(() => this.timerBinder.updateLabel());
    private readonly timerBinder: TimerBinder;
    /** 统计面板下钻意图：load 完成后重开面板并直落该 tab。 */
    private reopenStatsTab?: "overview" | "doc";
    private readonly protyleHost: ProtyleHost;
    private readonly progressive = new ProgressivePreview();
    private docId: string;
    private activeDocId: string;
    private docs: WenguDoc[] = [];
    private sideCollapsed = false;
    private sideFilter = "";
    private pendingDoc: { id: string; title: string } | undefined;
    private list: WenguQuestion[] = [];
    private fullList: WenguQuestion[] = [];
    private materials: WenguMaterial[] = [];
    /** 渲染单元（独立题/材料组），renderList 时由 buildDrillUnits 组装。 */
    private units: DrillUnit[] = [];
    /** M6 三模式开口：做题（现有）/复习/学习预留，主区渲染按它路由。 */
    private mode: "quiz" | "review" | "study" = "quiz";
    /** 标注层解绑与背单词存储（生词→复习队列，index.ts 注入共享单例）。 */
    private annoCleanup?: () => void;
    private wordStore?: AnnoCallbacks["wordStore"];
    private loading = false;
    private converting = false;
    private loadError = "";
    private docTotalSec = 0;
    private revealMode: WenguRevealMode = "instant";
    private activeQIdx = 0;
    private started = false;
    private lastConvertModelId = "";
    private lastConvertFill = false;
    private lastConvertSteps = false;
    private lastConvertKnow = "";
    private convertProgress: Record<string, ConvertProgressRecord> = {};
    private session?: WenguSession;
    /** 收卷后的会话快照（总结报告/揭示仍要读它）。 */
    private finished?: WenguSession;
    private rounds: WenguSession[] = [];

    constructor(
        element: HTMLElement,
        i18n: Record<string, string>,
        docId = "",
        app?: App,
        storage?: {
            load: () => Promise<unknown>;
            save: (v: WenguPrefsIo) => Promise<unknown>;
        },
        settings?: SettingsDialogShape,
        history?: HistoryStore,
        weakness?: WeaknessStore,
        bank?: QuestionBank,
        openSettings?: () => void,
        wordStore?: AnnoCallbacks["wordStore"]
    ) {
        this.el = element;
        this.t = (key) => i18n[key] || key;
        this.docId = docId;
        this.activeDocId = docId;
        this.app = app;
        this.storage = storage;
        this.settings = settings;
        this.history = history;
        this.weakness = weakness;
        this.bank = bank;
        this.openSettings = openSettings;
        this.wordStore = wordStore;
        this.protyleHost = new ProtyleHost(app);
        this.timerBinder = new TimerBinder(timerHostFor(this));
        this.colFlow = new CollectionFlow({
            t: this.t,
            container: this.container,
            bank: () => this.bank,
            docs: () => this.docs,
            docId: () => this.docId,
            sideFilter: () => this.sideFilter,
            reloadFromCollection: () => {
                void this.timerBinder.flush();
                this.docId = "";
                this.persistPrefs();
                void this.load();
            },
        });
        // 一次性事件委托（重渲染不重复绑定）：块引用跳转 + 题卡「重新生成」
        bindCardActions(this.el, {
            t: this.t,
            find: (qid) => this.list.find((x) => x.id === qid),
            bank: this.bank,
            modelId: this.aiModelId,
            reload: () => void this.load(),
        });
        // 标注层（线索/生词）与「AI 复核线索」委托：每视图绑一次
        this.annoCleanup = bindAnnotationLayer(element, {
            t: this.t,
            onMarkClue: (text) => addClue(this, text),
            wordStore,
        });
        bindClueJudge(this);
    }

    readonly container = (): HTMLElement => this.el;
    readonly questions = (): WenguQuestion[] => this.list;
    readonly currentRevealMode = (): WenguRevealMode => this.revealMode;
    readonly timerController = (): TimerController => this.timer;
    readonly currentSession = (): WenguSession | undefined => this.session ?? this.finished;
    readonly roundComplete = (): void => showRoundReportNow(roundFinishCtx(this));
    readonly flushTime = (): void => void this.timerBinder.flush();
    /** ClueHost 结构匹配：当前题/材料定位/会话落库（线索标注用）。 */
    readonly currentQuestion = (): WenguQuestion | undefined => this.list[this.activeQIdx];
    readonly materialOf = (q: WenguQuestion): WenguMaterial | undefined => this.materials.find((m) => m.id === q.group);
    readonly persist = (): void => {
        const s = this.session ?? this.finished;
        if (s) void this.history?.upsert(s);
    };
    readonly recordAnswer = (
        qid: string,
        submitted: string,
        ok: boolean,
        extra?: { verdict?: "right" | "partial" | "wrong"; comment?: string; cause?: string }
    ): void => {
        const s = this.session;
        if (!s) return;
        pushSessionAnswer(s, qid, submitted, ok, this.timer.takeQuestionSec(qid), this.timer.elapsed(), extra);
        void this.history?.upsert(s);
        if (!qid.includes("#")) void this.bank?.recordAnswer(qid, submitted, ok); // 题库统计镜像
    };

    /** 设置页开关变更后由插件调用：立即按新设置重渲染。 */
    applySettings(): void {
        this.renderList();
    }

    /** 顶栏再次点击且页签已打开时：活动文档是习题文档才切换选中。 */
    setDoc(docId: string): void {
        if (!docId) return;
        this.activeDocId = docId;
        this.selectDoc(docId);
    }

    render(): void {
        void this.load();
        this.timerBinder.start();
    }

    destroy(): void {
        this.timerBinder.stop();
        this.progressive.clear();
        this.finishSession();
        void this.timerBinder.flush();
        this.annoCleanup?.();
        hideBar();
        void this.bank?.flush();
        this.protyleHost.destroyAll();
    }

    /** 当前题切换（题号导航/组内导航共用）：同步下标、逐题计时、线索行。 */
    private onActiveQ(idx: number): void {
        this.activeQIdx = idx;
        this.timer.setQuestion(this.list[idx]?.id ?? "");
        refreshClueRow(this);
    }

    selectDoc(docId: string): void {
        if (!docId || docId === this.docId) return;
        this.colFlow.reset(); // 点文档=离开题库模式
        void this.timerBinder.flush();
        this.docId = docId;
        this.persistPrefs();
        void this.load();
    }

    private persistPrefs(): void {
        savePrefs(this.storage, {
            docId: this.docId,
            sideCollapsed: this.sideCollapsed,
            lastConvertModelId: this.lastConvertModelId,
            lastConvertFill: this.lastConvertFill,
            lastConvertSteps: this.lastConvertSteps,
            lastConvertKnow: this.lastConvertKnow,
            convertProgress: this.convertProgress,
        });
    }

    finishSession(): void {
        const s = this.session;
        if (!s) return;
        this.session = undefined;
        s.endedAt = Date.now();
        s.elapsedSec = Math.max(s.elapsedSec, this.timer.elapsed());
        s.thoughts = collectCardThoughts(this.el); // 思路随卷快照（未作答的题也保得住）
        this.finished = s;
        void this.history?.upsert(s);
    }

    private async load(): Promise<void> {
        this.finishSession(); // 切文档/刷新/重开都视为上一轮结束
        this.loading = true;
        this.loadError = "";
        this.renderList();
        const prefs = await loadPrefs(this.storage);
        await this.weakness?.preload();
        await this.bank?.preload();
        const colQuestions = await this.colFlow.questions();
        const r = await loadQuizState({
            prefs,
            settings: this.settings,
            timer: this.timer,
            history: this.history,
            docId: this.docId,
            activeDocId: this.activeDocId,
            pendingDoc: this.pendingDoc,
        });
        this.sideCollapsed = r.sideCollapsed;
        this.lastConvertModelId = r.lastConvertModelId;
        this.lastConvertFill = r.lastConvertFill;
        this.lastConvertSteps = r.lastConvertSteps;
        this.lastConvertKnow = r.lastConvertKnow ?? "";
        this.convertProgress = r.convertProgress;
        this.revealMode = r.revealMode;
        this.started = false;
        this.activeQIdx = 0;
        this.finished = undefined;
        this.docs = r.docs;
        this.pendingDoc = r.pendingDoc;
        this.docId = r.docId;
        this.docTotalSec = r.docTotalSec;
        this.list = this.fullList = r.fullList;
        this.materials = r.materials;
        this.rounds = r.rounds;
        if (colQuestions) {
            this.fullList = colQuestions;
            this.list = colQuestions;
            this.rounds = []; // 专题暂不挂历史轮次（会话按 docId 记）
        }
        this.loadError = r.loadError;
        this.loading = false;
        await this.colFlow.refresh();
        this.renderList();
        // 后台链：知识引用对账 → 存量/新文档迁移入库 → 补侧栏专题清单
        if (this.bank) {
            void (this.weakness ? reconcileKnowledgeRefs(this.bank, this.weakness) : Promise.resolve(0))
                .then((): Promise<void> => this.bank!.ensureMigrated(this.docs))
                .then((): void => void this.colFlow.refresh().then((): void => this.colFlow.refreshSide()));
        }
        if (this.reopenStatsTab) {
            const tab = this.reopenStatsTab;
            this.reopenStatsTab = undefined;
            this.openStatsPanelAt(tab);
        }
    }

    /* ── TimerHostAccess（timerHostFor 消费） ── */
    readonly activeQidOf = (): string => this.list[this.activeQIdx]?.id ?? "";
    readonly docTotalSecOf = (): number => this.docTotalSec;
    readonly syncSession = (elapsed: number): void => {
        if (this.session) this.session.elapsedSec = elapsed;
    };
    readonly addDocTotal = (add: number) => (this.docTotalSec += add);
    readonly finishNow = (): void => manualFinishRound(roundFinishCtx(this));

    readonly allRounds = (): WenguSession[] => this.rounds;
    readonly finishedSession = (): WenguSession | undefined => this.finished;
    readonly aiModelId = (): string => this.lastConvertModelId || this.settings?.convertModelId || "";
    readonly revealAnsweredNow = (): void => void revealAll(this);
    readonly stopRoundNow = (): void => {
        this.started = false;
        this.flushTime(); // 收卷即落库（未满 15s 的秒数不清零）
        this.timerBinder.updateLabel();
    };
    readonly lockAllCardsNow = (): void => lockAllCards(this.el);
    readonly weaknessStore = (): WeaknessStore | undefined => this.weakness;
    readonly bankStore = (): QuestionBank | undefined => this.bank;
    readonly refreshCollections = (): void => void this.colFlow.refresh().then((): void => this.colFlow.refreshSide());
    readonly colFlowOf = (): CollectionFlow => this.colFlow;
    readonly convertingOf = (): boolean => this.converting;
    readonly setSideFilter = (text: string): void => void (this.sideFilter = text);
    readonly setSideCollapsed = (collapsed: boolean): void => {
        this.sideCollapsed = collapsed;
        this.persistPrefs();
        this.renderList();
    };
    /* ── StatsViewAccess（openStatsPanelFor 消费） ── */
    readonly docsOf = (): WenguDoc[] => this.docs;
    readonly markReopenStats = (tab: "overview" | "doc") => (this.reopenStatsTab = tab);
    readonly switchDocSelect = (id: string): void => this.selectDoc(id);

    private startPanelModel = () => startPanelModelFor(this);

    private beginDrill = () => beginDrillFor(this);

    /* ── DrillViewAccess（beginDrillFor/startPanelModelFor 消费） ── */
    readonly fullListOf = (): WenguQuestion[] => this.fullList;
    readonly docIdOf = (): string => this.docId;
    readonly historyStore = (): HistoryStore | undefined => this.history;
    readonly setQuizList = (l: WenguQuestion[]) => (this.list = l);
    readonly setQuizRevealMode = (m: WenguRevealMode) => (this.revealMode = m);
    readonly setActiveQIdx = (i: number) => (this.activeQIdx = i);
    readonly setStartedFlag = (v: boolean) => (this.started = v);
    readonly setFinishedSession = (s: WenguSession | undefined) => (this.finished = s);
    readonly setCurSession = (s: WenguSession | undefined) => (this.session = s);
    readonly renderQuizList = (): void => this.renderList();
    readonly updateTimerLabelNow = (): void => this.timerBinder.updateLabel();
    readonly afterStartHook = (): void => {
        this.renderList();
        restoreAnsweredCards(this);
        this.timerBinder.updateLabel();
    };

    private renderList(): void {
        this.el.classList.add("wengu-panel");
        try {
            this.renderListInner();
        } catch (e) {
            this.protyleHost.destroyAll();
            this.el.innerHTML = `<div class="wengu-head"></div>
    <div class="wengu-status wengu-status-err">${esc(this.t("loadFailed"))}${esc(
        String((e as Error)?.message ?? e)
    )}</div>`;
            bindHeadFor(this);
        }
    }

    private renderListInner(): void {
        this.protyleHost.destroyAll();
        destroyStatsPanel(); // innerHTML 覆盖前先 dispose 图表实例防泄漏
        // M6 三模式开口：目前只有做题模式（quiz）实现，复习/学习预留
        if (this.mode !== "quiz") return;
        const colMode = this.colFlow.isActive();
        const doc = colMode ? undefined : this.docs.find((d) => d.id === this.docId);
        this.units = buildDrillUnits(this.list, this.materials);
        const cardModel: CardHtmlModel = {
            t: this.t,
            showAttempts: this.settings?.showAttempts !== false,
            showWrongBadge: this.settings?.showWrong !== false && this.revealMode !== "after",
        };
        this.el.innerHTML = renderMainShell({
            t: this.t,
            docs: this.docs,
            docId: this.docId,
            sideCollapsed: this.sideCollapsed,
            filter: this.sideFilter,
            hasSettingsButton: !!this.openSettings,
            collections: this.colFlow.rowsView(),
            activeCollection: this.colFlow.id(),
            loading: this.loading,
            loadError: this.loadError,
            started: this.started,
            previewing: this.progressive.active,
            hasDoc: !!doc,
            listCount: this.list.length,
            startPanelHtml: renderStartPanel(this.startPanelModel()),
            subheadHtml: colMode
                ? `<span class="wengu-muted">${esc(this.colFlow.activeTitle() ?? "")} · ${esc(String(this.list.length))}</span>`
                : renderSubheadHtml({ t: this.t, doc, listCount: this.list.length, rounds: this.rounds }),
            cardsHtml: renderUnitsHtml(this.units, cardModel),
            numsHtml: renderNumsHtml(
                this.list,
                this.t,
                this.settings?.showNums !== false,
                this.settings?.showWrong !== false && this.revealMode === "instant"
            ),
        });
        this.bindAll();
        if (colMode)
            this.protyleHost.mountStatic(this.el, this.list); // 题库静态渲染（Lute）
        else void this.protyleHost.mount(this.el, this.list, this.materials).then(() => restoreGroupScrolls(this.el));
        this.timerBinder.updateLabel();
    }

    /** 视图级绑定：头部/题号/开刷面板/题卡/材料组单元。 */
    private bindAll(): void {
        bindHeadFor(this);
        bindNumRail(this.el, {
            onActive: (idx) => this.onActiveQ(idx),
            onFocus: (idx) => focusQuestion(this.el, this.units, this.list, idx),
        });
        bindStartPanel(this.el, this.startPanelModel(), () => this.beginDrill());
        bindGroupUnits(this.el, this.units, this, {
            onActive: (idx) => this.onActiveQ(idx),
            onShown: () => void this.protyleHost.mount(this.el, this.list, this.materials),
        });
        if (this.progressive.active) return; // 渐进呈现期不绑作答（文档每批重建）
        for (const node of this.el.querySelectorAll<HTMLElement>(".wengu-card")) {
            const q = this.list.find((x) => x.id === node.dataset.qid);
            if (q) bindCardEvents(this, node, q);
        }
    }

    /** 打开统计面板（tab 直落；下钻后 load 完成时也走这里重开）。 */
    openStatsPanelAt(tab: "overview" | "doc"): void {
        openStatsPanelFor(this, tab);
    }

    /* ── ConvertViewAccess（openConvertForView 消费） ── */
    readonly activeDocIdOf = (): string => this.activeDocId;
    readonly settingsOf = (): SettingsDialogShape | undefined => this.settings;
    readonly lastConvert = (): { modelId: string; fill: boolean; steps: boolean; know: string } => ({
        modelId: this.lastConvertModelId,
        fill: this.lastConvertFill,
        steps: this.lastConvertSteps,
        know: this.lastConvertKnow,
    });
    readonly convertParallelOf = (): number => this.settings?.convertParallel ?? 1;
    readonly saveConvertChoice = (modelId: string, fill: boolean, steps: boolean, know: string): void => {
        this.lastConvertModelId = modelId;
        this.lastConvertFill = fill;
        this.lastConvertSteps = steps;
        this.lastConvertKnow = know;
        this.persistPrefs();
    };
    readonly convertProgressOf = (srcDocId: string): ConvertProgressRecord | undefined =>
        this.convertProgress[srcDocId];
    readonly saveConvertProgress = (srcDocId: string, rec: ConvertProgressRecord | undefined): void => {
        if (rec) this.convertProgress[srcDocId] = rec;
        else delete this.convertProgress[srcDocId];
        this.persistPrefs();
    };
    readonly setConvertingState = (v: boolean): void => {
        this.converting = v;
        updateConvertBtn(this.el, this.converting, this.t);
    };
    readonly progressiveOf = (): ProgressivePreview => this.progressive;
    readonly isStarted = (): boolean => this.started;
    readonly currentDocId = (): string => this.docId;
    readonly switchPreviewDoc = (id: string, title: string, count: number): void => {
        this.colFlow.reset();
        this.pendingDoc = { id, title };
        this.docId = id;
        this.persistPrefs();
        this.activeQIdx = 0;
        this.finished = undefined; // 渐进呈现接管页签：旧轮次报告不让残留
        if (!this.docs.some((d) => d.id === id)) {
            this.docs.unshift({ id, title, hPath: "", total: count, attempted: 0, rightCount: 0, totalTime: 0 });
        }
    };
    readonly applyQuizList = (list: WenguQuestion[], materials?: WenguMaterial[]): void => {
        this.list = this.fullList = list;
        if (materials) this.materials = materials;
        this.renderList();
    };
    readonly reloadView = (): void => void this.load();
    readonly onConvertDone = (r: { docId: string; title: string; count: number; message?: string }): void => {
        this.progressive.clear();
        this.colFlow.reset();
        this.pendingDoc = { id: r.docId, title: r.title };
        this.docId = r.docId;
        this.persistPrefs();
        void this.load().then(() => showStatus(this.el, convertDoneText(this.t, r.title, r.count), "ok"));
    };

    readonly openConvert = () => openConvertForView(this);
}
