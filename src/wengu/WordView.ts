import {svgIcon} from "./FormHtml";
import {
    esc,
    fmt,
} from "./ui";
import {dispatchWordAct} from "./WordActs";
import {
    WordAiRunner,
    wordAiInput,
    type WordAiInput,
} from "./WordAi";
import {
    bindWordEvents,
    type WordBindState,
} from "./WordBind";
import {
    addPair,
    confOthers,
    confusableHtml,
    wordNoteHtml,
} from "./WordConfusables";
import {
    paintDoneInto,
    paintHomeInto,
    paintStatsInto,
    renderCardHead,
} from "./WordHome";
import {
    LookupConfCtl,
    paintLookupInto,
} from "./WordLookup";
import {
    checkOption,
    checkSpell,
    pickMode,
    renderCard,
    type AnsweredState,
    type WordCardMode,
} from "./WordQuiz";
import {
    renderWordStart,
    WordStartCtl,
} from "./WordStart";
import {
    applyGrade,
    buildQueue,
    dueTomorrowCount,
    groupSizeOf,
    markFamiliar,
    pushTiming,
    rollToday,
    starredList,
    toggleStar,
    WordStore,
    type WenguTimingRec,
    type WenguWordProgress,
    type WordGrade,
} from "./WordStore";
import {
    rebuildTail,
    WordTimer,
} from "./WordTiming";

/** 答错后隔几张卡重现（仿不背单词组内重现）。 */
const REINSERT_GAP = 3;

/**
 * 单词复习视图（Dock/页签同挂载），仿不背单词：新词先学后测、五题型
 * 轮换、题面即时标色、错词隔卡重现。作答计时与组机制见
 * docs/word-timing.md（计时只累计可见且非输入的时间，组完成异步
 * 触发 AI 复盘不阻塞）；渲染拆 WordQuiz/WordHome/WordStats/
 * WordLookup，事件拆 WordBind，AI 胶水在 WordAi。
 */
export class WordView {
    readonly t: (key: string) => string;
    private readonly el: HTMLElement;
    readonly store: WordStore;
    progress: WenguWordProgress | undefined;
    /** 本会话队列（扁平下标）。 */
    private queue: number[] = [];
    private pos = 0;
    /** 提示页/翻面结果（learn、recall 用）。 */
    phase: "prompt" | "result" = "prompt";
    /** 当前卡模式。 */
    private cardMode: WordCardMode = "learn";
    private cardSeq = 0;
    /** 客观题作答态（choiceEn/choiceZh/spell）。 */
    answered: AnsweredState | undefined;
    /** 本会话已出过学习卡的词（学过一遍就不再 learn）。 */
    private learned = new Set<number>();
    /** 构队时标记的新词（首次作答计入今日新词数）。 */
    private sessionNew = new Set<number>();
    /** 本会话答错过的词（去重），完成后可一键重过。 */
    hardList: number[] = [];
    mode: "home" | "askreview" | "stats" | "lookup" | "card" | "setstart" | "done" = "home";
    /** 查词状态（非答题期间可用）。 */
    private lookupQuery = "";
    lookupSel: number | undefined;
    /** 当前会话队列种类(入口决定)。 */
    private queueKind: "review" | "fresh" | "star" = "fresh";
    private busy = false;
    /** 误认词 AI 视图胶水。 */
    readonly ai: WordAiRunner;
    /* ── 计时与组机制（docs/word-timing.md） ── */
    private readonly timer: WordTimer;
    /** 当前卡计时结算（reveal/作答时存，finishCard 消费）。 */
    private curTiming: WenguTimingRec | undefined;
    /** spell 错拼原文（作答瞬间抓取，重渲染后输入框即消失）。 */
    private spellTyped: string | undefined;
    /** 当前卡易混组其它词快照（干扰项渲染/判定同源）。 */
    private confIds: number[] = [];
    /** 本组作答画像（组完成时交 AI，一步继续不等待）。 */
    private groupLog: WordAiInput[] = [];
    private finishCount = 0;
    private readonly doneSet = new Set<number>();
    /** AI 复盘已落盘待消费（下个组边界重排队列余量）。 */
    private aiDirty = false;
    /** 查词详情的易混笔记控制器。 */
    readonly confCtl: LookupConfCtl;

    constructor(
        element: HTMLElement,
        i18n: Record<string, string>,
        store: WordStore,
    ) {
        this.el = element;
        this.t = (k) => i18n[k] ?? k;
        this.store = store;
        this.ai = new WordAiRunner(this.t);
        this.timer = new WordTimer(element);
        this.confCtl = new LookupConfCtl(
            () => this.progress!,
            (p) => this.store.save(p),
            () => this.paint(),
        );
    }

    async render(): Promise<void> {
        this.progress = await this.store.get();
        const started = this.progress.cursor > 0 || Object.keys(this.progress.words).length > 0;
        this.mode = started ? "home" : "setstart";
        this.paint();
    }

    destroy(): void {
        this.timer.dispose();
        this.el.innerHTML = "";
    }

    /** 按入口建队列：review=到期复习 / fresh=新学 / star=星标。 */
    rebuildQueue(kind: "review" | "fresh" | "star"): void {
        const p = this.progress;
        if (!p) return;
        if (kind === "star") {
            this.queue = starredList(p);
            this.sessionNew = new Set<number>();
        } else {
            const {review, fresh} = buildQueue(p);
            this.queue = kind === "review" ? [...review] : [...fresh];
            this.sessionNew = kind === "review" ? new Set<number>() : new Set(fresh);
        }
        this.queueKind = kind;
        this.pos = 0;
        this.hardList = [];
        this.doneSet.clear();
        this.groupLog = [];
        this.finishCount = 0;
        this.enterPrompt();
    }

    /** 进入当前位置的卡：新词 learn，否则题型轮换（选择在 WordQuiz.pickMode）。 */
    private enterPrompt(): void {
        this.phase = "prompt";
        this.answered = undefined;
        this.curTiming = undefined;
        this.spellTyped = undefined;
        const idx = this.currentIdx;
        this.confIds = confOthers(this.progress!, idx);
        this.cardMode = pickMode(this.cardSeq, idx, this.sessionNew.has(idx) && !this.learned.has(idx), this.confIds);
        this.timer.begin(this.cardMode);
    }

    private get currentIdx(): number {
        return this.queue[this.pos] ?? 0;
    }

    paint(): void {
        if (!this.progress) return;
        // 隔夜不关：每次重绘先翻转今日统计
        rollToday(this.progress);
        if (this.mode === "setstart") {
            this.paintStartPanel();
            return;
        }
        if (this.mode === "stats") {
            paintStatsInto(this.el, this.t, this.progress, this.ai);
            return;
        }
        if (this.mode === "lookup") {
            paintLookupInto(this.el, this.t, this.progress, this.lookupQuery, this.lookupSel, this.ai);
            return;
        }
        if (this.mode === "home" || this.mode === "askreview") {
            paintHomeInto(this.el, this.t, this.progress, this.mode === "askreview", this.ai);
            return;
        }
        if (this.pos >= this.queue.length) {
            this.mode = "done";
            this.flushGroup();
            paintDoneInto(this.el, this.t, this.progress, this.queueKind, this.hardList.length, this.ai);
            return;
        }
        this.paintCard();
    }

    private paintCard(): void {
        const p = this.progress!;
        const idx = this.currentIdx;
        const total = this.queue.length;
        const pct = total > 0 ? Math.round((this.pos / total) * 100) : 0;
        const mistake = p.mistakes[String(idx)];
        const badge = mistake ?
            `<span class="wengu-word-badge">${
                esc(fmt(this.t("wordMistakeBadge"), {n: String(mistake.count)}))
            }</span>` :
            "";
        const card = renderCard(this.cardMode, idx, this.t, {
            reveal: this.phase === "result",
            answered: this.answered,
            note: mistake?.note,
            confused: mistake?.confused,
            starred: !!p.starred[String(idx)],
            confIds: this.confIds,
            confHtml: wordNoteHtml(p, idx) + confusableHtml(this.t, p, idx),
        });
        this.el.innerHTML = `<div class="wengu-word">
  ${
            renderCardHead(
                this.t,
                fmt(this.t("wordTodayStats"), {
                    a: String(p.today.newCount),
                    b: String(p.today.revCount),
                    c: String(total - this.pos),
                    d: String(dueTomorrowCount(p)),
                }),
                badge,
                // 查词入口仅非答题态（已翻面/已作答）给
                (this.phase === "result" || this.answered ?
                    `<button class="b3-button b3-button--icon" data-act="lookup" title="${esc(this.t("wordLookup"))}">${
                        svgIcon("iconSearch")
                    }</button>` :
                    "") + this.ai.buttonHtml(p),
            )
        }
  ${this.ai.msgHtml()}
  ${card}
  <div class="b3-progress__bar"><span style="width:${pct}%"></span></div>
</div>`;
        if (this.cardMode === "spell" && this.phase === "prompt") {
            const input = this.el.querySelector<HTMLInputElement>("[data-field='spell']");
            input?.focus();
        } else {
            this.el.querySelector<HTMLElement>(".wengu-word-card")?.focus();
        }
    }

    /** 选择题作答(点击/数字键共用)。 */
    private answerByOption(no: number): void {
        if (this.cardMode !== "choiceEn" && this.cardMode !== "choiceZh") return;
        this.applyAnswered(checkOption(this.cardMode, this.currentIdx, no, this.confIds));
    }

    /** 客观题作答落位：题面内标色 + 详情 + 继续按钮（评分延迟到收尾）。 */
    private applyAnswered(a: AnsweredState | undefined): void {
        if (!a || this.phase !== "prompt" || this.answered) return;
        const s = this.timer.settle();
        if (s) this.curTiming = s;
        this.answered = a;
        this.paint();
    }

    /** 收尾：应用档位并进下一张；答错的词隔 3 张重现直到当场过关。 */
    finishCard(grade: WordGrade): void {
        const awaitingGrade = this.phase === "result" || this.answered;
        if (!awaitingGrade || this.busy || !this.progress) return;
        this.busy = true;
        const p = this.progress;
        const idx = this.currentIdx;
        // 自述「认成了什么」：填了即没记住（决策 7，不论点什么档位）
        const conf = this.el.querySelector<HTMLInputElement>("[data-field='confessed']");
        const v = conf?.value.trim();
        if (v) grade = "no";
        // 停留超时（走神）按「忘记」处理（决策 2）
        if (this.curTiming?.over) grade = "no";
        applyGrade(p, idx, grade, this.sessionNew.has(idx));
        if (v) {
            p.mistakes[String(idx)].confused = v;
            addPair(p, idx, v, "evidence");
        }
        if (this.curTiming) {
            this.curTiming.typed = this.spellTyped;
            pushTiming(p, idx, this.curTiming);
        }
        this.groupLog.push(
            wordAiInput(p, idx, grade, this.answered?.correct, this.curTiming, this.spellTyped, v),
        );
        this.curTiming = undefined;
        this.spellTyped = undefined;
        this.advanceAfterFinish(grade, idx);
    }

    /** 标「熟」收尾：退出复习循环，不进误认/重现。 */
    finishMastered(): void {
        const awaiting = this.phase === "result" || this.answered;
        if (!awaiting || this.busy || !this.progress) return;
        this.busy = true;
        const idx = this.currentIdx;
        markFamiliar(this.progress, idx, this.sessionNew.has(idx));
        this.advanceAfterFinish("easy", idx);
    }

    /** 星标开关（任意卡、任意阶段可点）。 */
    toggleStarCard(): void {
        if (!this.progress || this.mode !== "card") return;
        toggleStar(this.progress, this.currentIdx);
        void this.store.save(this.progress);
        this.paint();
    }

    /** finishCard/finishMastered 公共推进 + 组边界（决策 3/6）。 */
    private advanceAfterFinish(grade: WordGrade, idx: number): void {
        const p = this.progress!;
        if (this.cardMode === "learn") this.learned.add(idx);
        if (grade === "no") {
            if (!this.hardList.includes(idx)) this.hardList.push(idx);
            // 会话内重现：插到 3 张卡之后（到末尾则接着出）
            this.queue.splice(Math.min(this.pos + 1 + REINSERT_GAP, this.queue.length), 0, idx);
        }
        void this.store.save(p);
        this.doneSet.add(idx);
        this.pos++;
        this.cardSeq++;
        this.finishCount++;
        if (this.finishCount % groupSizeOf(p) === 0) {
            const batch = this.groupLog;
            this.groupLog = [];
            if (this.aiDirty) {
                // AI 已落盘：本地即时重排余量，下一组吃到（不等待）
                this.aiDirty = false;
                const r = rebuildTail(
                    p,
                    this.queueKind,
                    this.queue,
                    this.pos,
                    this.hardList,
                    this.doneSet,
                    this.sessionNew,
                );
                this.queue = r.queue;
                for (const i of r.newcomers) this.sessionNew.add(i);
            }
            void this.ai.runGroup(batch, p, () => this.store.save(p), () => {
                this.aiDirty = true;
            });
        }
        this.enterPrompt();
        this.busy = false;
        this.paint();
    }

    /** 会话收尾：不满一组也把剩余画像交 AI（异步）。 */
    private flushGroup(): void {
        if (this.groupLog.length === 0 || !this.progress) return;
        const batch = this.groupLog;
        this.groupLog = [];
        void this.ai.runGroup(batch, this.progress, () => this.store.save(this.progress!), () => undefined);
    }

    redoHard(): void {
        if (this.hardList.length === 0) return;
        this.queue = [...this.hardList];
        this.hardList = [];
        this.pos = 0;
        this.sessionNew = new Set<number>();
        this.mode = "card";
        this.enterPrompt();
        this.paint();
    }

    // ---------- 起点设置（操作在 WordStartCtl） ----------

    startCtlCache?: WordStartCtl;

    startCtl(): WordStartCtl {
        this.startCtlCache ??= new WordStartCtl(
            this.el,
            this.t,
            () => this.progress!,
            (p) => this.store.save(p),
            () => this.paint(),
        );
        return this.startCtlCache;
    }

    private paintStartPanel(): void {
        this.el.innerHTML = renderWordStart(this.t, this.progress!, this.startCtl().msg);
    }

    // ---------- 事件（WordView 直接实现 WordBindHost，绑定细节在 WordBind） ----------

    bind(): void {
        bindWordEvents(this.el, this);
    }

    state(): WordBindState {
        return {
            mode: this.mode,
            phase: this.phase,
            cardMode: this.cardMode,
            answered: this.answered !== undefined,
            answeredCorrect: this.answered?.correct,
        };
    }

    option(no: number): void {
        if (!this.answered) this.answerByOption(no);
    }

    grade(g: WordGrade): void {
        this.finishCard(g);
    }

    reveal(): void {
        if (
            this.phase === "prompt" && this.cardMode !== "choiceEn" &&
            this.cardMode !== "choiceZh" && this.cardMode !== "spell"
        ) {
            const s = this.timer.settle();
            if (s) this.curTiming = s;
            this.phase = "result";
            this.paint();
        }
    }

    submitSpell(): void {
        if (this.cardMode === "spell") {
            const input = this.el.querySelector<HTMLInputElement>("[data-field='spell']");
            this.spellTyped = input?.value.trim() || undefined;
            this.applyAnswered(checkSpell(this.el, this.currentIdx));
        }
    }

    confessEnter(): void {
        this.finishCard("no");
    }

    continueObjective(): void {
        this.finishCard(this.answered?.correct ? "know" : "no");
    }

    importFile(file: File, input: HTMLInputElement): void {
        void this.startCtl().importFile(file, input);
    }

    lookupInput(value: string): void {
        this.lookupQuery = value;
        this.lookupSel = undefined;
        this.paint();
        const input = this.el.querySelector<HTMLInputElement>("[data-field='lookup']");
        if (input && document.activeElement !== input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }
    }

    confNoteInput(value: string): void {
        this.confCtl.draft = value;
    }

    wordNoteInput(value: string): void {
        this.confCtl.wordDraft = value;
    }

    /** data-act 动作分发在 WordActs（视图成员公开给 WordViewApi）。 */
    act(name: string, dataset: DOMStringMap): void {
        dispatchWordAct(this, name, dataset);
    }

    enterLookup(): void {
        this.lookupSel = undefined;
        this.mode = "lookup";
        this.paint();
    }

    lookupPick(idx: number): void {
        this.lookupSel = idx;
        this.paint();
    }
}
