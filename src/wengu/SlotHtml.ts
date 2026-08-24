import { renderCardHead, renderThoughtArea } from "./CardParts";
import type { CardHtmlModel } from "./CardParts";
import { mdFragmentHtml } from "./ProtyleHost";
import type { WenguQuestion } from "./types";
import { LETTERS, optionDisplayMd, QuestionType } from "./types";
import { esc } from "./ui";

/**
 * slots 题卡渲染层（E2，自 CardHtml 拆出避免循环引用）：
 * 完形（cloze）= 空号条 + 当前空选项；新题型（match）= 候选池 + 槽位行。
 * 逐空作答行为在 SlotFlow；slot-* 子块在 Protyle 里被 CSS 隐藏
 * （判分后随整题揭示），空选项由 SlotFlow 用 Lute 按空填充。
 */

/** 一张 slots 卡：头部 + Protyle 题干 + 逐空作答区（无整题提交按钮）。 */
export function renderSlotsCardHtml(q: WenguQuestion, idx: number, m: CardHtmlModel): string {
    return `<div class="wengu-card" data-qid="${esc(q.id)}" data-idx="${idx}">
      ${renderCardHead(q, idx, m, true, m.t)}
      <div class="wengu-qprotyle" data-qprotyle><span class="wengu-muted">…</span></div>
      <div class="wengu-slots" data-slots>${renderSlotsArea(q, m.t)}</div>
      ${renderThoughtArea(m.t)}
      <div class="wengu-result" data-result hidden></div>
      <div class="wengu-note" data-note hidden></div>
    </div>`;
}

/** 逐空作答区：cloze 空号条 + 当前空选项位；match 候选池 + 槽位行。 */
function renderSlotsArea(q: WenguQuestion, t: (k: string) => string): string {
    const n = q.slots?.length ?? 0;
    if (q.type === QuestionType.Match) return renderMatchArea(q, t);
    const strip = Array.from(
        { length: n },
        (_, k) => `<button class="wengu-slotbtn" data-slotbtn="${k}">${k + 1}</button>`
    ).join("");
    return `<div class="wengu-slotbar" data-slotbar>${strip}</div>
      <div class="wengu-slotcur" data-slotcur>
        <span class="wengu-badge" data-slot-stem></span>
        <div class="wengu-slot-opts" data-slot-opts></div>
        <button class="wengu-btn" data-act="slot-submit">${esc(t("slotSubmit"))}</button>
      </div>`;
}

/** match：候选池（只读展示）+ 每槽一行（下拉选字母 + 提交）。 */
function renderMatchArea(q: WenguQuestion, t: (k: string) => string): string {
    const pool = (q.optionMd ?? [])
        .map(
            (md, i) =>
                `<div class="wengu-match-poolitem"><span class="wengu-match-letter">${LETTERS[i] ?? ""}</span><span>${mdFragmentHtml(optionDisplayMd(md))}</span></div>`
        )
        .join("");
    const opts = (q.optionMd ?? [])
        .map((_, i) => `<option value="${LETTERS[i] ?? ""}">${LETTERS[i] ?? ""}</option>`)
        .join("");
    const rows = (q.slots ?? [])
        .map(
            (_, k) => `<div class="wengu-match-row" data-matchrow="${k}">
        <span class="wengu-match-k">${k + 1}</span>
        <select class="b3-select wengu-match-sel" data-matchsel="${k}"><option value="">—</option>${opts}</select>
        <button class="wengu-btn wengu-match-go" data-act="match-submit" data-k="${k}">${esc(t("slotSubmit"))}</button>
      </div>`
        )
        .join("");
    return `<div class="wengu-matchpool">${pool}</div>
      <div class="wengu-matchrows">${rows}</div>`;
}
