import {Lute, ProtyleMethod} from "siyuan";
import {listQuestions, recordAttempt} from "./QuestionService";
import {QuestionType} from "./types";
import type {WenguQuestion} from "./types";

/**
 * 温故刷题页签视图。
 *
 * 一个页签渲染一个文档「一整篇」的题目：每次加载把该文档所有已转换
 * 题目容器（超级块）渲染成卡片（题干/选项用 Lute 引擎渲染为思源外观），
 * 每卡片一个输入框，客观题提交自动判分、写回属性。
 *
 * 渲染原料：WenguQuestion.stemMd / optionMd（子块 kramdown），
 * 由全局 Lute.Md2BlockDOM 转成思源块 DOM；答案/解析子块默认不渲染，
 * 判分后才展示答案文本。
 */
export class QuizView {
    private readonly t: (key: string) => string;
    private readonly el: HTMLElement;
    private readonly docId: string;
    private list: WenguQuestion[] = [];
    private loading = false;

    constructor(element: HTMLElement, i18n: Record<string, string>, docId = "") {
        this.el = element;
        this.t = (key: string) => i18n[key] || key;
        this.docId = docId;
    }

    /** 首次渲染：加载文档题目并画卡片。 */
    render(): void {
        void this.load();
    }

    /** 拉取题目列表并显示。 */
    private async load(): Promise<void> {
        this.loading = true;
        this.renderList();
        try {
            this.list = await listQuestions(this.docId || void 0);
        } finally {
            this.loading = false;
            this.renderList();
        }
    }

    private renderList(): void {
        this.el.classList.add("wengu-panel");
        if (this.loading) {
            this.el.innerHTML = `<div class="wengu-muted">${this.t("loading")}</div>`;
            this.bindRefresh();
            return;
        }
        if (this.list.length === 0) {
            this.el.innerHTML = `<div class="wengu-head">${refreshBtn(this.t)}</div>
        <div class="wengu-muted">${this.t("quizNone")}</div>`;
            this.bindRefresh();
            return;
        }
        const cards = this.list
            .map((q, i) => this.renderCard(q, i))
            .join("");
        this.el.innerHTML = `<div class="wengu-head">${refreshBtn(this.t)}</div>
      <div class="wengu-card-list">${cards}</div>`;
        this.bindRefresh();
        this.bindCards();
        // Lute 渲染公式/代码高亮
        if ("mathRender" in ProtyleMethod) {
            ProtyleMethod.mathRender(this.el);
        }
        if ("highlightRender" in ProtyleMethod) {
            ProtyleMethod.highlightRender(this.el);
        }
    }

    private renderCard(q: WenguQuestion, idx: number): string {
        const stem = q.stemMd ? luteToHtml(q.stemMd) : "";
        const options = (q.optionMd ?? [])
            .map((md) => `<div class="b3-typography--content wengu-option">${luteToHtml(md)}</div>`)
            .join("");
        const isAuto = q.type !== undefined && q.type !== QuestionType.Brief && q.answer !== undefined;
        const input = isAuto
            ? `<input class="wengu-input" data-field="mine" placeholder="${esc(this.t("inputPlaceholder"))}" />`
            : `<textarea class="wengu-input" data-field="mine" placeholder="${esc(this.t("inputPlaceholder"))}"></textarea>`;
        const solution = q.solutionMd
            ? `<details class="wengu-solution"><summary>${esc(this.t("solution"))}</summary>${luteToHtml(q.solutionMd)}</details>`
            : "";
        return `<div class="wengu-card" data-qid="${esc(q.id)}">
      <div class="wengu-card-head">
        <span class="wengu-card-title">${esc(q.knowledge || q.chapter || String(idx + 1))}</span>
        ${q.difficulty ? `<span class="wengu-meta">${"★".repeat(q.difficulty)}</span>` : ""}
      </div>
      <div class="b3-typography--content wengu-stem">${stem}</div>
      ${options}
      ${input}
      <button class="wengu-btn" data-act="submit">${esc(this.t("submit"))}</button>
      <div class="wengu-result" data-result></div>
      ${solution}
    </div>`;
    }

    private bindCards(): void {
        for (const node of this.el.querySelectorAll(".wengu-card")) {
            const card = node as HTMLElement;
            const qid = card.dataset.qid;
            const q = this.list.find((x) => x.id === qid);
            if (!q) continue;
            const submit = card.querySelector<HTMLButtonElement>("[data-act='submit']");
            submit?.addEventListener("click", async () => {
                const field = card.querySelector<HTMLInputElement>("[data-field='mine']");
                if (!field) return;
                const mine = field.value.trim();
                if (!mine || !q.answer || !q.type) return;
                const ok = await recordAttempt(q.id, q.type, q.answer, mine);
                const result = card.querySelector<HTMLElement>("[data-result]");
                if (result) {
                    result.textContent = ok
                        ? this.t("correct")
                        : `${this.t("wrong")}${this.t("answerLabel")}${q.answer}`;
                    result.classList.add(ok ? "wengu-right" : "wengu-wrong");
                }
            });
        }
    }

    private bindRefresh(): void {
        const btn = this.el.querySelector("[data-act='refresh']");
        btn?.addEventListener("click", () => void this.load());
    }
}

/** 把 kramdown 交给思源 Lute 渲染为块 DOM HTML。 */
function luteToHtml(md: string): string {
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    lute.SetSanitize(true);
    lute.SetInlineMathAllowDigitAfterOpenMarker(true);
    return lute.Md2BlockDOM(md);
}

/** 顶部刷新按钮。 */
function refreshBtn(t: (k: string) => string): string {
    return `<button class="wengu-btn" data-act="refresh">${esc(t("quizRefresh"))}</button>`;
}

/** HTML 转义。 */
function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}