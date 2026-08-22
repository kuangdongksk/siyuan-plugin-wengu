import {
    esc,
    fmt,
} from "./ui";
import {WordAiRunner} from "./WordAi";
import WORD_BOOK from "./WordBook";
import {
    renderAskReview,
    renderCardHead,
    renderWordDone,
    renderWordHead,
    renderWordHome,
} from "./WordHome";
import {
    buildMeaningOptions,
    meaningLine,
    buildWordOptions,
    renderCard,
    spellMatches,
    type AnsweredState,
    type WordCardMode,
} from "./WordQuiz";
import {
    applyWordStart,
    renderWordStart,
} from "./WordStart";
import {
    applyGrade,
    buildQueue,
    dueTomorrowCount,
    WordStore,
    type WordGrade,
    type WenguWordProgress,
} from "./WordStore";

/** 复习题型轮换（新词走 learn 学习卡，不在此列）。 */
const REVIEW_MODES: WordCardMode[] = ["choiceEn", "recallEn", "choiceZh", "spell", "recallZh"];
/** 答错后隔几张卡重现（仿不背单词组内重现）。 */
const REINSERT_GAP = 3;

/**
 * 单词复习视图（Dock 面板/页签同款挂载）：仿不背单词。
 *
 * 新词先学（learn 卡翻面看释义，四档含「太简单」）后测；复习题
 * 五种轮换（看词选义/看英回想/看义选词/拼写/看中回想）。客观题
 * 题面内即时标色 + 内嵌词详情 + 继续/记错了；答错的词隔 3 张卡
 * 重现直到当场过关。「不认识/记错了」累计误认本，可交 AI 分析重排。
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
    private mode: "home" | "askreview" | "card" | "setstart" | "done" = "home";
    /** 当前会话队列种类(入口决定)。 */
    private queueKind: "review" | "fresh" = "fresh";
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
    private queueParts(): {review: number[]; fresh: number[];} {
        return buildQueue(this.progress!);
    }

    /** 按入口建队列：review=到期复习 / fresh=新学。 */
    private rebuildQueue(kind: "review" | "fresh"): void {
        const p = this.progress;
        if (!p) return;
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
        if (this.mode === "setstart") {
            this.paintStartPanel();
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

    // ---------- 首页/先复习确认 ----------

    private paintHome(): void {
        const {review, fresh} = this.queueParts();
        if (this.mode === "askreview") {
            this.el.innerHTML = renderAskReview(this.t, review.length, renderWordHead(this.t, this.aiButtonHtml()));
            return;
        }
        this.el.innerHTML = renderWordHome(
            this.t,
            review.length,
            fresh.length,
            renderWordHead(this.t, this.aiButtonHtml()),
            this.aiMsgHtml(),
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
                this.aiButtonHtml(),
            )
        }
  ${this.aiMsgHtml()}
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

    /** 选择题作答(点击/数字键共用):按题面选项判定对错。 */
    private answerByOption(no: number): void {
        const texts = this.cardMode === "choiceEn" ?
            buildMeaningOptions(this.currentIdx) :
            buildWordOptions(this.currentIdx);
        if (texts[no] === undefined) return;
        const correct = this.cardMode === "choiceEn" ?
            meaningLine(this.currentIdx) :
            WORD_BOOK.words[this.currentIdx].w;
        this.answerObjective(texts[no] === correct, no);
    }

    /** 客观题作答：题面内标色 + 详情 + 继续按钮（评分延迟到收尾）。 */
    private answerObjective(correct: boolean, pick?: number): void {
        if (this.phase !== "prompt" || this.answered) return;
        if (this.cardMode !== "choiceEn" && this.cardMode !== "choiceZh" && this.cardMode !== "spell") return;
        this.answered = {correct, pick};
        this.paint();
    }

    private submitSpell(): void {
        if (this.cardMode !== "spell" || this.answered) return;
        const input = this.el.querySelector<HTMLInputElement>("[data-field='spell']");
        const v = input?.value ?? "";
        this.answerObjective(spellMatches(v, WORD_BOOK.words[this.currentIdx].w));
    }

    /** 收尾：应用档位并进下一张；答错的词隔 3 张重现直到当场过关。 */
    private finishCard(grade: WordGrade): void {
        const awaitingGrade = this.phase === "result" || this.answered;
        if (!awaitingGrade || this.busy || !this.progress) return;
        this.busy = true;
        const p = this.progress;
        const idx = this.currentIdx;
        applyGrade(p, idx, grade, this.sessionNew.has(idx));
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

    // ---------- 误认词 AI（逻辑在 WordAi.runner，这里只做视图接线） ----------

    private aiButtonHtml(): string {
        return this.ai.buttonHtml(this.progress!);
    }

    private aiMsgHtml(): string {
        return this.ai.msgHtml();
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
            renderWordHead(this.t, this.aiButtonHtml()),
            this.aiMsgHtml(),
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

    // ---------- 起点设置 ----------

    private paintStartPanel(): void {
        this.el.innerHTML = renderWordStart(this.t, this.progress!);
    }

    private applyStart(): void {
        const p = this.progress!;
        if (applyWordStart(this.el, p)) void this.store.save(p);
        this.mode = "home";
        this.paint();
    }
    private cancelStart(): void {
        this.mode = "home";
        this.paint();
    }

    // ---------- 事件 ----------

    bind(): void {
        this.el.addEventListener("click", (ev) => {
            const target = ev.target as HTMLElement;
            const optBtn = target.closest<HTMLElement>("[data-opt]");
            if (optBtn && !this.answered) {
                this.answerByOption(parseInt(optBtn.dataset.opt ?? "0", 10));
                return;
            }
            const gradeBtn = target.closest<HTMLElement>("[data-grade]");
            if (gradeBtn) {
                this.finishCard((gradeBtn.dataset.grade as WordGrade) ?? "know");
                return;
            }
            const actBtn = target.closest<HTMLElement>("[data-act]");
            if (!actBtn) {
                if (target.closest(".wengu-word-card")) {
                    // learn/recall 未翻面时点卡翻面
                    if (
                        this.phase === "prompt" && this.cardMode !== "choiceEn" &&
                        this.cardMode !== "choiceZh" && this.cardMode !== "spell"
                    ) {
                        this.phase = "result";
                        this.paint();
                    }
                }
                return;
            }
            switch (actBtn.dataset.act) {
                case "goreview":
                    this.mode = "card";
                    this.rebuildQueue("review");
                    this.paint();
                    break;
                case "gofresh": {
                    const {review} = this.queueParts();
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
                    this.applyStart();
                    break;
                case "cancelset":
                    this.cancelStart();
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
        });
        this.el.addEventListener("keydown", (ev) => {
            if (this.mode !== "card" || this.busy) return;
            const inInput = (ev.target as HTMLElement).tagName === "INPUT";
            if (this.phase === "prompt" && !this.answered) {
                if (inInput) {
                    if (ev.code === "Enter") {
                        ev.preventDefault();
                        this.submitSpell();
                    }
                    return;
                }
                if (ev.code === "Space") {
                    if (this.cardMode === "learn" || this.cardMode === "recallEn" || this.cardMode === "recallZh") {
                        ev.preventDefault();
                        this.phase = "result";
                        this.paint();
                    }
                    return;
                }
                if ((this.cardMode === "choiceEn" || this.cardMode === "choiceZh") && /^Digit[1-4]$/.test(ev.code)) {
                    ev.preventDefault();
                    this.answerByOption(parseInt(ev.code.slice(5), 10) - 1);
                }
                return;
            }
            // 答完待收尾：learn 四档(1-4)；recall 三档(1-3)；客观题空格/回车=继续
            if (inInput) return;
            const map: Record<string, WordGrade> = this.cardMode === "learn" ?
                {Digit1: "no", Digit2: "fuzzy", Digit3: "know", Digit4: "easy"} :
                {Digit1: "no", Digit2: "fuzzy", Digit3: "know"};
            const g = map[ev.code];
            if (g) {
                ev.preventDefault();
                this.finishCard(g);
            } else if (
                (this.cardMode === "choiceEn" || this.cardMode === "choiceZh" || this.cardMode === "spell") &&
                (ev.code === "Space" || ev.code === "Enter")
            ) {
                ev.preventDefault();
                this.finishCard(this.answered?.correct ? "know" : "no");
            }
        });
    }
}
