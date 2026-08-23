import {svgIcon} from "./FormHtml";
import {
    esc,
    fmt,
} from "./ui";
import WORD_BOOK from "./WordBook";
import type {WenguWordProgress} from "./WordStore";

/**
 * 查词面板（WordView 拆件）：非答题期间可搜词书任意词。
 *
 * 支持按单词（前缀/包含）与中文释义检索；词条详情显示
 * 释义/学习状态/误认与 AI 辨析，并可星标、标熟。
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
    ${m?.note ? `<div class="wengu-word-ainote">${esc(t("wordAiNote"))}${esc(m.note)}</div>` : ""}
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
