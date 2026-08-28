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
    markFamiliar(v.ui.progress!, idx, false);
    // 同步逐出挂起的在学窗口：syncLadderFor 以 freshWin 为准重建 ladder，
    // 不删的话刚清的条目被写回——familiar+ladder 双态、本会话继续出卡
    v.freshWin?.delete(idx);
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
