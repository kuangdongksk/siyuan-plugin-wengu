import {
    esc,
    fmt,
} from "./ui";
import WORD_BOOK from "./WordBook";

/**
 * 单词出题渲染（WordView 的展示层，不持有状态）。
 *
 * 三种模式（仿不背单词）：
 * - choice   看单词选意思（四选一，干扰项取同单元）
 * - recallEn 看英文回想中文（翻面后三档自评）
 * - recallZh 看中文回想英文（翻面后三档自评）
 * 每题答完都进结果页：单词 + 释义 + AI 提示 + 模式对应的收尾按钮。
 */

export type WordCardMode = "choice" | "recallEn" | "recallZh";

/** 释义首行（多行释义取第一行，选择题选项用）。 */
export function meaningLine(idx: number): string {
    const m = WORD_BOOK.words[idx]?.m ?? "";
    return m.split("\n")[0].trim();
}

/** 出四选一的选项（正确 + 3 个同单元干扰项，按 idx 稳定取样）。 */
export function buildChoiceOptions(idx: number): {text: string; correct: boolean;}[] {
    const unit = WORD_BOOK.units.find((u) => idx >= u.start && idx < u.start + u.count) ??
        WORD_BOOK.units[0];
    const correct = meaningLine(idx);
    const pool: number[] = [];
    for (let i = unit.start; i < unit.start + unit.count && pool.length < 60; i++) {
        if (i !== idx && meaningLine(i) !== correct) pool.push(i);
    }
    const picks: string[] = [];
    let seed = idx * 2654435761 >>> 0;
    const next = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed;
    };
    while (picks.length < 3 && pool.length > 0) {
        const j = next() % pool.length;
        const text = meaningLine(pool[j]);
        pool.splice(j, 1);
        if (text && !picks.includes(text)) picks.push(text);
    }
    const opts = picks.map((text) => ({text, correct: false}));
    const at = next() % (opts.length + 1);
    opts.splice(at, 0, {text: correct, correct: true});
    return opts;
}

/** 提示页（题面）：choice 带选项，recall* 带显示答案按钮。 */
export function renderPrompt(
    mode: WordCardMode,
    idx: number,
    t: (k: string) => string,
): string {
    const entry = WORD_BOOK.words[idx];
    const modeLabel = t(
        mode === "choice" ? "wordModeChoice" : mode === "recallEn" ? "wordModeRecallEn" : "wordModeRecallZh",
    );
    let body: string;
    if (mode === "choice") {
        const opts = buildChoiceOptions(idx)
            .map((o, i) => `<button class="b3-button wengu-word-opt" data-opt="${i}">${esc(o.text)}</button>`)
            .join("");
        body = `<div class="wengu-word-text">${esc(entry.w)}</div>
    <div class="wengu-word-hint">${esc(t("wordPickMeaning"))}</div>
    <div class="wengu-word-opts">${opts}</div>`;
    } else if (mode === "recallEn") {
        body = `<div class="wengu-word-text">${esc(entry.w)}</div>
    <div class="wengu-word-hint">${esc(t("wordRecallHint"))}</div>
    <div class="wengu-word-actions"><button class="b3-button b3-button--outline" data-act="showanswer">${
            esc(t("wordShowAnswer"))
        }</button></div>`;
    } else {
        body = `<div class="wengu-word-zh">${esc(meaningLine(idx))}</div>
    <div class="wengu-word-hint">${esc(t("wordRecallHint"))}</div>
    <div class="wengu-word-actions"><button class="b3-button b3-button--outline" data-act="showanswer">${
            esc(t("wordShowAnswer"))
        }</button></div>`;
    }
    return `<div class="wengu-word-card" tabindex="0">
    <div class="wengu-word-unit">${esc(modeLabel)}</div>
    ${body}
  </div>`;
}

/** 结果页（单词 + 释义 + AI 提示 + 收尾按钮区，按钮由 WordView 拼装）。 */
export function renderResult(
    idx: number,
    t: (k: string) => string,
    note: string | undefined,
    actions: string,
    feedback = "",
): string {
    const entry = WORD_BOOK.words[idx];
    return `<div class="wengu-word-card wengu-word-revealed">
    ${feedback ? `<div class="wengu-word-feedback">${esc(feedback)}</div>` : ""}
    <div class="wengu-word-text">${esc(entry.w)}</div>
    <div class="wengu-word-meaning">${esc(entry.m)}</div>
    ${note ? `<div class="wengu-word-ainote">${esc(t("wordAiNote"))}${esc(note)}</div>` : ""}
    <div class="wengu-word-actions">${actions}</div>
  </div>`;
}

/** 三档自评按钮（回想模式结果页用）。 */
export function gradeButtons(t: (k: string) => string): string {
    return `<button class="b3-button b3-button--outline" data-grade="no">${esc(t("wordGradeNo"))}</button>
      <button class="b3-button b3-button--outline" data-grade="fuzzy">${esc(t("wordGradeFuzzy"))}</button>
      <button class="b3-button b3-button--outline" data-grade="know">${esc(t("wordGradeKnow"))}</button>`;
}

/** 选择题反馈文案。 */
export function choiceFeedback(correct: boolean, idx: number, t: (k: string) => string): string {
    return correct ? t("wordCorrectPick") : fmt(t("wordWrongPick"), {m: meaningLine(idx)});
}
