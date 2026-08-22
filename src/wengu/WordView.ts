import {defaultAgentModelId} from "./AgentClient";
import {svgIcon} from "./FormHtml";
import {
    esc,
    fmt,
} from "./ui";
import {
    analyzeMistakes,
    type WordAiInput,
} from "./WordAi";
import WORD_BOOK from "./WordBook";
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
    applyAiPlan,
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
    private mode: "card" | "setstart" | "done" = "card";
    private busy = false;
    /** 误认词 AI 分析进行中/结果消息（重渲染时展示）。 */
    private aiRunning = false;
    private aiMsg = "";

    constructor(
        element: HTMLElement,
        i18n: Record<string, string>,
        store: WordStore,
    ) {
        this.el = element;
        this.t = (k) => i18n[k] ?? k;
        this.store = store;
    }

    async render(): Promise<void> {
        this.progress = await this.store.get();
        const started = this.progress.cursor > 0 || Object.keys(this.progress.words).length > 0;
        this.mode = started ? "card" : "setstart";
        if (this.mode === "card") this.rebuildQueue();
        this.paint();
    }

    destroy(): void {
        this.el.innerHTML = "";
    }

    private rebuildQueue(): void {
        const p = this.progress;
        if (!p) return;
        const {review, fresh} = buildQueue(p);
        this.queue = [...review, ...fresh];
        this.sessionNew = new Set(fresh);
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
        if (this.pos >= this.queue.length) {
            this.mode = "done";
            this.paintDone();
            return;
        }
        this.paintCard();
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
  <div class="wengu-word-head">
    <span class="wengu-word-title">${esc(WORD_BOOK.title)}</span>
    <span class="wengu-word-stats">${
            esc(fmt(this.t("wordTodayStats"), {
                a: String(p.today.newCount),
                b: String(p.today.revCount),
                c: String(total - this.pos),
                d: String(dueTomorrowCount(p)),
            }))
        }</span>${badge}
    <span class="fn__flex-1"></span>
    ${this.aiButtonHtml()}
    <button class="b3-button b3-button--icon" data-act="setstart" title="${esc(this.t("wordSetStart"))}">${
            svgIcon("iconSettings")
        }</button>
  </div>
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

    // ---------- 误认词 AI ----------

    private pendingMistakes(): WordAiInput[] {
        const p = this.progress!;
        const out: WordAiInput[] = [];
        for (const key of Object.keys(p.mistakes)) {
            const m = p.mistakes[key];
            if (m.note) continue;
            const entry = WORD_BOOK.words[Number(key)];
            if (entry) out.push({index: Number(key), w: entry.w, m: entry.m, count: m.count});
        }
        return out;
    }

    private aiButtonHtml(): string {
        const n = this.pendingMistakes().length;
        const title = this.aiRunning ?
            this.t("wordAiRunning") :
            n > 0 ?
            fmt(this.t("wordAiPending"), {n: String(n)}) :
            this.t("wordAiNone");
        return `<button class="b3-button b3-button--icon${
            n === 0 && !this.aiRunning ? " fn__none" : ""
        }" data-act="aianalyze" title="${esc(title)}"${this.aiRunning ? " disabled" : ""}>${
            svgIcon("iconSparkles")
        }</button>`;
    }

    private aiMsgHtml(): string {
        if (!this.aiRunning && !this.aiMsg) return "";
        const text = this.aiRunning ? this.t("wordAiRunning") : this.aiMsg;
        const err = this.aiMsg && !this.aiRunning && this.aiMsg.startsWith("!") ?
            " wengu-word-ai-err" :
            "";
        return `<div class="wengu-word-aimsg${err}">${esc(text.replace(/^!/, ""))}</div>`;
    }

    private async runAiAnalyze(): Promise<void> {
        if (this.aiRunning || !this.progress) return;
        const pending = this.pendingMistakes();
        if (pending.length === 0) {
            this.aiMsg = this.t("wordAiNone");
            this.paint();
            return;
        }
        this.aiRunning = true;
        this.aiMsg = "";
        this.paint();
        try {
            const items = await analyzeMistakes(pending, defaultAgentModelId());
            applyAiPlan(this.progress, items);
            await this.store.save(this.progress);
            this.aiMsg = items.length > 0 ?
                fmt(this.t("wordAiDone"), {n: String(items.length)}) :
                this.t("wordAiFailed") + this.t("wordAiBadReply");
            this.rebuildQueue();
            this.mode = "card";
        } catch (e) {
            this.aiMsg = "!" + this.t("wordAiFailed") + String((e as Error)?.message ?? e).slice(0, 120);
        }
        this.aiRunning = false;
        this.paint();
    }

    // ---------- 完成 ----------

    private paintDone(): void {
        const p = this.progress!;
        this.el.innerHTML = `<div class="wengu-word">
  <div class="wengu-word-head">
    <span class="wengu-word-title">${esc(WORD_BOOK.title)}</span>
    <span class="fn__flex-1"></span>
    ${this.aiButtonHtml()}
    <button class="b3-button b3-button--icon" data-act="setstart" title="${esc(this.t("wordSetStart"))}">${
            svgIcon("iconSettings")
        }</button>
  </div>
  ${this.aiMsgHtml()}
  <div class="wengu-word-card wengu-word-done">
    <div class="wengu-word-text">${esc(this.t("wordDoneTitle"))}</div>
    <div class="wengu-word-meaning wengu-word-revealed">${
            esc(fmt(this.t("wordDoneBody"), {
                a: String(p.today.newCount),
                b: String(p.today.revCount),
            }))
        }</div>
    <div class="wengu-word-actions">
      <button class="b3-button b3-button--outline" data-act="redohard" ${
            this.hardList.length === 0 ? " disabled" : ""
        }>${esc(fmt(this.t("wordRedoHard"), {n: String(this.hardList.length)}))}</button>
    </div>
  </div>
</div>`;
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
        this.rebuildQueue();
        this.mode = "card";
        this.paint();
    }
    private cancelStart(): void {
        this.mode = "card";
        this.rebuildQueue();
        this.paint();
    }

    // ---------- 事件 ----------

    bind(): void {
        this.el.addEventListener("click", (ev) => {
            const target = ev.target as HTMLElement;
            const optBtn = target.closest<HTMLElement>("[data-opt]");
            if (optBtn && !this.answered) {
                const no = parseInt(optBtn.dataset.opt ?? "0", 10);
                const texts = this.cardMode === "choiceEn" ?
                    buildMeaningOptions(this.currentIdx) :
                    buildWordOptions(this.currentIdx);
                const correct = this.cardMode === "choiceEn" ?
                    meaningLine(this.currentIdx) :
                    WORD_BOOK.words[this.currentIdx].w;
                this.answerObjective(texts[no] === correct, no);
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
                    void this.runAiAnalyze();
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
                    const no = parseInt(ev.code.slice(5), 10) - 1;
                    const texts = this.cardMode === "choiceEn" ?
                        buildMeaningOptions(this.currentIdx) :
                        buildWordOptions(this.currentIdx);
                    if (texts[no] !== undefined) {
                        const correct = this.cardMode === "choiceEn" ?
                            meaningLine(this.currentIdx) :
                            WORD_BOOK.words[this.currentIdx].w;
                        this.answerObjective(texts[no] === correct, no);
                    }
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
