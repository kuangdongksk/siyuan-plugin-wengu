import type {App} from "siyuan";
import {
    bindCardEvents,
    revealAll,
    restoreAnsweredCards,
} from "./AnswerFlow";
import type {AnswerHost} from "./AnswerFlow";
import {
    collectCardThoughts,
    renderCardsHtml,
    renderMainShell,
    applySideFilter,
    renderNumsHtml,
    renderSubheadHtml,
} from "./CardHtml";
import {CollectionFlow} from "./CollectionFlow";
import type {ConvertProgressRecord} from "./ConvertBatch";
import {
    convertDoneText,
    openConvertForView,
    showStatus,
    updateConvertBtn,
} from "./ConvertHost";
import type {
    HistoryStore,
    WenguSession,
} from "./HistoryStore";
import {pushSessionAnswer} from "./HistoryStore";
import {bindNumRail} from "./NumRail";
import {ProgressivePreview} from "./ProgressivePreview";
import {ProtyleHost} from "./ProtyleHost";
import type {QuestionBank} from "./QuestionBank";
import {addDocTotalTime} from "./QuestionService";
import {
    loadPrefs,
    loadQuizState,
    savePrefs,
    type WenguPrefsIo,
} from "./QuizLoader";
import {
    lockAllCards,
    roundFinishCtx,
    showRoundReportNow,
} from "./RoundReport";
import type {WenguSettingsShape as SettingsDialogShape} from "./SettingsDialog";
import {
    beginDrillFor,
    bindStartPanel,
    renderStartPanel,
    startPanelModelFor,
} from "./StartPanel";
import {TimerBar} from "./TimerBar";
import {TimerController} from "./TimerController";
import type {
    WenguDoc,
    WenguQuestion,
    WenguRevealMode,
} from "./types";
import {esc} from "./ui";
import {bindViewEvents} from "./ViewBindings";
import type {WeaknessStore} from "./WeaknessStore";

/** 温故刷题页签视图（编排层），各模块见 docs/design-review.md。 */
export class QuizView implements AnswerHost {
    /** i18n 取值（public：AnswerHost 接口按结构匹配）。 */
    readonly t: (key: string) => string;
    private readonly el: HTMLElement;
    private readonly app?: App;
    private readonly storage?: {load: () => Promise<unknown>; save: (v: WenguPrefsIo) => Promise<unknown>;};
    private readonly settings?: SettingsDialogShape;
    private readonly history?: HistoryStore;
    private readonly weakness?: WeaknessStore;
    private readonly bank?: QuestionBank;
    private readonly openSettings?: () => void;
    private readonly timer = new TimerController(() => this.timerBar.update());
    private readonly protyleHost: ProtyleHost;
    private readonly progressive = new ProgressivePreview();
    private readonly timerBar: TimerBar;
    private readonly colFlow: CollectionFlow;
    private docId: string;
    private activeDocId: string;
    private docs: WenguDoc[] = [];
    private sideCollapsed = false;
    private sideFilter = "";
    private pendingDoc: {id: string; title: string;} | undefined;
    private list: WenguQuestion[] = [];
    private fullList: WenguQuestion[] = [];
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
        storage?: {load: () => Promise<unknown>; save: (v: WenguPrefsIo) => Promise<unknown>;},
        settings?: SettingsDialogShape,
        history?: HistoryStore,
        weakness?: WeaknessStore,
        bank?: QuestionBank,
        openSettings?: () => void,
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
        this.protyleHost = new ProtyleHost(app);
        this.timerBar = new TimerBar({
            t: this.t,
            container: this.container,
            timer: this.timerController,
            docTotalSec: () => this.docTotalSec,
            activeQid: () => this.list[this.activeQIdx]?.id,
            running: () => this.started && (!!this.docId || this.colFlow.isActive()),
            onTick: (elapsed) => {
                if (this.session) this.session.elapsedSec = elapsed;
            },
            timeUpCtx: () => (this.session ? roundFinishCtx(this) : undefined),
            autoFlush: this.flushTime,
        });
        this.colFlow = new CollectionFlow({
            t: this.t,
            container: this.container,
            bank: () => this.bank,
            docs: () => this.docs,
            docId: () => this.docId,
            sideFilter: () => this.sideFilter,
            reloadFromCollection: () => {
                void this.flushTimeAsync();
                this.docId = "";
                this.persistPrefs();
                void this.load();
            },
        });
    }

    readonly container = (): HTMLElement => this.el;
    readonly questions = (): WenguQuestion[] => this.list;
    readonly currentRevealMode = (): WenguRevealMode => this.revealMode;
    readonly timerController = (): TimerController => this.timer;
    readonly currentSession = (): WenguSession | undefined => this.session ?? this.finished;
    readonly roundComplete = (): void => showRoundReportNow(roundFinishCtx(this));
    readonly flushTime = (): void => void this.flushTimeAsync();
    readonly recordAnswer = (
        qid: string,
        submitted: string,
        ok: boolean,
        extra?: {verdict?: "right" | "partial" | "wrong"; comment?: string; cause?: string;},
    ): void => {
        const s = this.session;
        if (!s) return;
        pushSessionAnswer(s, qid, submitted, ok, this.timer.takeQuestionSec(qid), this.timer.elapsed(), extra);
        void this.history?.upsert(s);
        if (!qid.includes("#")) void this.bank?.recordAnswer(qid, submitted, ok); // 题库统计镜像（多步按整题在外层记）
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
        this.timerBar.start();
    }

    destroy(): void {
        this.timerBar.stop();
        this.progressive.clear();
        this.finishSession();
        void this.flushTimeAsync();
        void this.bank?.flush();
        this.protyleHost.destroyAll();
    }

    private selectDoc(docId: string): void {
        if (!docId || docId === this.docId) return;
        this.colFlow.reset(); // 点文档=离开题库模式
        void this.flushTimeAsync();
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
        void this.weakness?.applyRound(s, this.list); // 薄弱计数本地落，错因收卷后异步补
    }

    private async load(): Promise<void> {
        this.finishSession(); // 切文档/刷新/重开都视为上一轮结束
        this.loading = true;
        this.loadError = "";
        this.renderList();
        const prefs = await loadPrefs(this.storage);
        await this.weakness?.preload(); // 薄弱 Top 快照（报告同步渲染用）
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
        this.lastConvertKnow = r.lastConvertKnow;
        this.convertProgress = r.convertProgress;
        this.revealMode = r.revealMode;
        this.started = false;
        this.activeQIdx = 0;
        this.finished = undefined;
        this.docs = r.docs;
        this.pendingDoc = r.pendingDoc;
        this.docId = r.docId;
        this.docTotalSec = r.docTotalSec;
        this.fullList = r.fullList;
        this.list = r.fullList;
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
        // 存量/新文档迁移入库（后台；完成后补侧栏专题清单）
        if (this.bank) {
            void this.bank.ensureMigrated(this.docs).then((): void =>
                void this.colFlow.refresh().then((): void => this.colFlow.refreshSide())
            );
        }
    }

    private async flushTimeAsync(): Promise<void> {
        const id = this.docId;
        if (!id) return;
        const add = this.timer.consume();
        if (add <= 0) return;
        this.docTotalSec += add;
        try {
            await addDocTotalTime(id, add);
        } catch (_) {
            // 尽力而为
        }
    }

    readonly allRounds = (): WenguSession[] => this.rounds;
    readonly finishedSession = (): WenguSession | undefined => this.finished;
    readonly aiModelId = (): string => this.lastConvertModelId || this.settings?.convertModelId || "";
    readonly revealAnsweredNow = (): void => void revealAll(this);
    readonly stopRoundNow = (): void => {
        this.started = false;
        this.flushTime(); // 收卷即落库（未满 15s 的秒数不清零）
        this.timerBar.update();
    };
    readonly lockAllCardsNow = (): void => lockAllCards(this.el);
    readonly weaknessStore = (): WeaknessStore | undefined => this.weakness;

    private startPanelModel() {
        return startPanelModelFor(this);
    }

    private beginDrill(): void {
        beginDrillFor(this);
    }

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
    readonly updateTimerLabelNow = (): void => this.timerBar.update();
    readonly afterStartHook = (): void => {
        this.renderList();
        restoreAnsweredCards(this);
        this.timerBar.update();
    };

    private renderList(): void {
        this.el.classList.add("wengu-panel");
        try {
            this.renderListInner();
        } catch (e) {
            this.protyleHost.destroyAll();
            this.el.innerHTML = `<div class="wengu-head"></div>
    <div class="wengu-status wengu-status-err">${esc(this.t("loadFailed"))}${
                esc(String((e as Error)?.message ?? e))
            }</div>`;
            this.bindHead();
        }
    }

    private renderListInner(): void {
        this.protyleHost.destroyAll();
        const colMode = this.colFlow.isActive();
        const doc = colMode ? undefined : this.docs.find((d) => d.id === this.docId);
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
            subheadHtml: colMode ?
                `<span class="wengu-muted">${esc(this.colFlow.activeTitle() ?? "")} · ${
                    esc(String(this.list.length))
                }</span>` :
                renderSubheadHtml({t: this.t, doc, listCount: this.list.length, rounds: this.rounds}),
            cardsHtml: renderCardsHtml(this.list, {
                t: this.t,
                showAttempts: this.settings?.showAttempts !== false,
                showWrongBadge: this.settings?.showWrong !== false && this.revealMode !== "after",
            }),
            numsHtml: renderNumsHtml(
                this.list,
                this.t,
                this.settings?.showNums !== false,
                this.settings?.showWrong !== false && this.revealMode === "instant",
            ),
        });
        this.bindAll();
        if (colMode) this.protyleHost.mountStatic(this.el, this.list); // 题库静态渲染（Lute）
        else void this.protyleHost.mount(this.el, this.list);
        this.timerBar.update();
    }

    private bindAll(): void {
        this.bindHead();
        bindNumRail(this.el, {
            onActive: (idx) => {
                this.activeQIdx = idx;
                this.timer.setQuestion(this.list[idx]?.id ?? "");
            },
        });
        bindStartPanel(this.el, this.startPanelModel(), () => this.beginDrill());
        if (this.progressive.active) return; // 渐进呈现期不绑作答（文档每批重建）
        for (const node of this.el.querySelectorAll<HTMLElement>(".wengu-card")) {
            const q = this.list.find((x) => x.id === node.dataset.qid);
            if (q) bindCardEvents(this, node, q);
        }
    }

    private bindHead(): void {
        bindViewEvents({
            el: this.el,
            reload: () => void this.load(),
            openConvert: () => openConvertForView(this),
            openSettings: this.openSettings,
            filterDocs: (text) => {
                this.sideFilter = text;
                applySideFilter(
                    this.el,
                    this.docs,
                    this.docId,
                    this.t,
                    text,
                    this.colFlow.rowsView(),
                    this.colFlow.id(),
                );
            },
            toggleSide: (collapsed) => {
                this.sideCollapsed = collapsed;
                this.persistPrefs();
                this.renderList();
            },
            updateConvertBtn: () => updateConvertBtn(this.el, this.converting, this.t),
            switchDoc: (id) => this.selectDoc(id),
            switchCollection: (id) => this.colFlow.switchTo(id),
            openCollections: () => this.colFlow.openDialog(),
        });
    }

    /* ── ConvertViewAccess（openConvertForView 消费） ── */
    readonly activeDocIdOf = (): string => this.activeDocId;
    readonly settingsOf = (): SettingsDialogShape | undefined => this.settings;
    readonly lastConvert = (): {modelId: string; fill: boolean; steps: boolean; know: string;} => ({
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
        this.pendingDoc = {id, title};
        this.docId = id;
        this.persistPrefs();
        if (!this.docs.some((d) => d.id === id)) {
            this.docs.unshift({id, title, hPath: "", total: count, attempted: 0, rightCount: 0, totalTime: 0});
        }
    };
    readonly applyQuizList = (list: WenguQuestion[]): void => {
        this.fullList = list;
        this.list = list;
        this.renderList();
    };
    readonly reloadView = (): void => {
        void this.load();
    };
    readonly onConvertDone = (r: {docId: string; title: string; count: number; message: string;}): void => {
        this.progressive.clear();
        this.pendingDoc = {id: r.docId, title: r.title};
        this.docId = r.docId;
        this.colFlow.reset();
        this.persistPrefs();
        void this.load().then(() => showStatus(this.el, convertDoneText(this.t, r.title, r.count), "ok"));
    };
}
