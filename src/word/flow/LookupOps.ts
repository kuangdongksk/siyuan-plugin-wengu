import { confKey, keyOf, markFamiliar, toggleStar } from "../core/WordStore";
import { groupsOf } from "../service/WordConfusables";
import type { WordView } from "../core/WordView";

/**
 * 查词/笔记胶水（自 WordView 拆出压 500 行红线，友元直访视图字段）：
 * 查词入口态、检索输入、词条选中（含易混笔记草稿回填）、星标/熟、
 * 笔记草稿分发。保存与 AI 同步走视图自己的 store/syncAi。
 */

export function enterLookupFor(v: WordView): void {
    v.ui.lookupSel = undefined;
    v.ui.fromCard = v.ui.mode === "card";
    v.ui.mode = "lookup";
}

export function lookupInputFor(v: WordView, value: string): void {
    v.ui.lookupQuery = value;
    v.ui.lookupSel = undefined;
}

export function lookupPickFor(v: WordView, idx: number): void {
    const p = v.ui.progress!;
    const g = groupsOf(p, idx)[0];
    v.confCtl.draft = g ? (p.confNotes?.[confKey(g.ids)] ?? "") : "";
    v.confCtl.wordDraft = p.notes?.[keyOf(idx)] ?? "";
    v.ui.lookupSel = idx;
}

export function lookupStarFor(v: WordView, idx: number): void {
    toggleStar(v.ui.progress!, idx);
    void v.store.save(v.ui.progress!);
}

export function lookupFamiliarFor(v: WordView, idx: number): void {
    // 梯内新词按新学口径计数（原恒 false 计成复习，口径失真）
    const wasNew = v.freshWin?.has(idx) ?? false;
    markFamiliar(v.ui.progress!, idx, wasNew);
    // 同步逐出挂起的在学窗口：syncLadderFor 以 freshWin 为准重建 ladder，
    // 不删的话刚清的条目被写回——familiar+ladder 双态、本会话继续出卡
    v.freshWin?.delete(idx);
    // 标记「本会话已标熟」：该词当前卡收尾不再走 reviewWord 二次记账
    // （标熟已计 revCount/建 FSRS——原当前卡标熟后落入复习批改路径，
    // today.revCount 双计，20260829 三轮审查）
    v.familiarized.add(idx);
    void v.store.save(v.ui.progress!);
    v.syncAi();
}

/** 笔记草稿输入（confnote=组辨析 / wordnote=词级，不重绘）。 */
export function noteInputFor(v: WordView, field: string, value: string): void {
    if (field === "confnote") v.confCtl.draft = value;
    else v.confCtl.wordDraft = value;
}

export function resumeCardFor(v: WordView): void {
    v.ui.mode = "card";
}
