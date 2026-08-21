import {
    listQuestions,
    getBlockKramdown,
    recordAttempt,
} from "./QuestionService";
import {QuestionType} from "./types";
import type {WenguQuestion} from "./types";

/**
 * 温故刷题页签视图。
 *
 * 在 addTab 打开的自定义页签内渲染：题目列表 ↔ 单题答题两态。
 * 页签不依赖编辑器光标；点题进入答题，用容器块 kramdown 展示题干，
 * 客观题输入并自动判分、写回属性。
 */
export class QuizView {
    private readonly t: (key: string) => string;
    private readonly el: HTMLElement;
    private list: WenguQuestion[] = [];
    private loading = false;

    constructor(element: HTMLElement, i18n: Record<string, string>) {
        this.el = element;
        this.t = (key: string) => i18n[key] || key;
    }

    /** 首次渲染：刷新题目列表。 */
    render(): void {
        void this.load();
    }

    /** 拉取题目列表并显示。 */
    private async load(): Promise<void> {
        this.loading = true;
        this.renderList();
        try {
            this.list = await listQuestions();
        } finally {
            this.loading = false;
            this.renderList();
        }
    }

    private renderList(): void {
        this.el.classList.add("wengu-panel");
        if (this.loading) {
            this.el.innerHTML = this.head() + block("<span class=\"wengu-muted\">loading…</span>");
            return;
        }
        if (this.list.length === 0) {
            this.el.innerHTML = this.head() + block(`<div class="wengu-muted">${this.t("quizNone")}</div>`);
            this.bindRefresh();
            return;
        }
        const items = this.list
            .map((q) => `<div class="wengu-q" data-qid="${esc(q.id)}">
            <div class="wengu-q-title">${esc(titleOf(q))}</div>
            <div class="wengu-q-meta">${this.meta(q)}</div>
          </div>`)
            .join("");
        this.el.innerHTML = this.head() + block(items);
        this.bindListActions();
    }

    private head(extra = ""): string {
        return `<div class="wengu-head">
          <button class="wengu-btn" data-act="refresh">${this.t("quizRefresh")}</button>
          ${extra}
        </div>`;
    }

    private meta(q: WenguQuestion): string {
        const parts: string[] = [];
        if (q.difficulty) {
            parts.push(`${this.t("difficulty")} ${"★".repeat(q.difficulty)}`);
        }
        if (q.attempts > 0) {
            parts.push(this.t("attempts").replace("{n}", String(q.attempts)));
        } else {
            parts.push(this.t("noAnswer"));
        }
        return parts.join(" · ");
    }

    private bindRefresh(): void {
        const btn = this.el.querySelector("[data-act='refresh']");
        btn?.addEventListener("click", () => void this.load());
    }

    private bindListActions(): void {
        this.bindRefresh();
        for (const node of this.el.querySelectorAll(".wengu-q")) {
            const item = node as HTMLElement;
            item.addEventListener("click", () => {
                const qid = item.dataset.qid;
                if (qid) void this.openQuiz(qid);
            });
        }
    }

    /** 进入单题答题。 */
    private async openQuiz(qid: string): Promise<void> {
        const q = this.list.find((x) => x.id === qid);
        if (!q) return;
        const kd = await getBlockKramdown(qid);
        this.renderQuiz(q, kd);
    }

    private renderQuiz(q: WenguQuestion, kd: string): void {
        const isAuto = q.type !== undefined && q.type !== QuestionType.Brief && q.answer !== undefined;
        const field = isAuto
            ? `<input class="wengu-input" data-field="mine" placeholder="${esc(this.t("inputPlaceholder"))}" />`
            : `<textarea class="wengu-input" data-field="mine" placeholder="${esc(this.t("inputPlaceholder"))}"></textarea>`;
        this.el.innerHTML = `
          <div class="wengu-head">
            <button class="wengu-btn" data-act="back">← ${this.t("back")}</button>
            <span class="wengu-title">${esc(titleOf(q))}</span>
          </div>
          <div class="wengu-q-body"><pre>${esc(kd)}</pre></div>
          ${field}
          <button class="wengu-btn" data-act="submit">${this.t("submit")}</button>
          <div class="wengu-result"></div>
        `;
        this.bindQuizActions(q);
    }

    private bindQuizActions(q: WenguQuestion): void {
        this.el.querySelector("[data-act='back']")?.addEventListener("click", () => this.renderList());
        const submit = this.el.querySelector("[data-act='submit']") as HTMLElement;
        submit?.addEventListener("click", async () => {
            if (q.type === undefined || q.answer === undefined) return;
            const field = this.el.querySelector("[data-field='mine']") as HTMLInputElement;
            if (!field) return;
            const mine = field.value.trim();
            if (!mine) return;
            const ok = await recordAttempt(q.id, q.type, q.answer, mine);
            const result = this.el.querySelector(".wengu-result") as HTMLElement;
            result.textContent = ok ? this.t("correct") : `${this.t("wrong")} ${this.t("answerLabel")} ${q.answer}`;
            result.classList.add(ok ? "wengu-right" : "wengu-wrong");
            const hit = this.list.find((x) => x.id === q.id);
            if (hit) hit.attempts = (hit.attempts ?? 0) + 1;
        });
    }
}

/** 题干标题：优先知识点/章节，其次 id。 */
function titleOf(q: WenguQuestion): string {
    return q.knowledge || q.chapter || q.id.slice(0, 8);
}

/** 块容器。 */
function block(inner: string): string {
    return `<div class="wengu-section">${inner}</div>`;
}

/** HTML 转义。 */
function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}