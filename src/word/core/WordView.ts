import { WordAiRunner, type WordAiInput } from "../service/WordAi";
import { wordLib } from "../service/WordLib";
import { confOthers } from "../service/WordConfusables";
import { LookupConfCtl } from "../flow/WordLookup";
import { finishCardFor, finishMasteredFor, redoHardFor } from "../flow/CardOps";
import { switchBookFor, removeBookFor, importBookFor } from "../flow/BookOps";
import { bookLeftFor, startFreshFor } from "../flow/FreshFlow";
import {
    enterLookupFor,
    lookupFamiliarFor,
    lookupInputFor,
    lookupPickFor,
    lookupStarFor,
    noteInputFor,
    resumeCardFor,
} from "../flow/LookupOps";
import {
    applyStartFor,
    cancelSetFor,
    goFreshAnywayFor,
    goFreshFor,
    goHomeFor,
    goReviewFor,
    goStarFor,
    setStartFor,
    showStatsFor,
} from "../flow/PageOps";
import {
    checkOption,
    ladderMode,
    pickMode,
    remainingWordCount,
    spellMatches,
    type AnsweredState,
} from "../flow/WordQuiz";
import type { WinEntry } from "../flow/WindowSched";
import { speakWord } from "../service/WordSpeak";
import { WordStartCtl, makeStartCtl } from "../flow/WordStart";
import { buildQueue, starredList, toggleStar, WordStore, type WenguTimingRec, type WordGrade } from "./WordStore";
import { WordTimer } from "./WordTiming";
import type { WordUi } from "./WordUi";

/**
 * 单词复习控制器（Svelte 化改造）：会话状态机与全部语义动作在此，
 * 渲染交给 src/word/comp/ 下的 Svelte 组件（读 ui 深代理细粒度更新）。
 *
 * 会话双轨（redesign §二/§三，20260828）：fresh=新学滚动窗口（freshWin/
 * seq/cur，编排见 FreshFlow，决策见 WindowSched，进度持久 ladder）；
 * review/star=到期/星标队列（queue+pos，答错隔卡重现）。计时与组机制
 * 见 docs/word-timing.md（组边界 fresh 按毕业数、队列会话按卡数触发）。
 */
export class WordView {
    readonly t: (key: string) => string;
    readonly store: WordStore;
    readonly ui: WordUi;
    /** 队列会话（review/star）的队列与位置（fresh 轨不走，恒空）。 */
    queue: number[] = [];
    pos = 0;
    /** 滚动窗口轨（fresh）：在学词 → 步进/出镜/重来（FreshFlow 友元）。 */
    freshWin = new Map<number, WinEntry>();
    seq = 0;
    cur = 0;
    /** 本会话已作答过的词（队列轨重现词走题型轮换；重过/切书时清，
     *  CardOps/BookOps 友元同权访问）。 */
    readonly learned = new Set<number>();
    /** 会话内已标熟（查词「标熟」）：当前卡收尾跳过复习批改防双计。 */
    readonly familiarized = new Set<number>();
    /** 本会话答错过的词（去重），完成后可一键重过。 */
    hardList: number[] = [];
    readonly doneSet = new Set<number>();
    /** 当前卡计时结算（reveal/作答时存，CardOps.finishCardFor 消费；
     *  友元直访字段，压 500 行红线时放权）。 */
    curTiming: WenguTimingRec | undefined;
    /** spell 错拼原文（作答瞬间抓取，CardOps 消费）。 */
    spellTyped: string | undefined;
    /** 收尾互斥（CardOps 置位/复位）。 */
    busy = false;
    /** 误认词 AI 视图胶水。 */
    readonly ai: WordAiRunner;
    private timer?: WordTimer;
    /** 本组作答画像（组完成时交 AI，一步继续不等待）。 */
    groupLog: WordAiInput[] = [];
    /** fresh=毕业数 / 队列轨=卡数（AI 组边界与完成屏口径）。 */
    finishCount = 0;
    /** AI 复盘已落盘待消费（队列轨组边界重排余量用）。 */
    aiDirty = false;
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
        // 词书房先就绪（首次启动落盘内置书），当前书镜像进响应态供组件读
        const lib = wordLib();
        await lib.ensure();
        this.ui.book = lib.curBook();
        this.ui.books = lib.listBooks();
        const p = await this.store.get();
        // 存进 ui 才会被 $state 深代理包裹（此后所有读写都走代理）
        this.ui.progress = p;
        const started = Object.keys(p.words).length > 0 || Object.keys(p.ladder).length > 0;
        this.ui.mode = started ? "home" : "setstart";
        this.syncAi();
    }

    destroy(): void {
        this.timer?.dispose();
    }

    get currentIdx(): number {
        return this.ui.queueKind === "fresh" ? this.cur : (this.queue[this.pos] ?? 0);
    }

    /** 按入口建会话：review=到期复习 / fresh=新学滚动窗口 / star=星标。 */
    rebuildQueue(kind: "review" | "fresh" | "star"): void {
        if (!this.ui.progress) return;
        if (kind === "fresh") {
            startFreshFor(this);
            return;
        }
        this.queue = kind === "star" ? starredList(this.ui.progress) : [...buildQueue(this.ui.progress).review];
        this.freshWin = new Map();
        this.ui.queueKind = kind;
        this.pos = 0;
        this.hardList = [];
        this.ui.hardN = 0;
        this.doneSet.clear();
        this.learned.clear(); // 新会话：首见词仍走 recallEn 回想
        this.familiarized.clear();
        this.groupLog = [];
        this.finishCount = 0;
        this.enterPrompt();
    }

    /** 进入当前卡的题面：fresh 按窗口步数选梯型 / 队列轨题型轮换、
     * 队列外首见（review 入口）回想开始。（CardOps 友元可达） */
    enterPrompt(): void {
        this.ui.phase = "prompt";
        this.ui.answered = undefined;
        this.ui.selfGrade = undefined;
        this.ui.mistakeClaimed = false;
        this.curTiming = undefined;
        this.spellTyped = undefined;
        this.ui.spellLive = "";
        this.ui.confessedDraft = "";
        const idx = this.currentIdx;
        this.ui.idx = idx;
        this.ui.confIds = confOthers(this.ui.progress!, idx);
        if (this.ui.queueKind === "fresh") {
            this.ui.pos = 0;
            this.ui.queueLen = 0;
            this.ui.remainWords = bookLeftFor(this);
            const e = this.freshWin.get(idx);
            this.ui.cardMode = e ? ladderMode(e.step, idx, this.ui.confIds) : "recallEn";
        } else {
            this.ui.pos = this.pos;
            this.ui.queueLen = this.queue.length;
            this.ui.remainWords = remainingWordCount(this.queue, this.pos);
            this.ui.cardMode = this.learned.has(idx) ? pickMode(this.ui.cardSeq, idx, this.ui.confIds) : "recallEn";
        }
        this.timer?.begin(this.ui.cardMode);
    }

    /** 选择题作答(点击/数字键共用)；听音题同用释义选项。 */
    private answerByOption(no: number): void {
        if (this.ui.cardMode !== "choiceEn" && this.ui.cardMode !== "choiceZh" && this.ui.cardMode !== "listen") return;
        this.applyAnswered(checkOption(this.ui.cardMode, this.currentIdx, no, this.ui.confIds));
    }

    /** 客观题作答落位：题面内标色 + 详情 + 继续按钮（评分延迟到收尾）。 */
    private applyAnswered(a: AnsweredState | undefined): void {
        if (!a || this.ui.phase !== "prompt" || this.ui.answered) return;
        const s = this.timer?.settle();
        if (s) this.curTiming = s;
        this.ui.answered = a;
    }

    /** 收尾：批改并进下一张（实现体在 CardOps.finishCardFor，拆出压
     *  500 行红线）。fresh=滚动梯步进、队列轨=FSRS 复习步进+隔卡重现。 */
    finishCard(grade: WordGrade): void {
        finishCardFor(this, grade);
    }

    /** 标「熟」收尾（实现体在 CardOps.finishMasteredFor）。 */
    finishMastered(): void {
        finishMasteredFor(this);
    }

    /** 星标开关（任意卡、任意阶段可点）。 */
    toggleStarCard(): void {
        if (!this.ui.progress || this.ui.mode !== "card") return;
        toggleStar(this.ui.progress, this.currentIdx);
        void this.store.save(this.ui.progress);
    }

    redoHard(): void {
        redoHardFor(this);
    }

    // ---------- 起点设置（操作在 WordStartCtl） ----------

    startCtl(): WordStartCtl {
        return (this.startCtlCache ??= makeStartCtl(this));
    }

    // ---------- 键盘分发与作答入口（WordBind/组件共用） ----------

    option(no: number): void {
        if (!this.ui.answered) this.answerByOption(no);
    }

    /** 「看答案」：选择题/听音题正面直接翻底，按答错计（redesign §二.1）。 */
    peekAnswer(): void {
        const m = this.ui.cardMode;
        if (this.ui.phase !== "prompt" || this.ui.answered) return;
        if (m !== "choiceEn" && m !== "choiceZh" && m !== "listen") return;
        const s = this.timer?.settle();
        if (s) this.curTiming = s;
        this.ui.answered = { correct: false, peek: true };
    }

    /** 念当前词（speechSynthesis，WordSpeak 模块；不可用环境静默）。 */
    playCurrentWord(): void {
        speakWord(wordLib().curBook().words[this.currentIdx].w);
    }

    grade(g: WordGrade): void {
        this.finishCard(g);
    }

    /** 回想题正面选档（认识/模糊/忘记）：翻面挂档，收尾走「下一个」。 */
    pickSelfGrade(g: WordGrade): void {
        if (this.ui.cardMode !== "recallEn" && this.ui.cardMode !== "recallZh") return;
        this.reveal();
        this.ui.selfGrade = g;
    }

    /** 「记错了」：挂错标，收尾强制按不认识批改并常驻自述框。 */
    claimMistake(): void {
        this.ui.mistakeClaimed = true;
    }

    /** 已选档后的「下一个」：按正面所选档位收尾。 */
    nextGraded(): void {
        if (this.ui.selfGrade === undefined) return;
        this.finishCard(this.ui.selfGrade);
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
            this.applyAnswered({
                correct: spellMatches(this.ui.spellLive, wordLib().curBook().words[this.currentIdx].w),
            });
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
        lookupInputFor(this, value);
    }

    noteInput(field: string, value: string): void {
        noteInputFor(this, field, value);
    }

    // ---------- 页面动作（实现在 flow/PageOps，组件经薄委托调） ----------

    goReview(): void {
        goReviewFor(this);
    }

    goFresh(): void {
        goFreshFor(this);
    }

    goFreshAnyway(): void {
        goFreshAnywayFor(this);
    }

    goStar(): void {
        goStarFor(this);
    }

    showStats(): void {
        showStatsFor(this);
    }

    goHome(): void {
        goHomeFor(this);
    }

    setStart(): void {
        setStartFor(this);
    }

    applyStart(): void {
        applyStartFor(this);
    }

    cancelSet(): void {
        cancelSetFor(this);
    }

    enterLookup(): void {
        enterLookupFor(this);
    }

    lookupPick(idx: number): void {
        lookupPickFor(this, idx);
    }

    lookupStar(idx: number): void {
        lookupStarFor(this, idx);
    }

    lookupFamiliar(idx: number): void {
        lookupFamiliarFor(this, idx);
    }

    aiAnalyze(): void {
        const p = this.ui.progress;
        if (!p) return;
        void this.ai.run(
            p,
            () => this.store.save(p),
            // 应用完成原地刷新，不再踢回首页（「aiAnalyze 完成踢回首页」
            // 挂账清偿：卡片/查词中被 AI 完成打断强行导航）
            () => (this.ui.mode === "card" ? this.enterPrompt() : this.syncAi()),
            () => this.syncAi()
        );
    }

    resumeCard(): void {
        resumeCardFor(this);
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

    /* ── 词书管理（多词书，redesign §五；操作在 flow/BookOps） ── */

    switchBook(id: string): void {
        void switchBookFor(this, id);
    }

    removeBook(id: string): void {
        void removeBookFor(this, id);
    }

    importBook(file: File, input: HTMLInputElement): void {
        void importBookFor(this, file, input);
    }

    /** 把 AI runner 的普通字段镜像进响应态（按钮/消息渲染读镜像）。 */
    syncAi(): void {
        this.ui.aiRunning = this.ai.running;
        this.ui.aiMsg = this.ai.msg;
        this.ui.aiPending = this.ui.progress ? this.ai.pending(this.ui.progress).length : 0;
    }
}
