import WORD_BOOK from "./WordBook";

/**
 * 单词出题逻辑（WordView 的出题层，Svelte 化后只留纯函数）：
 *
 * - choiceEn 看单词选释义（四选一，干扰取同单元）
 * - choiceZh 看释义选单词（四选一，选项是英文单词）
 * - spell    看释义拼单词（输入提交，即对错）
 * - recallEn/recallZh 回想自评（翻面后三档）
 *
 * 客观题点选/提交后的题面标色由 QuizCard 组件按作答态渲染，
 * 选项组合与判定共用本文件的确定性构造（同词每次一致）。
 */

export type WordCardMode = "choiceEn" | "choiceZh" | "spell" | "recallEn" | "recallZh";

/** 题面左上角题型标签的 i18n key。 */
export const MODE_KEY: Record<WordCardMode, string> = {
    choiceEn: "wordModeChoice",
    choiceZh: "wordModeChoiceZh",
    spell: "wordModeSpell",
    recallEn: "wordModeRecallEn",
    recallZh: "wordModeRecallZh",
};

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

function unitRange(idx: number): { start: number; count: number } {
    const u = WORD_BOOK.units.find((v) => idx >= v.start && idx < v.start + v.count) ?? WORD_BOOK.units[0];
    return { start: u.start, count: u.count };
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
        if (t && t !== correct && !pool.some((o) => o.text === t)) pool.push({ text: t, from: i });
    };
    for (const i of confIds) {
        if (i !== idx) push(i);
    }
    const { start, count } = unitRange(idx);
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
    picks.splice(at, 0, { text: correct, from: idx });
    return picks;
}

/** 看义选词：干扰 = 易混组词优先，同单元其它单词补足。 */
export function buildWordOptions(idx: number, confIds: readonly number[] = []): WenguOpt[] {
    const correct = WORD_BOOK.words[idx].w;
    const pool: WenguOpt[] = [];
    const push = (i: number): void => {
        const w = WORD_BOOK.words[i].w;
        if (w && w !== correct && !pool.some((o) => o.text === w)) pool.push({ text: w, from: i });
    };
    for (const i of confIds) {
        if (i !== idx) push(i);
    }
    const { start, count } = unitRange(idx);
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
    picks.splice(at, 0, { text: correct, from: idx });
    return picks;
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
    confIds: readonly number[] = []
): AnsweredState | undefined {
    const choices = mode === "choiceEn" ? buildMeaningOptions(idx, confIds) : buildWordOptions(idx, confIds);
    if (choices[no] === undefined) return undefined;
    const correct = mode === "choiceEn" ? meaningLine(idx) : WORD_BOOK.words[idx].w;
    return { correct: choices[no].text === correct, pick: no, pickFrom: choices[no].from };
}
