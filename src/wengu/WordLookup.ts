import {svgIcon} from "./FormHtml";
import {
    esc,
    fmt,
} from "./ui";
import WORD_BOOK from "./WordBook";
import {
    askPrompt,
    confusableHtml,
    groupsOf,
    setNote,
    wordNoteHtml,
} from "./WordConfusables";
import {
    renderWordHead,
    type AiGlue,
} from "./WordHome";
import {
    confKey,
    type WenguWordProgress,
} from "./WordStore";

/**
 * 查词面板（WordView 拆件）：非答题期间可搜词书任意词。
 *
 * 支持按单词（前缀/包含）与中文释义检索；词条详情显示
 * 释义/学习状态/误认与 AI 辨析/易混组（可编辑手写辨析笔记），
 * 并可星标、标熟。本文件同时承接 WordView 外移的页面组装。
 */

/** 检索：单词前缀 > 单词包含 > 释义包含，至多 LIMIT 条。 */
const LIMIT = 30;
export function searchWords(query: string): number[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const starts: number[] = [];
    const includes: number[] = [];
    const meaning: number[] = [];
    WORD_BOOK.words.forEach((e, i) => {
        const w = e.w.toLowerCase();
        if (w.startsWith(q)) starts.push(i);
        else if (w.includes(q)) includes.push(i);
        else if (!/^[a-z'\- ]+$/.test(q) && e.m.toLowerCase().includes(q)) meaning.push(i);
    });
    return [...starts, ...includes, ...meaning].slice(0, LIMIT);
}

/** 学习状态描述（详情行）。 */
function statusLine(p: WenguWordProgress, idx: number, t: (k: string) => string): string {
    if (p.simple[String(idx)]) return t("wordStSimple");
    if (p.familiar[String(idx)]) return t("wordStFamiliar");
    const st = p.words[String(idx)];
    if (!st) return t("wordStNew");
    return fmt(t("wordStLevel"), {n: String(st[0])});
}

/** 详情页易混笔记编辑行（仅属易混组时渲染；值走 confCtl.draft 不重绘）。 */
function confEditHtml(t: (k: string) => string, p: WenguWordProgress, idx: number): string {
    const g = groupsOf(p, idx)[0];
    if (!g) return "";
    const note = p.confNotes?.[confKey(g.ids)] ?? "";
    return `<div class="wengu-word-confuse-edit">
    <input class="b3-text-field" data-field="confnote" value="${esc(note)}" placeholder="${
        esc(t("wordConfuseNotePh"))
    }">
    <button class="b3-button b3-button--outline" data-act="confask" data-idx="${idx}">${
        esc(t("wordConfuseAsk"))
    }</button>
    <button class="b3-button b3-button--outline" data-act="confsave" data-idx="${idx}">${
        esc(t("wordConfuseSave"))
    }</button>
  </div>`;
}

/** 详情页词级笔记编辑行（任何词都有：词根/助记/例句等）。 */
function wordEditHtml(t: (k: string) => string, p: WenguWordProgress, idx: number): string {
    const note = p.notes?.[String(idx)] ?? "";
    return `<div class="wengu-word-confuse-edit">
    <input class="b3-text-field" data-field="wordnote" value="${esc(note)}" placeholder="${esc(t("wordNotePh"))}">
    <button class="b3-button b3-button--outline" data-act="wordnotesave" data-idx="${idx}">${
        esc(t("wordNoteSave"))
    }</button>
  </div>`;
}

/** 渲染查词面板（挂 WordView 容器；sel=详情词下标，无则列表态）。 */
export function renderLookup(
    t: (k: string) => string,
    p: WenguWordProgress,
    query: string,
    sel: number | undefined,
    headHtml: string,
): string {
    let body: string;
    if (sel !== undefined) {
        const e = WORD_BOOK.words[sel];
        const m = p.mistakes[String(sel)];
        body = `<div class="wengu-word-card wengu-word-revealed">
    <div class="wengu-word-unit">${esc(statusLine(p, sel, t))}</div>
    <div class="wengu-word-text">${esc(e.w)}</div>
    <div class="wengu-word-detail-meaning">${esc(e.m)}</div>
    ${m?.confused ? `<div class="wengu-word-confused">${esc(fmt(t("wordConfusedChip"), {v: m.confused}))}</div>` : ""}
    ${wordNoteHtml(p, sel)}
    ${confusableHtml(t, p, sel)}
    ${m?.note ? `<div class="wengu-word-ainote">${esc(t("wordAiNote"))}${esc(m.note)}</div>` : ""}
    ${wordEditHtml(t, p, sel)}
    ${confEditHtml(t, p, sel)}
    <div class="wengu-word-actions">
      <button class="b3-button b3-button--outline" data-act="lookupstar" data-idx="${sel}">${svgIcon("iconStar")}${
            esc(t("wordStar"))
        }</button>
      <button class="b3-button b3-button--outline" data-act="lookupfamiliar" data-idx="${sel}">${
            esc(t("wordFamiliar"))
        }</button>
      <button class="b3-button b3-button--outline" data-act="lookup">${esc(t("wordLookupBack"))}</button>
    </div>
  </div>`;
    } else {
        const hits = searchWords(query);
        const rows = hits.map((i) =>
            `<button class="wengu-word-opt" data-act="lookuppick" data-idx="${i}">
    <span class="wengu-word-lk-word">${esc(WORD_BOOK.words[i].w)}</span>
    <span class="wengu-word-lk-meaning">${esc(WORD_BOOK.words[i].m.split("\n")[0])}</span>
  </button>`
        ).join("");
        body = `<div class="wengu-word-card">
    <input class="b3-text-field wengu-word-spell" data-field="lookup" value="${esc(query)}" placeholder="${
            esc(t("wordLookupPh"))
        }" autocomplete="off">
    <div class="wengu-word-opts">${
            query.trim() === "" ?
                `<div class="wengu-word-hint">${esc(t("wordLookupHint"))}</div>` :
                rows || `<div class="wengu-word-hint">${esc(t("wordLookupNone"))}</div>`
        }</div>
  </div>`;
    }
    return `<div class="wengu-word">
  ${headHtml}
  ${body}
</div>`;
}

/** 查词页组装（自 WordView 外移：渲染 + 聚焦搜索框）。 */
export function paintLookupInto(
    el: HTMLElement,
    t: (k: string) => string,
    p: WenguWordProgress,
    query: string,
    sel: number | undefined,
    ai: AiGlue,
    fromCard = false,
): void {
    el.innerHTML = renderLookup(
        t,
        p,
        query,
        sel,
        renderWordHead(
            t,
            `<button class="b3-button b3-button--icon" data-act="stats" title="${esc(t("wordStatsTitle"))}">${
                svgIcon("iconInfo")
            }</button>${
                fromCard ?
                    `<button class="b3-button b3-button--icon" data-act="resumecard" title="${
                        esc(t("wordResumeCard"))
                    }">${svgIcon("iconBack")}</button>` :
                    `<button class="b3-button b3-button--icon" data-act="home" title="${esc(t("wordBackHome"))}">${
                        svgIcon("iconList")
                    }</button>`
            }${ai.buttonHtml(p)}`,
        ),
    );
    const input = el.querySelector<HTMLInputElement>("[data-field='lookup']");
    input?.focus();
}

/** 查词详情的易混笔记控制器（草稿跟踪 + 保存/复制提问，
 * 自 WordView 外移行数受限）。 */
export class LookupConfCtl {
    /** 辨析笔记草稿（input 委托写入，不触发重绘）。 */
    draft = "";
    /** 词级笔记草稿。 */
    wordDraft = "";

    constructor(
        private readonly getProgress: () => WenguWordProgress,
        private readonly save: (p: WenguWordProgress) => Promise<unknown>,
        private readonly refresh: () => void,
    ) {}

    /** 保存词级笔记（任何词，词根/助记/例句）。 */
    saveWordNote(idx: number): void {
        const p = this.getProgress();
        (p.notes ??= {})[String(idx)] = this.wordDraft.trim();
        void this.save(p);
        this.refresh();
    }

    /** 保存辨析笔记到词条第一个易混组。 */
    saveNote(idx: number): void {
        const p = this.getProgress();
        const g = groupsOf(p, idx)[0];
        if (g) {
            setNote(p, g, this.draft.trim());
            void this.save(p);
            this.refresh();
        }
    }

    /** 复制「辨析 A/B」提示词（去外部 AI 或思源内部对话生成）。 */
    ask(idx: number): void {
        const g = groupsOf(this.getProgress(), idx)[0];
        const other = g && g.ids.some(i => i !== idx) ?
            WORD_BOOK.words[g.ids.find(i => i !== idx)!].w :
            g?.raw;
        if (other) void navigator.clipboard?.writeText(askPrompt(idx, other));
    }
}
