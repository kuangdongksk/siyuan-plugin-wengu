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
import WORD_BOOK from "./WordBook";
import {
    applyGrade,
    buildQueue,
    todayKey,
    unitOf,
    WordStore,
    type WordGrade,
    type WenguWordProgress,
} from "./WordStore";

/**
 * 单词复习页签视图：内置词书按书序过卡。
 *
 * 会话队列 = 到期复习词（书序，封顶 100）+ 今日剩余新词；
 * 翻面看释义后三档自评（不认识/模糊/认识），Leitner 档位定
 * 复习间隔（1/2/4/8/16/32 天，见 WordStore）。「不认识」的词
 * 会在本会话末尾再过一遍。起点设置可按单元重置进度。
 */
export class WordView {
    readonly t: (key: string) => string;
    private readonly el: HTMLElement;
    private readonly store: WordStore;
    private progress: WenguWordProgress | undefined;
    /** 本会话队列（扁平下标）。 */
    private queue: number[] = [];
    private pos = 0;
    private revealed = false;
    /** 构队时标记的新词（首次作答计入今日新词数）。 */
    private sessionNew = new Set<number>();
    /** 本会话评过「不认识」的词，完成后可一键重过。 */
    private hardList: number[] = [];
    private mode: "card" | "setstart" | "done" = "card";
    private busy = false;

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
        // 首次打开且未学过：直接进起点设置
        const started = this.progress.cursor > 0 || Object.keys(this.progress.words).length > 0;
        this.mode = started ? "card" : "setstart";
        if (this.mode === "card") this.rebuildQueue();
        this.paint();
    }

    destroy(): void {
        this.el.innerHTML = "";
    }

    /** 重建会话队列（开头与评完「不认识」重排时用）。 */
    private rebuildQueue(): void {
        const p = this.progress;
        if (!p) return;
        const {review, fresh} = buildQueue(p);
        this.queue = [...review, ...fresh];
        this.sessionNew = new Set(fresh);
        this.pos = 0;
        this.revealed = false;
        this.hardList = [];
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
        const idx = this.queue[this.pos];
        const entry = WORD_BOOK.words[idx];
        const unit = unitOf(idx);
        const doneCount = this.pos;
        const total = this.queue.length;
        const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
        const unitLabel = unit ? fmt(this.t("wordUnitLabel"), {n: String(unit.u)}) : "";
        this.el.innerHTML = `<div class="wengu-word">
  <div class="wengu-word-head">
    <span class="wengu-word-title">${esc(WORD_BOOK.title)}</span>
    <span class="wengu-word-stats">${
            esc(fmt(this.t("wordTodayStats"), {
                a: String(p.today.newCount),
                b: String(p.today.revCount),
                c: String(total - doneCount),
            }))
        }</span>
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--icon" data-act="setstart" title="${esc(this.t("wordSetStart"))}">${
            svgIcon("iconSettings")
        }</button>
  </div>
  <div class="wengu-word-card${this.revealed ? " wengu-word-revealed" : ""}" tabindex="0">
    <div class="wengu-word-unit">${esc(unitLabel)} · ${esc(fmt(this.t("wordIndexLabel"), {n: String(idx + 1)}))}</div>
    <div class="wengu-word-text">${esc(entry.w)}</div>
    <div class="wengu-word-meaning">${esc(entry.m)}</div>
    <div class="wengu-word-hint">${esc(this.t("wordRevealHint"))}</div>
    <div class="wengu-word-actions">
      <button class="b3-button b3-button--outline" data-grade="no">${esc(this.t("wordGradeNo"))}</button>
      <button class="b3-button b3-button--outline" data-grade="fuzzy">${esc(this.t("wordGradeFuzzy"))}</button>
      <button class="b3-button b3-button--outline" data-grade="know">${esc(this.t("wordGradeKnow"))}</button>
    </div>
  </div>
  <div class="b3-progress__bar"><span style="width:${pct}%"></span></div>
</div>`;
        const card = this.el.querySelector<HTMLElement>(".wengu-word-card");
        card?.focus();
    }

    private reveal(): void {
        if (this.revealed || this.mode !== "card") return;
        this.revealed = true;
        const card = this.el.querySelector(".wengu-word-card");
        card?.classList.add("wengu-word-revealed");
    }

    private grade(g: WordGrade): void {
        if (!this.revealed || this.busy || !this.progress) return;
        this.busy = true;
        const p = this.progress;
        const idx = this.queue[this.pos];
        const wasNew = this.sessionNew.has(idx);
        applyGrade(p, idx, g, wasNew);
        if (g === "no") this.hardList.push(idx);
        void this.store.save(p);
        this.pos++;
        this.revealed = false;
        this.busy = false;
        this.paint();
    }

    // ---------- 完成 ----------

    private paintDone(): void {
        const p = this.progress!;
        this.el.innerHTML = `<div class="wengu-word">
  <div class="wengu-word-head">
    <span class="wengu-word-title">${esc(WORD_BOOK.title)}</span>
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--icon" data-act="setstart" title="${esc(this.t("wordSetStart"))}">${
            svgIcon("iconSettings")
        }</button>
  </div>
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
        // 重过生词：仍按到期逻辑批改，但不再重复计今日次数之外的新词
        this.queue = [...this.hardList];
        this.hardList = [];
        this.pos = 0;
        this.revealed = false;
        this.sessionNew = new Set<number>();
        this.mode = "card";
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
        const dailyOptions = [10, 20, 30, 50].map((n) =>
            formOption(String(n), fmt(this.t("wordDailyN"), {n: String(n)}), n === p.dailyNew)
        ).join("");
        this.el.innerHTML = `<div class="wengu-word">
  <div class="wengu-word-head">
    <span class="wengu-word-title">${esc(WORD_BOOK.title)}</span>
  </div>
  <div class="wengu-word-form">
    ${
            formGroup(
                this.t("wordSetStart"),
                formRow(this.t("wordStartUnit"), this.t("wordStartUnitDesc"), formSelect("unit", unitOptions)) +
                    formRow(this.t("wordDailyNew"), this.t("wordDailyNewDesc"), formSelect("daily", dailyOptions)),
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
        const dailySel = this.el.querySelector<HTMLSelectElement>('[data-field="daily"]');
        const unitNo = parseInt(unitSel?.value ?? "1", 10);
        p.dailyNew = parseInt(dailySel?.value ?? "20", 10) || 20;
        const unit = WORD_BOOK.units.find((u) => u.u === unitNo);
        if (unit) {
            p.cursor = unit.start;
            // 重设起点 = 该单元起的进度清零重学
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

    /** 绑定一次性事件（容器上委托，重渲染不用重绑）。 */
    bind(): void {
        this.el.addEventListener("click", (ev) => {
            const target = ev.target as HTMLElement;
            const gradeBtn = target.closest<HTMLElement>("[data-grade]");
            if (gradeBtn) {
                this.grade((gradeBtn.dataset.grade as WordGrade) ?? "know");
                return;
            }
            const actBtn = target.closest<HTMLElement>("[data-act]");
            if (!actBtn) {
                if (target.closest(".wengu-word-card")) this.reveal();
                return;
            }
            switch (actBtn.dataset.act) {
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
            }
        });
        this.el.addEventListener("keydown", (ev) => {
            if (this.mode !== "card") return;
            if (ev.code === "Space") {
                ev.preventDefault();
                this.reveal();
                return;
            }
            if (!this.revealed) return;
            const map: Record<string, WordGrade> = {Digit1: "no", Digit2: "fuzzy", Digit3: "know"};
            const g = map[ev.code];
            if (g) {
                ev.preventDefault();
                this.grade(g);
            }
        });
    }
}
