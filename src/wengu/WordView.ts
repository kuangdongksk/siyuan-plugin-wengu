import {defaultAgentModelId} from "./AgentClient";
import {
    formGroup,
    formOption,
    formRow,
    formSelect,
    svgIcon,
} from "./FormHtml";
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
    buildChoiceOptions,
    choiceFeedback,
    gradeButtons,
    renderPrompt,
    renderResult,
    type WordCardMode,
} from "./WordQuiz";
import {
    applyAiPlan,
    applyGrade,
    buildQueue,
    dueTomorrowCount,
    todayKey,
    unitOf,
    WordStore,
    type WordGrade,
    type WenguWordProgress,
} from "./WordStore";

/**
 * 单词复习视图（Dock 面板/页签同款挂载）：不背单词式流程。
 *
 * 每张卡两段：提示页（三模式轮换：看词选义/看英回想/看中回想）→
 * 结果页（单词+释义+AI 提示；回想模式给三档自评，选择题给
 * 下一个/记错了）。答「不认识」累计误认本，可交给 AI 分析重排。
 */
export class WordView {
    readonly t: (key: string) => string;
    private readonly el: HTMLElement;
    private readonly store: WordStore;
    private progress: WenguWordProgress | undefined;
    /** 本会话队列（扁平下标）。 */
    private queue: number[] = [];
    private pos = 0;
    /** 提示页/结果页。 */
    private phase: "prompt" | "result" = "prompt";
    /** 当前卡模式（轮换）。 */
    private cardMode: WordCardMode = "choice";
    private cardSeq = 0;
    /** 选择题作答状态。 */
    private chosenCorrect = false;
    private chosenDone = false;
    /** 构队时标记的新词（首次作答计入今日新词数）。 */
    private sessionNew = new Set<number>();
    /** 本会话评过「不认识」的词，完成后可一键重过。 */
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

    /** 进入当前位置的提示页（模式轮换：选义/看英/看中）。 */
    private enterPrompt(): void {
        this.phase = "prompt";
        this.chosenDone = false;
        this.cardMode = (["choice", "recallEn", "recallZh"] as WordCardMode[])[this.cardSeq % 3];
        // 释义太短凑不齐选项时退回想
        if (this.cardMode === "choice" && buildChoiceOptions(this.currentIdx).length < 4) {
            this.cardMode = "recallEn";
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
        let body: string;
        if (this.phase === "prompt") {
            body = renderPrompt(this.cardMode, idx, this.t);
        } else {
            const actions = this.cardMode === "choice" ?
                `<button class="b3-button b3-button--outline" data-act="next">${esc(this.t("wordNext"))}</button>
      <button class="b3-button b3-button--cancel" data-act="markwrong">${esc(this.t("wordMarkWrong"))}</button>` :
                gradeButtons(this.t);
            const feedback = this.cardMode === "choice" && this.chosenDone ?
                choiceFeedback(this.chosenCorrect, idx, this.t) :
                "";
            body = renderResult(idx, this.t, mistake?.note, actions, feedback);
        }
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
  ${body}
  <div class="b3-progress__bar"><span style="width:${pct}%"></span></div>
</div>`;
        this.el.querySelector<HTMLElement>(".wengu-word-card")?.focus();
    }

    /** 选择题点选项：判对错进结果页（评分延迟到收尾按钮）。 */
    private pickOption(no: number): void {
        if (this.phase !== "prompt" || this.cardMode !== "choice") return;
        const hit = buildChoiceOptions(this.currentIdx)[no];
        if (!hit) return;
        this.chosenCorrect = hit.correct;
        this.chosenDone = true;
        this.phase = "result";
        this.paint();
    }

    /** 收尾：应用档位并进下一张（choice: next=对→know/错→no; markwrong→no）。 */
    private finishCard(grade: WordGrade): void {
        if (this.phase !== "result" || this.busy || !this.progress) return;
        this.busy = true;
        const p = this.progress;
        const idx = this.currentIdx;
        applyGrade(p, idx, grade, this.sessionNew.has(idx));
        if (grade === "no") this.hardList.push(idx);
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
        const p = this.progress!;
        const cur = p.cursor > 0 ? p.cursor : 0;
        const curUnit = unitOf(cur)?.u ?? 1;
        const unitOptions = WORD_BOOK.units.map((u) =>
            formOption(String(u.u), fmt(this.t("wordUnitOpt"), {n: String(u.u), c: String(u.count)}), u.u === curUnit)
        ).join("");
        this.el.innerHTML = `<div class="wengu-word">
  <div class="wengu-word-head">
    <span class="wengu-word-title">${esc(WORD_BOOK.title)}</span>
  </div>
  <div class="wengu-word-form">
    ${
            formGroup(
                this.t("wordSetStart"),
                formRow(this.t("wordStartUnit"), this.t("wordStartUnitDesc"), formSelect("unit", unitOptions)),
            )
        }
    <div class="wengu-word-form-tip">${esc(this.t("wordResetWarn"))}</div>
    <div class="wengu-word-form-actions">
      ${
            p.cursor > 0 || Object.keys(p.words).length > 0 ?
                `<button class="b3-button b3-button--cancel" data-act="cancelset">${esc(this.t("cancel"))}</button>` :
                ""
        }
      <button class="b3-button b3-button--outline" data-act="applystart">${esc(this.t("wordApply"))}</button>
    </div>
  </div>
</div>`;
    }

    private applyStart(): void {
        const p = this.progress!;
        const unitSel = this.el.querySelector<HTMLSelectElement>('[data-field="unit"]');
        const unitNo = parseInt(unitSel?.value ?? "1", 10);
        const unit = WORD_BOOK.units.find((u) => u.u === unitNo);
        if (unit) {
            p.cursor = unit.start;
            for (const key of Object.keys(p.words)) {
                if (Number(key) >= unit.start) delete p.words[key];
            }
            p.today = {key: todayKey(), newCount: 0, revCount: 0};
        }
        void this.store.save(p);
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
            if (optBtn) {
                this.pickOption(parseInt(optBtn.dataset.opt ?? "0", 10));
                return;
            }
            const gradeBtn = target.closest<HTMLElement>("[data-grade]");
            if (gradeBtn) {
                this.finishCard((gradeBtn.dataset.grade as WordGrade) ?? "know");
                return;
            }
            const actBtn = target.closest<HTMLElement>("[data-act]");
            if (!actBtn) return;
            switch (actBtn.dataset.act) {
                case "showanswer":
                    if (this.phase === "prompt") {
                        this.phase = "result";
                        this.paint();
                    }
                    break;
                case "next":
                    this.finishCard(this.chosenCorrect ? "know" : "no");
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
            if (this.phase === "prompt") {
                if (ev.code === "Space") {
                    if (this.cardMode !== "choice") {
                        ev.preventDefault();
                        this.phase = "result";
                        this.paint();
                    }
                    return;
                }
                if (this.cardMode === "choice" && /^Digit[1-4]$/.test(ev.code)) {
                    ev.preventDefault();
                    this.pickOption(parseInt(ev.code.slice(5), 10) - 1);
                }
                return;
            }
            // 结果页：回想模式 1/2/3 自评；选择题空格/回车=下一个
            if (this.cardMode !== "choice") {
                const map: Record<string, WordGrade> = {Digit1: "no", Digit2: "fuzzy", Digit3: "know"};
                const g = map[ev.code];
                if (g) {
                    ev.preventDefault();
                    this.finishCard(g);
                }
            } else if (ev.code === "Space" || ev.code === "Enter") {
                ev.preventDefault();
                this.finishCard(this.chosenCorrect ? "know" : "no");
            }
        });
    }
}
