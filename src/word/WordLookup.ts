import { fmt } from "../ui/shared";
import WORD_BOOK from "./WordBook";
import { groupsOf, setNote, askPrompt } from "./WordConfusables";
import type { WenguWordProgress } from "./WordStore";

/**
 * 查词支持层（WordView 拆件，Svelte 化后渲染在 comp/LookupScreen）：
 * 检索（单词前缀/包含 + 中文释义包含）与易混笔记控制器；
 * 词条详情渲染所需的组数据/笔记读写都从这里走。
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
export function statusLine(p: WenguWordProgress, idx: number, t: (k: string) => string): string {
    if (p.simple[String(idx)]) return t("wordStSimple");
    if (p.familiar[String(idx)]) return t("wordStFamiliar");
    const st = p.words[String(idx)];
    if (!st) return t("wordStNew");
    return fmt(t("wordStLevel"), { n: String(st[0]) });
}

/** 查词详情的易混笔记控制器（草稿跟踪 + 保存/复制提问）。
 *  草稿值由 LookupScreen 的输入框持有（控制器只读写），选中词条时
 *  由 WordView.lookupPick 用已存笔记初始化。 */
export class LookupConfCtl {
    /** 辨析笔记草稿（input 输入写入，不触发重绘）。 */
    draft = "";
    /** 词级笔记草稿。 */
    wordDraft = "";

    constructor(
        private readonly getProgress: () => WenguWordProgress,
        private readonly save: (p: WenguWordProgress) => Promise<unknown>,
        private readonly refresh: () => void
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
        const other = g && g.ids.some((i) => i !== idx) ? WORD_BOOK.words[g.ids.find((i) => i !== idx)!].w : g?.raw;
        if (other) void navigator.clipboard?.writeText(askPrompt(idx, other));
    }
}
