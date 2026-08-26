import { WordAiRunner, wordAiInput, type WordAiInput } from "./WordAi";
import WORD_BOOK from "./WordBook";
import { addPair, confOthers, groupsOf } from "./WordConfusables";
import { LookupConfCtl } from "./WordLookup";
import { checkOption, pickMode, spellMatches, type AnsweredState } from "./WordQuiz";
import { WordStartCtl } from "./WordStart";
import {
    applyGrade,
    buildQueue,
    groupSizeOf,
    markFamiliar,
    pushTiming,
    rollToday,
    starredList,
    toggleStar,
    WordStore,
    confKey,
    type WenguTimingRec,
    type WordGrade,
} from "./WordStore";
import { rebuildTail, REINSERT_GAP, WordTimer } from "./WordTiming";
import type { WordUi } from "./WordUi";

/**
 * 单词复习控制器（Svelte 化改造）：会话状态机与全部语义动作在此，
 * 渲染交给 src/word/comp/ 下的 Svelte 组件（读 ui 深代理细粒度更新）。
 * 旧 WordActs 的 data-act 分发改为组件直调公开方法；WordBind 的
 * 键盘分发保留在同名模块。计时与组机制见 docs/word-timing.md
 * （计时只累计可见且非输入的时间，组完成异步触发 AI 复盘不阻塞）。
 */
export class WordView {
    readonly t: (key: string) => string;
    readonly store: WordStore;
    readonly ui: WordUi;
    /** 本会话队列（扁平下标）。 */
    private queue: number[] = [];
    private pos = 0;
    /** 本会话已作答过的词（新词首答后，重现走题型轮换）。 */
    private learned = new Set<number>();
    /** 构队时标记的新词（首次作答计入今日新词数）。 */
    private sessionNew = new Set<number>();
    /** 本会话答错过的词（去重），完成后可一键重过。 */
    hardList: number[] = [];
    private readonly doneSet = new Set<number>();
    /** 当前卡计时结算（reveal/作答时存，finishCard 消费）。 */
    private curTiming: WenguTimingRec | undefined;
    /** spell 错拼原文（作答瞬间抓取）。 */
    private spellTyped: string | undefined;
    private busy = false;
    /** 误认词 AI 视图胶水。 */
    readonly ai: WordAiRunner;
    private timer?: WordTimer;
    /** 本组作答画像（组完成时交 AI，一步继续不等待）。 */
    private groupLog: WordAiInput[] = [];
    private finishCount = 0;
    /** AI 复盘已落盘待消费（下个组边界重排队列余量）。 */
    private aiDirty = false;
    /** 查词详情的易混笔记控制器。 */
    readonly confCtl: LookupConfCtl;
    private startCtlCache?: WordStartCtl;

    constructor(ui: WordUi, i18n: Record<string, string>, store: WordStore) {
        this.ui = ui;
        this.t = (k) => i18n[k] ?? k;
        this.store = store;
        this.ai = new WordAiRunner(this.t);
        this.confCtl = new LookupConfCtl(
            () => this.ui.progress!,
            (p) => this.store.save(p),
            () => this.syncAi()
        );
    }

    /** 挂载计时宿主容器（WordApp onMount 后调用一次）。 */
    attach(hostEl: HTMLElement): void {
        this.timer ??= new WordTimer(hostEl);
    }

    async render(): Promise<void> {
        const p = await this.store.get();
        // 存进 ui 才会被 $state 深代理包裹（此后所有读写都走代理）
        this.ui.progress = p;
        const started = p.cursor > 0 || Object.keys(p.words).length > 0;
        this.ui.mode = started ? "home" : "setstart";
        this.syncAi();
    }

    destroy(): void {
        this.timer?.dispose();
    }

    get currentIdx(): number {
        return this.queue[this.pos] ?? 0;
    }

    /** 隔夜翻转（进入 home/stats/组队等边界时调用，对齐旧 paint 首行行为）。 */
    private roll(): void {
        if (this.ui.progress) rollToday(this.ui.progress);
    }

    /** 按入口建队列：review=到期复习 / fresh=新学 / star=星标。 */
    rebuildQueue(kind: "review" | "fresh" | "star"): void {
        const p = this.ui.progress;
        if (!p) return;
        if (kind === "star") {
            this.queue = starredList(p);
            this.sessionNew = new Set<number>();
        } else {
            const { review, fresh } = buildQueue(p);
            this.queue = kind === "review" ? [...review] : [...fresh];
            this.sessionNew = kind === "review" ? new Set<number>() : new Set(fresh);
        }
        this.ui.queueKind = kind;
        this.pos = 0;
        this.hardList = [];
        this.ui.hardN = 0;
        this.doneSet.clear();
        this.groupLog = [];
        this.finishCount = 0;
        this.enterPrompt();
    }

    /** 进入当前位置的卡：未答过 → 新学 choiceEn 先测后学 / 复习 recallEn 回想；答过 → 题型轮换。 */
    private enterPrompt(): void {
        this.ui.phase = "prompt";
        this.ui.answered = undefined;
        this.curTiming = undefined;
        this.spellTyped = undefined;
        this.ui.spellLive = "";
        this.ui.confessedDraft = "";
        const idx = this.currentIdx;
        this.ui.idx = idx;
        this.ui.confIds = confOthers(this.ui.progress!, idx);
        this.ui.pos = this.pos;
        this.ui.queueLen = this.queue.length;
        const first = this.sessionNew.has(idx) ? "choiceEn" : "recallEn";
        this.ui.cardMode = this.learned.has(idx) ? pickMode(this.ui.cardSeq, idx, this.ui.confIds) : first;
        this.timer?.begin(this.ui.cardMode);
    }

    /** 选择题作答(点击/数字键共用)。 */
    private answerByOption(no: number): void {
        if (this.ui.cardMode !== "choiceEn" && this.ui.cardMode !== "choiceZh") return;
        this.applyAnswered(checkOption(this.ui.cardMode, this.currentIdx, no, this.ui.confIds));
    }

    /** 客观题作答落位：题面内标色 + 详情 + 继续按钮（评分延迟到收尾）。 */
    private applyAnswered(a: AnsweredState | undefined): void {
        if (!a || this.ui.phase !== "prompt" || this.ui.answered) return;
        const s = this.timer?.settle();
        if (s) this.curTiming = s;
        this.ui.answered = a;
    }

    /** 收尾：应用档位并进下一张；答错的词隔 3 张重现直到当场过关。 */
    finishCard(grade: WordGrade): void {
        const awaitingGrade = this.ui.phase === "result" || this.ui.answered;
        if (!awaitingGrade || this.busy || !this.ui.progress) return;
        this.busy = true;
        const p = this.ui.progress;
        const idx = this.currentIdx;
        // 自述「认成了什么」：填了即没记住（决策 7，不论点什么档位）
        const v = this.ui.confessedDraft.trim();
        if (v) grade = "no";
        // 停留超时（走神）按「忘记」处理（决策 2）
        if (this.curTiming?.over) grade = "no";
        applyGrade(p, idx, grade, this.sessionNew.has(idx));
        if (v) p.mistakes[String(idx)].confused = v;
        // 误认实证（决策 7）：自述「认成了 B」，否则错选 B 的选项
        const pf = this.ui.answered && !this.ui.answered.correct ? this.ui.answered.pickFrom : undefined;
        if (v) addPair(p, idx, v, "evidence");
        else if (pf !== undefined && pf !== idx) addPair(p, idx, WORD_BOOK.words[pf].w, "evidence");
        if (this.curTiming) {
            this.curTiming.typed = this.spellTyped;
            pushTiming(p, idx, this.curTiming);
        }
        this.groupLog.push(wordAiInput(p, idx, grade, this.ui.answered?.correct, this.curTiming, this.spellTyped, v));
        this.curTiming = undefined;
        this.spellTyped = undefined;
        this.advanceAfterFinish(grade, idx);
    }

    /** 标「熟」收尾：退出复习循环，不进误认/重现。 */
    finishMastered(): void {
        const awaiting = this.ui.phase === "result" || this.ui.answered;
        if (!awaiting || this.busy || !this.ui.progress) return;
        this.busy = true;
        const idx = this.currentIdx;
        markFamiliar(this.ui.progress, idx, this.sessionNew.has(idx));
        this.advanceAfterFinish("know", idx);
    }

    /** 星标开关（任意卡、任意阶段可点）。 */
    toggleStarCard(): void {
        if (!this.ui.progress || this.ui.mode !== "card") return;
        toggleStar(this.ui.progress, this.currentIdx);
        void this.store.save(this.ui.progress);
    }

    /** finishCard/finishMastered 公共推进 + 组边界（决策 3/6）。 */
    private advanceAfterFinish(grade: WordGrade, idx: number): void {
        const p = this.ui.progress!;
        this.learned.add(idx);
        if (grade === "no") {
            if (!this.hardList.includes(idx)) this.hardList.push(idx);
            // 会话内重现：插到 3 张卡之后（到末尾则接着出）
            this.queue.splice(Math.min(this.pos + 1 + REINSERT_GAP, this.queue.length), 0, idx);
        }
        void this.store.save(p);
        this.doneSet.add(idx);
        this.pos++;
        this.ui.cardSeq++;
        this.finishCount++;
        if (this.finishCount % groupSizeOf(p) === 0) {
            const batch = this.groupLog;
            this.groupLog = [];
            if (this.aiDirty) {
                // AI 已落盘：本地即时重排余量，下一组吃到（不等待）
                this.aiDirty = false;
                const r = rebuildTail(
                    p,
                    this.ui.queueKind,
                    this.queue,
                    this.pos,
                    this.hardList,
                    this.doneSet,
                    this.sessionNew
                );
                this.queue = r.queue;
                for (const i of r.newcomers) this.sessionNew.add(i);
            }
            void this.ai.runGroup(
                batch,
                p,
                () => this.store.save(p),
                () => {
                    this.aiDirty = true;
                }
            );
        }
        this.ui.hardN = this.hardList.length;
        if (this.pos >= this.queue.length) {
            this.ui.pos = this.pos;
            this.ui.queueLen = this.queue.length;
            this.ui.mode = "done";
            this.flushGroup();
        } else {
            this.enterPrompt();
        }
        this.busy = false;
        this.syncAi();
    }

    /** 会话收尾：不满一组也把剩余画像交 AI（异步）。 */
    private flushGroup(): void {
        if (this.groupLog.length === 0 || !this.ui.progress) return;
        const batch = this.groupLog;
        this.groupLog = [];
        void this.ai.runGroup(
            batch,
            this.ui.progress,
            () => this.store.save(this.ui.progress!),
            () => undefined
        );
    }

    redoHard(): void {
        if (this.hardList.length === 0) return;
        this.queue = [...this.hardList];
        this.hardList = [];
        this.ui.hardN = 0;
        this.pos = 0;
        this.sessionNew = new Set<number>();
        this.ui.mode = "card";
        this.enterPrompt();
    }

    // ---------- 起点设置（操作在 WordStartCtl） ----------

    startCtl(): WordStartCtl {
        this.startCtlCache ??= new WordStartCtl(
            this.ui,
            this.t,
            () => this.ui.progress!,
            (p) => this.store.save(p)
        );
        return this.startCtlCache;
    }

    // ---------- 键盘分发与作答入口（WordBind/组件共用） ----------

    option(no: number): void {
        if (!this.ui.answered) this.answerByOption(no);
    }

    grade(g: WordGrade): void {
        this.finishCard(g);
    }

    reveal(): void {
        if (
            this.ui.phase === "prompt" &&
            this.ui.cardMode !== "choiceEn" &&
            this.ui.cardMode !== "choiceZh" &&
            this.ui.cardMode !== "spell"
        ) {
            const s = this.timer?.settle();
            if (s) this.curTiming = s;
            this.ui.phase = "result";
        }
    }

    submitSpell(): void {
        if (this.ui.cardMode === "spell") {
            this.spellTyped = this.ui.spellLive.trim() || undefined;
            this.applyAnswered({ correct: spellMatches(this.ui.spellLive, WORD_BOOK.words[this.currentIdx].w) });
        }
    }

    confessEnter(): void {
        this.finishCard("no");
    }

    continueObjective(): void {
        this.finishCard(this.ui.answered?.correct ? "know" : "no");
    }

    importFile(file: File, input: HTMLInputElement): void {
        void this.startCtl().importFile(file, input);
    }

    lookupInput(value: string): void {
        this.ui.lookupQuery = value;
        this.ui.lookupSel = undefined;
    }

    /** 笔记草稿输入（confnote=组辨析 / wordnote=词级，不重绘）。 */
    noteInput(field: string, value: string): void {
        if (field === "confnote") this.confCtl.draft = value;
        else this.confCtl.wordDraft = value;
    }

    // ---------- 页面动作（旧 WordActs 的 data-act 分发改直调） ----------

    goReview(): void {
        this.roll();
        this.ui.mode = "card";
        this.rebuildQueue("review");
    }

    goFresh(): void {
        this.roll();
        const { review } = buildQueue(this.ui.progress!);
        if (review.length > 0) {
            this.ui.mode = "askreview"; // 有到期复习 → 先弹「先复习」
        } else {
            this.ui.mode = "card";
            this.rebuildQueue("fresh");
        }
    }

    goFreshAnyway(): void {
        this.ui.mode = "card";
        this.rebuildQueue("fresh");
    }

    goStar(): void {
        this.roll();
        this.ui.mode = "card";
        this.rebuildQueue("star");
    }

    showStats(): void {
        this.roll();
        this.ui.mode = "stats";
        this.syncAi();
    }

    goHome(): void {
        this.roll();
        this.ui.mode = "home";
        this.syncAi();
    }

    setStart(): void {
        this.ui.mode = "setstart";
    }

    applyStart(): void {
        this.startCtl().apply();
        this.ui.mode = "home";
        this.syncAi();
    }

    cancelSet(): void {
        this.ui.mode = "home";
    }

    showAnswer(): void {
        this.reveal();
    }

    enterLookup(): void {
        this.ui.lookupSel = undefined;
        this.ui.fromCard = this.ui.mode === "card";
        this.ui.mode = "lookup";
    }

    lookupPick(idx: number): void {
        const p = this.ui.progress!;
        const g = groupsOf(p, idx)[0];
        this.confCtl.draft = g ? (p.confNotes?.[confKey(g.ids)] ?? "") : "";
        this.confCtl.wordDraft = p.notes?.[String(idx)] ?? "";
        this.ui.lookupSel = idx;
    }

    lookupStar(idx: number): void {
        toggleStar(this.ui.progress!, idx);
        void this.store.save(this.ui.progress!);
    }

    lookupFamiliar(idx: number): void {
        markFamiliar(this.ui.progress!, idx, false);
        void this.store.save(this.ui.progress!);
        this.syncAi();
    }

    aiAnalyze(): void {
        const p = this.ui.progress;
        if (p) {
            void this.ai.run(
                p,
                () => this.store.save(p),
                () => {
                    this.ui.mode = "home";
                },
                () => this.syncAi()
            );
        }
    }

    resumeCard(): void {
        this.ui.mode = "card";
    }

    confAsk(idx: number): void {
        this.confCtl.ask(idx);
    }

    wordNoteSave(idx: number): void {
        this.confCtl.saveWordNote(idx);
    }

    confSave(idx: number): void {
        this.confCtl.saveNote(idx);
    }

    setGroupSize(n: number): void {
        if (n >= 5 && n <= 20 && this.ui.progress) {
            this.ui.progress.groupSize = n;
            void this.store.save(this.ui.progress);
        }
    }

    /** 把 AI runner 的普通字段镜像进响应态（按钮/消息渲染读镜像）。 */
    syncAi(): void {
        this.ui.aiRunning = this.ai.running;
        this.ui.aiMsg = this.ai.msg;
        this.ui.aiPending = this.ui.progress ? this.ai.pending(this.ui.progress).length : 0;
    }
}
