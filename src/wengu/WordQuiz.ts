import {statusIcon} from "./FormHtml";
import {
    esc,
    fmt,
} from "./ui";
import WORD_BOOK from "./WordBook";

/**
 * 单词出题渲染（WordView 的展示层，不持有状态）。仿不背单词：
 *
 * - choiceEn 看单词选释义（四选一，干扰取同单元）
 * - choiceZh 看释义选单词（四选一，选项是英文单词）
 * - spell    看释义拼单词（输入提交，即对错）
 * - recallEn/recallZh 回想自评（翻面后三档）
 *
 * 客观题点选/提交后在题面内即时标色（对绿错红、正确项高亮），
 * 下方内嵌词详情（单词+释义+AI 提示）与继续按钮。
 */

export type WordCardMode = "choiceEn" | "choiceZh" | "spell" | "recallEn" | "recallZh";

/** 题型轮换（首题按流分流在 WordView.enterPrompt，不在轮换内）。 */
const REVIEW_MODES: WordCardMode[] = ["choiceEn", "recallEn", "choiceZh", "spell", "recallZh"];

/** 会话题型轮换：按 seq 取模；干扰项不足或空格/超长词降级到
 * 回想（confIds 须与本卡判定同源）。新词首题不走轮换（视图直接
 * 给 choiceEn 先测后学，错词重现才进轮换）。 */
export function pickMode(seq: number, idx: number, confIds: readonly number[]): WordCardMode {
    let mode = REVIEW_MODES[seq % REVIEW_MODES.length];
    if (mode === "choiceEn" && buildMeaningOptions(idx, confIds).length < 4) mode = "recallEn";
    else if (mode === "choiceZh" && buildWordOptions(idx, confIds).length < 4) mode = "recallZh";
    else if (mode === "spell") {
        const w = WORD_BOOK.words[idx].w;
        if (w.includes(" ") || w.length > 14) mode = "recallZh";
    }
    return mode;
}

/** 选择题选项：文本 + 来源词条（正确项=本题，干扰=易混组/同单元；
 * 错选展示与误认实证都靠 from 找到「你选的是哪个词」）。 */
export interface WenguOpt {
    text: string;
    from: number;
}

/** 客观题作答态（题面标色与详情用）。 */
export interface AnsweredState {
    correct: boolean;
    /** 选择题选中的选项号（spell 无）。 */
    pick?: number;
    /** 错选时所选选项的来源词条（错选展示/误认实证用）。 */
    pickFrom?: number;
}

/** 释义首行（多行释义取第一行，选择题选项用）。 */
export function meaningLine(idx: number): string {
    const m = WORD_BOOK.words[idx]?.m ?? "";
    return m.split("\n")[0].trim();
}

function unitRange(idx: number): {start: number; count: number;} {
    const u = WORD_BOOK.units.find((v) => idx >= v.start && idx < v.start + v.count) ?? WORD_BOOK.units[0];
    return {start: u.start, count: u.count};
}

/** 稳定伪随机（按词下标作种子，同一词每次选项组合一致）。 */
function seeded(idx: number) {
    let s = (idx * 2654435761) >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s;
    };
}

/** 看词选义：干扰 = 易混组词优先，同单元其它释义首行补足。
 * confIds 为易混组内其它词下标（调用方保证本卡内快照稳定，
 * 渲染与判定必须传同一份，否则选项错位）。 */
export function buildMeaningOptions(idx: number, confIds: readonly number[] = []): WenguOpt[] {
    const correct = meaningLine(idx);
    const pool: WenguOpt[] = [];
    const push = (i: number): void => {
        const t = meaningLine(i);
        if (t && t !== correct && !pool.some(o => o.text === t)) pool.push({text: t, from: i});
    };
    for (const i of confIds) {
        if (i !== idx) push(i);
    }
    const {start, count} = unitRange(idx);
    for (let i = start; i < start + count && pool.length < 60; i++) {
        if (i === idx || confIds.includes(i)) continue;
        push(i);
    }
    const next = seeded(idx);
    const picks: WenguOpt[] = [];
    while (picks.length < 3 && pool.length > 0) {
        picks.push(pool.splice(next() % pool.length, 1)[0]);
    }
    const at = next() % (picks.length + 1);
    picks.splice(at, 0, {text: correct, from: idx});
    return picks;
}

/** 看义选词：干扰 = 易混组词优先，同单元其它单词补足。 */
export function buildWordOptions(idx: number, confIds: readonly number[] = []): WenguOpt[] {
    const correct = WORD_BOOK.words[idx].w;
    const pool: WenguOpt[] = [];
    const push = (i: number): void => {
        const w = WORD_BOOK.words[i].w;
        if (w && w !== correct && !pool.some(o => o.text === w)) pool.push({text: w, from: i});
    };
    for (const i of confIds) {
        if (i !== idx) push(i);
    }
    const {start, count} = unitRange(idx);
    for (let i = start; i < start + count && pool.length < 60; i++) {
        if (i === idx || confIds.includes(i)) continue;
        push(i);
    }
    const next = seeded(idx + 7919);
    const picks: WenguOpt[] = [];
    while (picks.length < 3 && pool.length > 0) {
        picks.push(pool.splice(next() % pool.length, 1)[0]);
    }
    const at = next() % (picks.length + 1);
    picks.splice(at, 0, {text: correct, from: idx});
    return picks;
}

function optionCls(i: number, answered: AnsweredState | undefined, correctText: string, choices: WenguOpt[]): string {
    if (!answered) return "";
    if (answered.pick === i) return answered.correct ? " is-correct" : " is-wrong";
    if (choices[i].text === correctText) return " is-correct";
    return " is-dim";
}

/** 错选展示：你选的选项对应的词条（不背单词式——错的中英文）。 */
function wrongPickHtml(t: (k: string) => string, from: number): string {
    const e = WORD_BOOK.words[from];
    if (!e) return "";
    return `<div class="wengu-word-wrongpick">${esc(t("wordWrongPickEntry"))}：${esc(e.w)} ${
        esc(e.m.split("\n")[0])
    }</div>`;
}

/** 详情区（单词+释义+曾认成 chip+易混对照+AI辨析），结果视图共用。 */
function detailHtml(
    idx: number,
    t: (k: string) => string,
    note: string | undefined,
    confused?: string,
    confHtml = "",
): string {
    const entry = WORD_BOOK.words[idx];
    return `<div class="wengu-word-detail">
    <div class="wengu-word-detail-word">${esc(entry.w)}</div>
    <div class="wengu-word-detail-meaning">${esc(entry.m)}</div>
    ${confused ? `<div class="wengu-word-confused">${esc(fmt(t("wordConfusedChip"), {v: confused}))}</div>` : ""}
    ${confHtml}
    ${note ? `<div class="wengu-word-ainote">${esc(t("wordAiNote"))}${esc(note)}</div>` : ""}
  </div>`;
}

/** 结果视图的「认成了…」自述输入（答错时填,回车=不认识并记录）。 */
function confessHtml(t: (k: string) => string, word: string): string {
    return `<div class="wengu-word-confess">
    <span class="wengu-word-confess-label">${esc(fmt(t("wordConfusedHint"), {w: word}))}</span>
    <input class="b3-text-field wengu-word-spell" data-field="confessed" autocomplete="off" placeholder="${
        esc(t("wordConfusedPh"))
    }">
  </div>`;
}

/** 「熟」按钮（标熟=退出复习循环）。 */
function familiarButton(t: (k: string) => string): string {
    return `<button class="b3-button b3-button--outline" data-act="mastered" title="${esc(t("wordFamiliarTip"))}">${
        esc(t("wordFamiliar"))
    }</button>`;
}

/** 客观题作答后的收尾按钮：下一个（对→know/错→no，错的判分自带）。 */
function continueButtons(t: (k: string) => string): string {
    return `<button class="b3-button b3-button--outline" data-act="next">${esc(t("wordNext"))}</button>`;
}

const MODE_KEY: Record<WordCardMode, string> = {
    choiceEn: "wordModeChoice",
    choiceZh: "wordModeChoiceZh",
    spell: "wordModeSpell",
    recallEn: "wordModeRecallEn",
    recallZh: "wordModeRecallZh",
};

/**
 * 渲染一张卡。answered 仅客观题有（题面标色+内嵌详情+继续按钮）；
 * learn/recall 的翻面结果视图用 reveal=true 表达。
 */
export function renderCard(
    mode: WordCardMode,
    idx: number,
    t: (k: string) => string,
    opts: {
        reveal?: boolean;
        answered?: AnsweredState;
        note?: string;
        /** 曾认成的对象原文（详情区 chip）。 */
        confused?: string;
        /** 是否已星标（角标星高亮）。 */
        starred?: boolean;
        /** 易混组其它词下标（选择题干扰项优先取，须与判定同源）。 */
        confIds?: readonly number[];
        /** 易混对照块 HTML（视图预构建注入）。 */
        confHtml?: string;
    } = {},
): string {
    const entry = WORD_BOOK.words[idx];
    const label = t(MODE_KEY[mode]);
    // 结果视图公共件：详情(含混淆chip+易混对照)+自述输入+熟按钮
    const wrongPending = opts.reveal || (opts.answered && !opts.answered.correct);
    const resultBlocks = `${detailHtml(idx, t, opts.note, opts.confused, opts.confHtml ?? "")}
    ${wrongPending ? confessHtml(t, entry.w) : ""}
    ${wrongPending ? familiarButton(t) : ""}`;
    let body: string;
    if (mode === "choiceEn" || mode === "choiceZh") {
        const choices = mode === "choiceEn" ?
            buildMeaningOptions(idx, opts.confIds) :
            buildWordOptions(idx, opts.confIds);
        const correct = mode === "choiceEn" ? meaningLine(idx) : entry.w;
        const wrongPick = opts.answered && !opts.answered.correct && opts.answered.pickFrom !== undefined ?
            wrongPickHtml(t, opts.answered.pickFrom) :
            "";
        const buttons = choices.map((o, i) =>
            `<button class="b3-button wengu-word-opt${optionCls(i, opts.answered, correct, choices)}" data-opt="${i}"${
                opts.answered ? " disabled" : ""
            }">${esc(o.text)}</button>`
        ).join("");
        const topic = mode === "choiceEn" ? esc(entry.w) : esc(meaningLine(idx));
        const topicCls = mode === "choiceEn" ? "wengu-word-text" : "wengu-word-zh";
        body = `<div class="${topicCls}">${topic}</div>
    ${
            opts.answered ?
                `<div class="wengu-word-feedback">${statusIcon(opts.answered.correct ? "right" : "wrong")}${
                    esc(opts.answered.correct ? t("wordCorrectPick") : t("wordWrongPick2"))
                }</div>` :
                `<div class="wengu-word-hint">${esc(t("wordPickHint"))}</div>`
        }
    <div class="wengu-word-opts">${buttons}</div>
    ${wrongPick}
    ${opts.answered ? resultBlocks + `<div class="wengu-word-actions">${continueButtons(t)}</div>` : ""}`;
    } else if (mode === "spell") {
        if (opts.answered) {
            body = `<div class="wengu-word-zh">${esc(meaningLine(idx))}</div>
    <div class="wengu-word-feedback">${statusIcon(opts.answered.correct ? "right" : "wrong")}${
                esc(opts.answered.correct ? t("wordSpellOk") : fmt(t("wordSpellWrong"), {w: entry.w}))
            }</div>
    ${resultBlocks}
    <div class="wengu-word-actions">${continueButtons(t)}</div>`;
        } else {
            body = `<div class="wengu-word-zh">${esc(meaningLine(idx))}</div>
    <input class="b3-text-field wengu-word-spell" data-field="spell" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${
                esc(t("wordSpellPlaceholder"))
            }">
    <div class="wengu-word-actions"><button class="b3-button b3-button--outline" data-act="submit">${
                esc(t("wordSubmit"))
            }</button></div>`;
        }
    } else { // recallEn / recallZh
        if (opts.reveal) {
            body = `<div class="wengu-word-feedback">${esc(t(mode === "recallEn" ? "wordSelfEn" : "wordSelfZh"))}</div>
    ${resultBlocks}
    <div class="wengu-word-actions">
      <button class="b3-button b3-button--outline" data-grade="no">${esc(t("wordGradeNo"))}</button>
      <button class="b3-button b3-button--outline" data-grade="fuzzy">${esc(t("wordGradeFuzzy"))}</button>
      <button class="b3-button b3-button--outline" data-grade="know">${esc(t("wordGradeKnow"))}</button>
    </div>`;
        } else {
            const topic = mode === "recallEn" ? esc(entry.w) : esc(meaningLine(idx));
            const cls = mode === "recallEn" ? "wengu-word-text" : "wengu-word-zh";
            body = `<div class="${cls}">${topic}</div>
    <div class="wengu-word-hint">${esc(t("wordRecallHint"))}</div>
    <div class="wengu-word-actions"><button class="b3-button b3-button--outline" data-act="showanswer">${
                esc(t("wordShowAnswer"))
            }</button></div>`;
        }
    }
    const starBtn = `<button class="b3-button b3-button--icon wengu-word-star${
        opts.starred ? " is-starred" : ""
    }" data-act="star" title="${esc(t("wordStar"))}"><svg><use xlink:href="#iconStar"></use></svg></button>`;
    return `<div class="wengu-word-card${opts.reveal || opts.answered ? " wengu-word-revealed" : ""}" tabindex="0">
    <div class="wengu-word-unit">${esc(label)}</div>
    ${starBtn}
    ${body}
  </div>`;
}

/** 拼写判定：忽略大小写/多余空格/连字符差异。 */
export function spellMatches(input: string, word: string): boolean {
    const n = (s: string) => s.toLowerCase().replace(/[\s\-']/g, "");
    return n(input).length > 0 && n(input) === n(word);
}

/** 选择题判定（mode ∈ choiceEn/choiceZh）：返回作答态，选项不存在
 * 返回 undefined。confIds 必须与渲染时同源（同一快照）。 */
export function checkOption(
    mode: "choiceEn" | "choiceZh",
    idx: number,
    no: number,
    confIds: readonly number[] = [],
): AnsweredState | undefined {
    const choices = mode === "choiceEn" ? buildMeaningOptions(idx, confIds) : buildWordOptions(idx, confIds);
    if (choices[no] === undefined) return undefined;
    const correct = mode === "choiceEn" ? meaningLine(idx) : WORD_BOOK.words[idx].w;
    return {correct: choices[no].text === correct, pick: no, pickFrom: choices[no].from};
}

/** 读拼写框并判定（el 为视图容器）。 */
export function checkSpell(el: HTMLElement, idx: number): AnsweredState {
    const input = el.querySelector<HTMLInputElement>("[data-field='spell']");
    return {correct: spellMatches(input?.value ?? "", WORD_BOOK.words[idx].w)};
}
