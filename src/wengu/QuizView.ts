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
import type {ConvertProgressRecord} from "./ConvertBatch";
import {
    convertDoneText,
    openWenguConvert,
    showStatus,
    updateConvertBtn,
} from "./ConvertHost";
import type {
    HistoryStore,
    WenguSession,
} from "./HistoryStore";
import {pushSessionAnswer} from "./HistoryStore";
import {bindNumRail} from "./NumRail";
import {
    ProgressivePreview,
    showBatchPreview,
} from "./ProgressivePreview";
import {ProtyleHost} from "./ProtyleHost";
import {addDocTotalTime} from "./QuestionService";
import {
    loadPrefs,
    loadQuizState,
    savePrefs,
} from "./QuizLoader";
import type {WenguPrefsIo} from "./QuizLoader";
import {
    lockAllCards,
    manualFinishRound,
    roundFinishCtx,
    showRoundReportNow,
    showTimeUpChoice,
} from "./RoundReport";

import type {WenguSettingsShape as SettingsDialogShape} from "./SettingsDialog";
import {
    bindStartPanel,
    buildStartPanelModel,
    renderStartPanel,
    roundDefaults,
    startRound,
} from "./StartPanel";
import {bindViewEvents} from "./ViewBindings";

import {
    renderTimerLabel,
    TimerController,
} from "./TimerController";
import type {
    WenguDoc,
    WenguQuestion,
    WenguRevealMode,
} from "./types";
import {esc} from "./ui";

/** 温故刷题页签视图（编排层），各模块见 docs/design-review.md。 */
export class QuizView implements AnswerHost {
    /** i18n 取值（public：AnswerHost 接口按结构匹配）。 */
    readonly t: (key: string) => string;
    private readonly el: HTMLElement;
    private readonly app?: App;
    private readonly storage?: {load: () => Promise<unknown>; save: (v: WenguPrefsIo) => Promise<unknown>;};
    private readonly settings?: SettingsDialogShape;
    private readonly history?: HistoryStore;
    private readonly openSettings?: () => void;
    private readonly timer = new TimerController(() => this.updateTimerLabel());
    private readonly protyleHost: ProtyleHost;
    private readonly progressive = new ProgressivePreview();
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
    private timerInt: number | undefined;
    private revealMode: WenguRevealMode = "instant";
    private activeQIdx = 0;
    private started = false;
    private lastConvertModelId = "";
    private lastConvertFill = false;
    private lastConvertSteps = false;
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
        this.openSettings = openSettings;
        this.protyleHost = new ProtyleHost(app);
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
        extra?: {verdict?: "right" | "partial" | "wrong"; comment?: string;},
    ): void => {
        const s = this.session;
        if (!s) return;
        pushSessionAnswer(s, qid, submitted, ok, this.timer.takeQuestionSec(qid), this.timer.elapsed(), extra);
        void this.history?.upsert(s);
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
        this.startTimer();
    }

    destroy(): void {
        this.stopTimer();
        this.progressive.clear();
        this.finishSession();
        void this.flushTimeAsync();
        this.protyleHost.destroyAll();
    }

    private selectDoc(docId: string): void {
        if (!docId || docId === this.docId) return;
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
        this.loadError = r.loadError;
        this.loading = false;
        this.renderList();
    }

    private startTimer(): void {
        if (this.timerInt !== undefined) return;
        this.timerInt = window.setInterval(() => {
            if (!this.docId || !this.started || this.timer.mode === "none") return;
            const justTimeUp = this.timer.tick();
            if (this.session) this.session.elapsedSec = this.timer.elapsed();
            if (justTimeUp) this.showTimeUpBar();
            this.updateTimerLabel();
            if (this.timer.pending % 15 === 0) void this.flushTimeAsync();
        }, 1000);
    }

    private stopTimer(): void {
        if (this.timerInt !== undefined) {
            window.clearInterval(this.timerInt);
            this.timerInt = undefined;
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

    private updateTimerLabel(): void {
        const qid = this.list[this.activeQIdx]?.id;
        renderTimerLabel(
            this.el.querySelector<HTMLElement>("[data-timer]"),
            this.timer,
            this.t,
            this.docTotalSec + this.timer.pending,
            qid ? this.timer.questionSec(qid) : 0,
        );
    }

    /** 倒计时归零：给出「继续作答 / 结束本轮」的选择条。 */
    private showTimeUpBar(): void {
        const slot = this.el.querySelector<HTMLElement>("[data-timeup-slot]");
        if (!slot || slot.childElementCount > 0) return;
        showTimeUpChoice(slot, this.t, {
            onOvertime: () => this.timer.beginOvertime(),
            onFinish: () => manualFinishRound(roundFinishCtx(this)),
        });
    }

    readonly allRounds = (): WenguSession[] => this.rounds;
    readonly finishedSession = (): WenguSession | undefined => this.finished;
    readonly aiModelId = (): string => this.lastConvertModelId || this.settings?.convertModelId || "";
    readonly revealAnsweredNow = (): void => void revealAll(this);
    readonly stopRoundNow = (): void => {
        this.started = false;
        this.flushTime(); // 收卷即落库（未满 15s 的秒数不清零）
        this.updateTimerLabel();
    };
    readonly lockAllCardsNow = (): void => lockAllCards(this.el);

    private startPanelModel() {
        return buildStartPanelModel({
            t: this.t,
            defaults: roundDefaults(this.revealMode, this.timer),
            rounds: this.rounds,
            list: this.list,
        });
    }

    private beginDrill(): void {
        startRound({
            root: this.el,
            defaults: roundDefaults(this.revealMode, this.timer),
            rounds: this.rounds,
            fullList: this.fullList,
            docId: this.docId,
            timer: this.timer,
            history: this.history,
            setList: (l) => (this.list = l),
            setRevealMode: (m) => (this.revealMode = m),
            setActiveIdx: (i) => (this.activeQIdx = i),
            setStarted: (v) => (this.started = v),
            setFinished: (s) => (this.finished = s),
            setSession: (s) => (this.session = s),
            afterStart: () => {
                this.renderList();
                restoreAnsweredCards(this);
                this.updateTimerLabel();
            },
        });
    }

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
        const doc = this.docs.find((d) => d.id === this.docId);
        this.el.innerHTML = renderMainShell({
            t: this.t,
            docs: this.docs,
            docId: this.docId,
            sideCollapsed: this.sideCollapsed,
            filter: this.sideFilter,
            hasSettingsButton: !!this.openSettings,
            loading: this.loading,
            loadError: this.loadError,
            started: this.started,
            previewing: this.progressive.active,
            hasDoc: !!doc,
            listCount: this.list.length,
            startPanelHtml: renderStartPanel(this.startPanelModel()),
            subheadHtml: renderSubheadHtml({t: this.t, doc, listCount: this.list.length, rounds: this.rounds}),
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
        void this.protyleHost.mount(this.el, this.list);
        this.updateTimerLabel();
    }

    private bindAll(): void {
        this.bindHead();
        this.bindNums();
        bindStartPanel(this.el, this.startPanelModel(), () => this.beginDrill());
        this.bindCards();
    }

    private bindHead(): void {
        bindViewEvents({
            el: this.el,
            reload: () => void this.load(),
            openConvert: () => this.openConvert(),
            openSettings: this.openSettings,
            filterDocs: (text) => {
                this.sideFilter = text;
                applySideFilter(this.el, this.docs, this.docId, this.t, text);
            },
            toggleSide: (collapsed) => {
                this.sideCollapsed = collapsed;
                this.persistPrefs();
                this.renderList();
            },
            updateConvertBtn: () => updateConvertBtn(this.el, this.converting, this.t),
            switchDoc: (id) => {
                if (!id || id === this.docId) return;
                void this.flushTimeAsync();
                this.docId = id;
                this.persistPrefs();
                void this.load();
            },
        });
    }

    private bindNums(): void {
        bindNumRail(this.el, {
            onActive: (idx) => {
                this.activeQIdx = idx;
                this.timer.setQuestion(this.list[idx]?.id ?? "");
            },
        });
    }

    private bindCards(): void {
        // 渐进呈现期不绑作答事件（文档每批重建，作答状态无法保留）
        if (this.progressive.active) return;
        for (const node of this.el.querySelectorAll<HTMLElement>(".wengu-card")) {
            const q = this.list.find((x) => x.id === node.dataset.qid);
            if (q) bindCardEvents(this, node, q);
        }
    }

    private openConvert(): void {
        openWenguConvert({
            t: this.t,
            el: this.el,
            activeDocId: this.activeDocId,
            settings: this.settings,
            lastConvertModelId: this.lastConvertModelId,
            lastConvertFill: this.lastConvertFill,
            lastConvertSteps: this.lastConvertSteps,
            saveChoice: (modelId, fill, steps) => {
                this.lastConvertModelId = modelId;
                this.lastConvertFill = fill;
                this.lastConvertSteps = steps;
                this.persistPrefs();
            },
            getProgress: (srcDocId) => this.convertProgress[srcDocId],
            saveProgress: (srcDocId, rec) => {
                if (rec) this.convertProgress[srcDocId] = rec;
                else delete this.convertProgress[srcDocId];
                this.persistPrefs();
            },
            setConverting: (v) => {
                this.converting = v;
                updateConvertBtn(this.el, this.converting, this.t);
            },
            onBatch: (docId, title, count, batch, total) =>
                showBatchPreview(this.progressive, this.previewHost(), docId, title, count, batch, total),
            onCancel: () => {
                this.progressive.clear();
                void this.load();
            },
            onDone: (r) => {
                this.progressive.clear();
                this.pendingDoc = {id: r.docId, title: r.title};
                this.docId = r.docId;
                this.persistPrefs();
                void this.load().then(() => showStatus(this.el, convertDoneText(this.t, r.title, r.count), "ok"));
            },
        });
    }

    /** 渐进呈现的宿主适配（showBatchPreview 用，视图状态切换集中在这）。 */
    private previewHost() {
        return {
            t: this.t,
            el: this.el,
            isStarted: () => this.started,
            currentDocId: () => this.docId,
            switchDoc: (id: string, title: string, count: number) => {
                this.pendingDoc = {id, title};
                this.docId = id;
                this.persistPrefs();
                if (!this.docs.some((d) => d.id === id)) {
                    this.docs.unshift(
                        {id, title, hPath: "", total: count, attempted: 0, rightCount: 0, totalTime: 0},
                    );
                }
            },
            applyList: (list: WenguQuestion[]) => {
                this.fullList = list;
                this.list = list;
                this.renderList();
            },
        };
    }
}
