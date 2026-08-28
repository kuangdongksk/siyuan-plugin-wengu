import PRESET from "../data/confusables";
import { esc } from "../../ui/shared";
import { BUILTIN_BOOK, keyOf as keyOfBook, wordKey } from "./WordBook";
import { wordLib, type WordLib } from "./WordLib";
import { confKey, keyOf, type WenguConfusableGroup, type WenguWordProgress } from "../core/WordStore";

/**
 * 易混组运行时（docs/confusable-words.md 定稿）：预置组（构建期
 * data/confusables.ts，按内置书下标生成——运行时换算成词头）与实证/AI
 * 组（progress，ids 即词头）只读并集、不合并写；辨析笔记为用户手写
 * （复制词对去外部 AI / 思源内部对话生成后粘贴），存 progress.confNotes，
 * 不改组本体。组内词不在当前书时，对照块展示词头原文并标注。
 */

/** 词书单词 → 扁平下标（小写匹配；缓存随换书失效）。 */
let wordIdx: { stamp: number; map: Map<string, number> } | undefined;
function indexOfWord(lib: WordLib, w: string): number | undefined {
    const stamp = lib.bookStamp();
    if (!wordIdx || wordIdx.stamp !== stamp) {
        wordIdx = { stamp, map: new Map(lib.curBook().words.map((e, i) => [e.w.toLowerCase(), i])) };
    }
    return wordIdx.map.get(w.trim().toLowerCase());
}

/** 全量易混组（预置 + 实证/AI；预置下标按内置书换算成词头）。 */
export function allGroups(p: WenguWordProgress): WenguConfusableGroup[] {
    const preset: WenguConfusableGroup[] = PRESET.map((g) => ({
        ids: g.ids.map((i) => keyOfBook(BUILTIN_BOOK, i)).filter(Boolean),
        src: g.src,
        raw: g.raw,
    }));
    return [...preset, ...(p.confusables ?? [])];
}

/** 含某词的全部易混组（词头匹配）。 */
export function groupsOf(p: WenguWordProgress, idx: number): WenguConfusableGroup[] {
    const key = keyOf(idx);
    return allGroups(p).filter((g) => g.ids.includes(key));
}

/** 某词易混组内其它词下标并集，限当前书（本卡快照：渲染与判定同源，
 * 防 AI 异步落盘改变组导致选项错位）。 */
export function confOthers(p: WenguWordProgress, idx: number): number[] {
    const key = keyOf(idx);
    const lib = wordLib();
    const out = new Set<number>();
    for (const g of allGroups(p)) {
        if (!g.ids.includes(key)) continue;
        for (const k of g.ids) {
            const i = lib.keyIndex(k);
            if (i !== undefined && i !== idx) out.add(i);
        }
    }
    return [...out];
}

/** 记一对混淆（去重）：B 在当前书 → [A,B] 组；不在 → [A] + raw。
 * evidence=作答实证，ai=组复盘判定（docs/confusable-words.md §三）。
 * keyA 为**归一化词头**——AI 异步落盘调用方传构建时刻冻结的 key，
 * 防往返期间切书串词（20260828 审查）。 */
export function addPair(p: WenguWordProgress, keyA: string, bRaw: string, src: "evidence" | "ai"): void {
    const lib = wordLib();
    const raw = bRaw.trim().toLowerCase();
    if (!raw || !keyA || wordKey(raw) === keyA) return; // 自己配自己无意义
    const b = indexOfWord(lib, raw);
    for (const g of p.confusables ?? []) {
        if (!g.ids.includes(keyA)) continue;
        if ((b !== undefined && g.ids.includes(lib.keyOf(b))) || (b === undefined && g.raw === raw)) return;
    }
    (p.confusables ??= []).push(b !== undefined ? { ids: [keyA, lib.keyOf(b)], src } : { ids: [keyA], src, raw });
}

/** 易混对照块 HTML（卡片/查词详情区共用）：同组其它词与笔记。 */
export function confusableHtml(t: (k: string) => string, p: WenguWordProgress, idx: number): string {
    const lib = wordLib();
    const key = keyOf(idx);
    const rows: string[] = [];
    for (const g of groupsOf(p, idx)) {
        const note = p.confNotes?.[confKey(g.ids)];
        const others = g.ids
            .filter((k) => k !== key)
            .map((k) => {
                const i = lib.keyIndex(k);
                if (i === undefined) return `${k}（不在当前词书）`;
                return `${lib.curBook().words[i].w}：${lib.curBook().words[i].m.split("\n")[0]}`;
            });
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
    return `请辨析这两个考研易混单词：${wordLib().curBook().words[idx].w} / ${other}。各给中文释义，再用一句话讲两者区别与记法。`;
}

/** 词级笔记的只读块（卡片/查词详情区：这个词怎么记，任何词可写）。 */
export function wordNoteHtml(p: WenguWordProgress, idx: number): string {
    const v = p.notes?.[keyOf(idx)];
    return v ? `<div class="wengu-word-confuse-note">${esc(v)}</div>` : "";
}

/** 保存易混组辨析笔记（用户手写）。 */
export function setNote(p: WenguWordProgress, g: WenguConfusableGroup, note: string): void {
    (p.confNotes ??= {})[confKey(g.ids)] = note;
}
