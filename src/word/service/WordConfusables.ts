import PRESET from "../data/confusables";
import { esc } from "../../ui/shared";
import WORD_BOOK from "./WordBook";
import { confKey, type WenguConfusableGroup, type WenguWordProgress } from "../core/WordStore";

/**
 * 易混组运行时（docs/confusable-words.md 定稿）：预置组（构建期
 * data/confusables.ts）与实证/AI 组（progress）只读并集、不合并写；
 * 辨析笔记为用户手写（复制词对去外部 AI / 思源内部对话生成后粘贴），
 * 存 progress.confNotes，不改组本体。
 */

/** 词书单词 → 扁平下标（小写匹配，惰性一次构建）。 */
let wordIdx: Map<string, number> | undefined;
function indexOfWord(w: string): number | undefined {
    wordIdx ??= new Map(WORD_BOOK.words.map((e, i) => [e.w.toLowerCase(), i]));
    return wordIdx.get(w.trim().toLowerCase());
}

/** 全量易混组（预置 + 实证/AI）。 */
export function allGroups(p: WenguWordProgress): WenguConfusableGroup[] {
    return [...PRESET, ...(p.confusables ?? [])];
}

/** 含某词的全部易混组。 */
export function groupsOf(p: WenguWordProgress, idx: number): WenguConfusableGroup[] {
    return allGroups(p).filter((g) => g.ids.includes(idx));
}

/** 某词易混组内其它词下标并集（本卡快照：渲染与判定同源，防 AI
 * 异步落盘改变组导致选项错位）。 */
export function confOthers(p: WenguWordProgress, idx: number): number[] {
    return [...new Set(allGroups(p).flatMap((g) => (g.ids.includes(idx) ? g.ids : [])))].filter((i) => i !== idx);
}

/** 记一对混淆（去重）：B 在词书 → [A,B] 组；不在 → [A] + raw。
 * evidence=作答实证，ai=组复盘判定（docs/confusable-words.md §三）。 */
export function addPair(p: WenguWordProgress, a: number, bRaw: string, src: "evidence" | "ai"): void {
    const raw = bRaw.trim().toLowerCase();
    if (!raw || raw === WORD_BOOK.words[a]?.w.toLowerCase()) return;
    const b = indexOfWord(raw);
    for (const g of p.confusables ?? []) {
        if (!g.ids.includes(a)) continue;
        if ((b !== undefined && g.ids.includes(b)) || (b === undefined && g.raw === raw)) return;
    }
    (p.confusables ??= []).push(b !== undefined ? { ids: [a, b], src } : { ids: [a], src, raw });
}

/** 易混对照块 HTML（卡片/查词详情区共用）：同组其它词与笔记。 */
export function confusableHtml(t: (k: string) => string, p: WenguWordProgress, idx: number): string {
    const rows: string[] = [];
    for (const g of groupsOf(p, idx)) {
        const note = p.confNotes?.[confKey(g.ids)];
        const others = g.ids
            .filter((i) => i !== idx)
            .map((i) => `${WORD_BOOK.words[i].w}：${WORD_BOOK.words[i].m.split("\n")[0]}`);
        if (g.raw) others.push(`${g.raw}（不在词书）`);
        if (others.length === 0 && !note) continue;
        rows.push(
            `<div class="wengu-word-confuse">${esc(t("wordConfusePair"))}：${others.map(esc).join("；")}` +
                (note ? `<div class="wengu-word-confuse-note">${esc(note)}</div>` : "") +
                "</div>"
        );
    }
    return rows.join("");
}

/** 「复制提问」提示词：去外部 AI 或思源内部对话生成辨析，粘回笔记。 */
export function askPrompt(idx: number, other: string): string {
    return `请辨析这两个考研易混单词：${WORD_BOOK.words[idx].w} / ${other}。各给中文释义，再用一句话讲两者区别与记法。`;
}

/** 词级笔记的只读块（卡片/查词详情区：这个词怎么记，任何词可写）。 */
export function wordNoteHtml(p: WenguWordProgress, idx: number): string {
    const v = p.notes?.[String(idx)];
    return v ? `<div class="wengu-word-confuse-note">${esc(v)}</div>` : "";
}

/** 保存易混组辨析笔记（用户手写）。 */
export function setNote(p: WenguWordProgress, g: WenguConfusableGroup, note: string): void {
    (p.confNotes ??= {})[confKey(g.ids)] = note;
}
