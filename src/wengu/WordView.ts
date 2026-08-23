import {svgIcon} from "./FormHtml";
import {
    esc,
    fmt,
} from "./ui";
import {WordAiRunner} from "./WordAi";
import {bindWordEvents} from "./WordBind";
import WORD_BOOK from "./WordBook";
import {
    renderAskReview,
    renderCardHead,
    renderWordDone,
    renderWordHead,
    renderWordHome,
} from "./WordHome";
import {
    checkOption,
    checkSpell,
    buildMeaningOptions,
    buildWordOptions,
    renderCard,
    type AnsweredState,
    type WordCardMode,
} from "./WordQuiz";
import {
    renderWordStart,
    WordStartCtl,
} from "./WordStart";
import {renderWordStats} from "./WordStats";
import {
    applyGrade,
    buildQueue,
    buildStats,
    dueTomorrowCount,
    markFamiliar,
    rollToday,
    starredList,
    toggleStar,
    WordStore,
    type WordGrade,
    type WenguWordProgress,
} from "./WordStore";

/** 复习题型轮换（新词走 learn 学习卡，不在此列）。 */
const REVIEW_MODES: WordCardMode[] = ["choiceEn", "recallEn", "choiceZh", "spell", "recallZh"];
/** 答错后隔几张卡重现（仿不背单词组内重现）。 */
const REINSERT_GAP = 3;

/**
 * 单词复习视图（Dock/页签同挂载），仿不背单词：新词先学后测、五题型
 * 轮换、题面即时标色、错词隔卡重现；误认可自述「认成了什么」交 AI
 * 辨析；熟/星标随时标记。渲染拆 WordQuiz/WordHome/WordStats，事件拆
 * WordBind，AI 胶水在 WordAi.runner。
 */
export class WordView {
    readonly t: (key: string) => string;
    private readonly el: HTMLElement;
    private readonly store: WordStore;
    private progress: WenguWordProgress | undefined;
    /** 本会话队列（扁平下标）。 */
    private queue: number[] = [];
    private pos = 0;
    /** 提示页/翻面结果（learn、recall 用）。 */
    private phase: "prompt" | "result" = "prompt";
    /** 当前卡模式。 */
    private cardMode: WordCardMode = "learn";
    private cardSeq = 0;
    /** 客观题作答态（choiceEn/choiceZh/spell）。 */
    private answered: AnsweredState | undefined;
    /** 本会话已出过学习卡的词（学过一遍就不再 learn）。 */
    private learned = new Set<number>();
    /** 构队时标记的新词（首次作答计入今日新词数）。 */
    private sessionNew = new Set<number>();
    /** 本会话答错过的词（去重），完成后可一键重过。 */
    private hardList: number[] = [];
    private mode: "home" | "askreview" | "stats" | "card" | "setstart" | "done" = "home";
    /** 当前会话队列种类(入口决定)。 */
    private queueKind: "review" | "fresh" | "star" = "fresh";
    private busy = false;
    /** 误认词 AI 视图胶水。 */
    private readonly ai: WordAiRunner;

    constructor(
        element: HTMLElement,
        i18n: Record<string, string>,
        store: WordStore,
    ) {
        this.el = element;
        this.t = (k) => i18n[k] ?? k;
        this.store = store;
        this.ai = new WordAiRunner(this.t);
    }

    async render(): Promise<void> {
        this.progress = await this.store.get();
        const started = this.progress.cursor > 0 || Object.keys(this.progress.words).length > 0;
        this.mode = started ? "home" : "setstart";
        this.paint();
    }

    destroy(): void {
        this.el.innerHTML = "";
    }

    /** 当前首页视角的队列构成（进入入口前统算一次）。 */
    /** 按入口建队列：review=到期复习 / fresh=新学 / star=星标。 */
    private rebuildQueue(kind: "review" | "fresh" | "star"): void {
        const p = this.progress;
        if (!p) return;
        if (kind === "star") {
            this.queue = starredList(p);
            this.sessionNew = new Set<number>();
            this.queueKind = kind;
            this.pos = 0;
            this.hardList = [];
            this.enterPrompt();
            return;
        }
        const {review, fresh} = buildQueue(p);
        if (kind === "review") {
            this.queue = [...review];
            this.sessionNew = new Set<number>();
        } else {
            this.queue = [...fresh];
            this.sessionNew = new Set(fresh);
        }
        this.queueKind = kind;
        this.pos = 0;
        this.hardList = [];
        this.enterPrompt();
    }

    /** 进入当前位置的卡：新词（本会话未学过且无历史状态）→ learn，否则题型轮换。 */
    private enterPrompt(): void {
        this.phase = "prompt";
        this.answered = undefined;
        const idx = this.currentIdx;
        const isNew = this.sessionNew.has(idx) && !this.learned.has(idx);
        if (isNew) {
            this.cardMode = "learn";
        } else {
            this.cardMode = REVIEW_MODES[this.cardSeq % REVIEW_MODES.length];
            if (this.cardMode === "choiceEn" && buildMeaningOptions(idx).length < 4) {
                this.cardMode = "recallEn";
            } else if (this.cardMode === "choiceZh" && buildWordOptions(idx).length < 4) {
                this.cardMode = "recallZh";
            } else if (this.cardMode === "spell") {
                const w = WORD_BOOK.words[idx].w;
                if (w.includes(" ") || w.length > 14) this.cardMode = "recallZh";
            }
        }
    }

    private get currentIdx(): number {
        return this.queue[this.pos] ?? 0;
    }

    private paint(): void {
        if (!this.progress) return;
        // 隔夜不关：每次重绘先翻转今日统计
        rollToday(this.progress);
        if (this.mode === "setstart") {
            this.paintStartPanel();
            return;
        }
        if (this.mode === "stats") {
            this.paintStats();
            return;
        }
        if (this.mode === "home" || this.mode === "askreview") {
            this.paintHome();
            return;
        }
        if (this.pos >= this.queue.length) {
            this.mode = "done";
            this.paintDone();
            return;
        }
        this.paintCard();
    }

    // ---------- 首页/先复习确认/统计 ----------

    private statsBtnHtml(): string {
        return `<button class="b3-button b3-button--icon" data-act="stats" title="${esc(this.t("wordStatsTitle"))}">${
            svgIcon("iconInfo")
        }</button>`;
    }

    private paintStats(): void {
        this.el.innerHTML = renderWordStats(
            this.t,
            buildStats(this.progress!),
            renderWordHead(this.t, this.ai.buttonHtml(this.progress!)),
        );
    }

    private paintHome(): void {
        const {review, fresh} = buildQueue(this.progress!);
        if (this.mode === "askreview") {
            this.el.innerHTML = renderAskReview(
                this.t,
                review.length,
                renderWordHead(this.t, this.statsBtnHtml() + this.ai.buttonHtml(this.progress!)),
            );
            return;
        }
        this.el.innerHTML = renderWordHome(
            this.t,
            review.length,
            fresh.length,
            renderWordHead(this.t, this.statsBtnHtml() + this.ai.buttonHtml(this.progress!)),
            this.ai.msgHtml(),
            starredList(this.progress!).length,
        );
    }

    // ---------- 卡片 ----------

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
                this.ai.buttonHtml(this.progress!),
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
        this.applyAnswered(checkOption(this.cardMode, this.currentIdx, no));
    }

    private submitSpell(): void {
        if (this.cardMode === "spell") this.applyAnswered(checkSpell(this.el, this.currentIdx));
    }

    /** 客观题作答落位：题面内标色 + 详情 + 继续按钮（评分延迟到收尾）。 */
    private applyAnswered(a: AnsweredState | undefined): void {
        if (!a || this.phase !== "prompt" || this.answered) return;
        this.answered = a;
        this.paint();
    }

    /** 收尾：应用档位并进下一张；答错的词隔 3 张重现直到当场过关。 */
    private finishCard(grade: WordGrade): void {
        const awaitingGrade = this.phase === "result" || this.answered;
        if (!awaitingGrade || this.busy || !this.progress) return;
        this.busy = true;
        const p = this.progress;
        const idx = this.currentIdx;
        applyGrade(p, idx, grade, this.sessionNew.has(idx));
        if (grade === "no") {
            // 误认自述：结果页输入框里的「认成了什么」回填，交 AI 辨析
            const conf = this.el.querySelector<HTMLInputElement>("[data-field='confessed']");
            const v = conf?.value.trim();
            if (v) p.mistakes[String(idx)].confused = v;
        }
        this.advanceAfterFinish(grade, idx);
    }

    /** 标「熟」收尾：退出复习循环，不进误认/重现。 */
    private finishMastered(): void {
        const awaiting = this.phase === "result" || this.answered;
        if (!awaiting || this.busy || !this.progress) return;
        this.busy = true;
        const idx = this.currentIdx;
        markFamiliar(this.progress, idx, this.sessionNew.has(idx));
        this.advanceAfterFinish("easy", idx);
    }

    /** 星标开关（任意卡、任意阶段可点）。 */
    private toggleStarCard(): void {
        if (!this.progress || this.mode !== "card") return;
        toggleStar(this.progress, this.currentIdx);
        void this.store.save(this.progress);
        this.paint();
    }

    /** finishCard/finishMastered 公共推进。 */
    private advanceAfterFinish(grade: WordGrade, idx: number): void {
        const p = this.progress!;
        if (this.cardMode === "learn") this.learned.add(idx);
        if (grade === "no") {
            if (!this.hardList.includes(idx)) this.hardList.push(idx);
            // 会话内重现：插到 3 张卡之后（到末尾则接着出）
            this.queue.splice(Math.min(this.pos + 1 + REINSERT_GAP, this.queue.length), 0, idx);
        }
        void this.store.save(p);
        this.pos++;
        this.cardSeq++;
        this.enterPrompt();
        this.busy = false;
        this.paint();
    }

    // ---------- 完成 ----------

    private paintDone(): void {
        const p = this.progress!;
        this.el.innerHTML = renderWordDone(
            this.t,
            this.queueKind,
            p.today.newCount,
            p.today.revCount,
            this.hardList.length,
            renderWordHead(this.t, this.ai.buttonHtml(this.progress!)),
            this.ai.msgHtml(),
        );
    }

    private redoHard(): void {
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

    private startCtlCache?: WordStartCtl;

    private startCtl(): WordStartCtl {
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

    // ---------- 事件 ----------

    bind(): void {
        bindWordEvents(this.el, {
            state: () => ({
                mode: this.mode,
                phase: this.phase,
                cardMode: this.cardMode,
                answered: this.answered !== undefined,
                answeredCorrect: this.answered?.correct,
            }),
            option: (no) => {
                if (!this.answered) this.answerByOption(no);
            },
            grade: (g) => this.finishCard(g),
            reveal: () => {
                if (
                    this.phase === "prompt" && this.cardMode !== "choiceEn" &&
                    this.cardMode !== "choiceZh" && this.cardMode !== "spell"
                ) {
                    this.phase = "result";
                    this.paint();
                }
            },
            submitSpell: () => this.submitSpell(),
            confessEnter: () => this.finishCard("no"),
            continueObjective: () => this.finishCard(this.answered?.correct ? "know" : "no"),
            importFile: (file, input) => void this.startCtl().importFile(file, input),
            act: (name) => this.dispatchAct(name),
        });
    }

    /** data-act 动作分发（绑定细节在 WordBind）。 */
    private dispatchAct(name: string): void {
        switch (name) {
            case "goreview":
                this.mode = "card";
                this.rebuildQueue("review");
                this.paint();
                break;
            case "gofresh": {
                const {review} = buildQueue(this.progress!);
                if (review.length > 0) {
                    this.mode = "askreview"; // 有到期复习 → 先弹「先复习」
                } else {
                    this.mode = "card";
                    this.rebuildQueue("fresh");
                }
                this.paint();
                break;
            }
            case "gofreshanyway":
                this.mode = "card";
                this.rebuildQueue("fresh");
                this.paint();
                break;
            case "gostar":
                this.mode = "card";
                this.rebuildQueue("star");
                this.paint();
                break;
            case "mastered":
                this.finishMastered();
                break;
            case "star":
                this.toggleStarCard();
                break;
            case "stats":
                this.mode = "stats";
                this.paint();
                break;
            case "home":
                this.mode = "home";
                this.paint();
                break;
            case "showanswer":
                if (this.phase === "prompt") {
                    this.phase = "result";
                    this.paint();
                }
                break;
            case "submit":
                this.submitSpell();
                break;
            case "next":
                this.finishCard(this.answered?.correct ? "know" : "no");
                break;
            case "markwrong":
                this.finishCard("no");
                break;
            case "setstart":
                this.mode = "setstart";
                this.paint();
                break;
            case "applystart":
                this.startCtl().apply();
                this.mode = "home";
                this.paint();
                break;
            case "cancelset":
                this.mode = "home";
                this.paint();
                break;
            case "redohard":
                this.redoHard();
                break;
            case "aianalyze":
                if (this.progress) {
                    void this.ai.run(
                        this.progress,
                        () => this.store.save(this.progress!),
                        () => {
                            this.mode = "home";
                        },
                        () => this.paint(),
                    );
                }
                break;
        }
    }
}
