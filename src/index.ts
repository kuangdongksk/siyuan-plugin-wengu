import {Plugin, getActiveEditor, type Custom, type MobileCustom} from "siyuan";
import "./index.scss";
import {listQuestions} from "./wengu/QuestionService";
import type {WenguQuestion} from "./wengu/types";

const DOCK_TYPE = "wengu";

/** dock 面板模式。 */
type PanelMode = "material" | "quiz";

// 单实例 dock 面板状态（模块级，闭包共享给 init/update/异步刷新）。
let panelMode: PanelMode = "material";
let panelQuestions: WenguQuestion[] = [];
let panelDocId = "";
let panelLoading = false;

/**
 * 温故 —— 刷题 · 错题复习 · 题目与笔记联动
 *
 * 职责：持有「素材 ↔ 刷题」两模式切换的 dock 面板。
 * - 素材模式：说明转换契约，显示当前文档与已转换题数；
 * - 刷题模式：列出已转换题目（后续在此接分组抽题）。
 */
export default class WenguPlugin extends Plugin {
    onload() {
        const plugin = this;
        this.addIcons(`<symbol id="iconWengu" viewBox="0 0 32 32">
<path d="M4 6h10a4 4 0 0 1 4 4v16a3 3 0 0 0-3-3H4z" fill="currentColor"/>
<path d="M28 6H18a4 4 0 0 0-4 4v16a3 3 0 0 1 3-3h11z" fill="currentColor" opacity="0.55"/>
<path d="M13 15.5l2.2 2.2 4.3-4.6" fill="none" stroke="var(--b3-theme-background)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</symbol>`);

        this.addTopBar({
            icon: "iconWengu",
            title: this.i18n.pluginName,
            position: "right",
            callback: () => {
                // TODO: 打开刷题面板（考试模式）
            },
        });

        this.addDock({
            config: {
                position: "RightBottom",
                size: {width: 360, height: 0},
                icon: "iconWengu",
                title: this.i18n.pluginName,
                hotkey: "",
            },
            data: {},
            type: DOCK_TYPE,
            update() {
                renderDock(this, plugin);
            },
            resize() {
            },
            init(this: Custom | MobileCustom) {
                renderDock(this, plugin);
            },
        });
    }
}

/** 面板 HTML 转义，避免 i18n / 属性值破坏结构。 */
function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 渲染 dock 面板整体。 */
function renderDock(host: Custom | MobileCustom, plugin: Plugin): void {
    const editor = getActiveEditor();
    const docId = editor?.protyle.block.rootID ?? "";
    if (docId !== panelDocId) {
        // 切文档清缓存，重新拉取
        panelDocId = docId;
        panelQuestions = [];
    }

    const body = panelMode === "material"
        ? materialBody(plugin, docId)
        : quizBody(plugin, docId);

    const el = host.element as HTMLElement;
    el.innerHTML = `<div class="wengu-dock">
  <header class="wengu-tabs">
    <button class="wengu-tab" data-mode="material"${panelMode === "material" ? ' aria-pressed="true"' : ""}>${esc(plugin.i18n.modeMaterial)}</button>
    <button class="wengu-tab" data-mode="quiz"${panelMode === "quiz" ? ' aria-pressed="true"' : ""}>${esc(plugin.i18n.modeQuiz)}</button>
  </header>
  ${body}
</div>`;

    bindTabClicks(el, host, plugin);
    if (panelMode === "quiz" && panelQuestions.length === 0 && !panelLoading) {
        void refreshQuestions(host, plugin, docId);
    }
}

/** 素材模式主体。 */
function materialBody(plugin: Plugin, docId: string): string {
    if (!docId) {
        return `<section class="wengu-section"><span class="wengu-muted">${esc(plugin.i18n.notOpen)}</span></section>`;
    }
    return `<section class="wengu-section">
  <div>${esc(plugin.i18n.currentDoc)}：<code class="wengu-code">${esc(docId)}</code></div>
  <div class="wengu-hint">${esc(plugin.i18n.convertHint)}</div>
</section>`;
}

/** 刷题模式主体。 */
function quizBody(plugin: Plugin, docId: string): string {
    if (panelLoading) {
        return `<section class="wengu-section"><span class="wengu-muted">loading…</span></section>`;
    }
    if (panelQuestions.length === 0) {
        return `<section class="wengu-section">
  <div class="wengu-btn-row">
    <button class="wengu-btn" data-act="refresh">${esc(plugin.i18n.quizRefresh)}</button>
  </div>
  <div class="wengu-muted">${esc(plugin.i18n.quizNone)}</div>
</section>`;
    }
    const items = panelQuestions.map((q) => {
        const diff = q.difficulty ? `${esc(plugin.i18n.difficulty)}：${"★".repeat(q.difficulty)}` : "";
        const stats = q.attempts > 0
            ? esc(plugin.i18n.attempts).replace("{n}", String(q.attempts))
            : esc(plugin.i18n.noAnswer);
        return `<div class="wengu-q" data-qid="${esc(q.id)}">
  <div class="wengu-q-title">${esc(q.knowledge ?? q.chapter ?? q.id.slice(0, 8))}</div>
  <div class="wengu-q-meta">${diff} · ${stats}</div>
</div>`;
    }).join("");
    return `<section class="wengu-section">
  <div class="wengu-btn-row">
    <button class="wengu-btn" data-act="refresh">${esc(plugin.i18n.quizRefresh)}</button>
  </div>
  ${items}
</section>`;
}

/** 绑定 tab 切换与操作按钮。 */
function bindTabClicks(el: HTMLElement, host: Custom | MobileCustom, plugin: Plugin): void {
    el.querySelectorAll<HTMLButtonElement>(".wengu-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            panelMode = btn.dataset.mode as PanelMode;
            renderDock(host, plugin);
        });
    });
    el.querySelectorAll<HTMLButtonElement>(".wengu-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const act = btn.dataset.act;
            if (act === "refresh") {
                showDockMessage(plugin, "refresh…");
                void refreshQuestions(host, plugin, panelDocId);
            }
        });
    });
    el.querySelectorAll<HTMLElement>(".wengu-q").forEach((item) => {
        item.addEventListener("click", () => {
            const qid = item.dataset.qid;
            if (qid) {
                showDockMessage(plugin, qid);
            }
        });
    });
}

/** 面板内消息（M3 前暂用 status text 占位）。 */
function showDockMessage(plugin: Plugin, text: string): void {
    const dock = document.querySelector(".wengu-dock");
    if (dock) {
        dock.setAttribute("data-status", text);
    }
}

/** 异步拉取题目并重渲染。 */
async function refreshQuestions(host: Custom | MobileCustom, plugin: Plugin, docId: string): Promise<void> {
    panelLoading = true;
    renderDock(host, plugin);
    try {
        panelQuestions = await listQuestions(docId || void 0);
        panelDocId = docId;
    } finally {
        panelLoading = false;
        renderDock(host, plugin);
    }
}