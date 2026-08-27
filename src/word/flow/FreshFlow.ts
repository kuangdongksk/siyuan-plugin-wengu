import { wordLib } from "../service/WordLib";
import { graduateWord, openWord } from "../core/WordFsrs";
import { bookLeftOf, firstFresh, markMistake, windowCapOf, type WordGrade } from "../core/WordStore";
import { flushGroupFor } from "./GroupFlow";
import { NEW_LADDER } from "./WordQuiz";
import { pickFreshCard, type WinEntry } from "./WindowSched";
import { notifyWordDone } from "../../companion";
import type { WordView } from "../core/WordView";

/**
 * 新学滚动窗口编排（redesign §二.3，20260828 定稿）：窗口态在 WordView
 * （freshWin/seq/cur 友元字段），本模块做「建窗（含重进恢复）—选卡—
 * 收尾推进—持久化镜像」。决策规则本体在 WindowSched（纯函数+单测）。
 *
 * 进度按词头共享（v3）：建窗时 ladder 词头换算回当前书下标（不在当前
 * 书的在学词跳过本会话、进度保留）；镜像回写只动当前书的 key，他书
 * 在学词的 ladder 原样保真。与旧静态流水线的差异：队列不再预排——
 * 每张卡现场决策；答错清零由 settle 内联完成（窗口制天然支持重走，
 * 无补插）；毕业即 FSRS 初始化（WordFsrs.graduateWord）并腾窗位给
 * 下一个新词。
 */

/** 建窗：从持久 ladder 恢复在学词（步数保留、lastSeq 重起算），续新词。 */
export function startFreshFor(v: WordView): void {
    const lib = wordLib();
    const p = v.ui.progress!;
    const entries: [number, WinEntry][] = [];
    for (const [key, st] of Object.entries(p.ladder)) {
        const i = lib.keyIndex(key);
        if (i !== undefined) entries.push([i, { step: st[0], lastSeq: 0, errs: st[1] }]);
    }
    v.freshWin = new Map(entries);
    v.sessionNew = new Set(v.freshWin.keys());
    v.seq = 0;
    v.ui.queueKind = "fresh";
    v.queue = [];
    v.pos = 0;
    v.hardList = [];
    v.ui.hardN = 0;
    v.doneSet.clear();
    v.groupLog = [];
    v.finishCount = 0; // 毕业数（AI 组边界按此触发）
    pickNextFresh(v);
}

/** 选下一张：new 时开词入窗；done 时收尾进完成屏（新词=全书第一个
 * 无进度词，太简单/熟的词不再被当新词引入——与头部「剩」同口径）。 */
export function pickNextFresh(v: WordView): void {
    const p = v.ui.progress!;
    const pick = pickFreshCard(v.freshWin, v.seq, windowCapOf(p), () => firstFresh(p));
    if (pick.kind === "done") {
        syncLadderFor(v);
        v.ui.mode = "done";
        flushGroupFor(v);
        notifyWordDone(v.hardList.length, v.finishCount);
        return;
    }
    if (pick.kind === "new") {
        openWord(p, pick.idx);
        v.freshWin.set(pick.idx, { step: 0, lastSeq: v.seq, errs: 0 });
        v.sessionNew.add(pick.idx);
    }
    v.cur = pick.idx;
    v.seq++;
    v.enterPrompt();
}

/** 滚动梯卡收尾：know 前进一步、其余整梯清零（留窗重排；「忘记/记
 * 错了」照记误认本）；④认识即毕业——FSRS 按会话表现初始化、出窗、
 * 毕业计数。返回是否毕业。 */
export function settleFreshFor(v: WordView, grade: WordGrade): boolean {
    const e = v.freshWin.get(v.cur);
    if (!e) return false;
    e.lastSeq = v.seq - 1;
    if (grade === "know") {
        e.step += 1;
        if (e.step >= NEW_LADDER.length) {
            graduateWord(v.ui.progress!, v.cur, e.errs);
            v.freshWin.delete(v.cur);
            v.finishCount++;
            return true;
        }
    } else {
        if (grade === "no") markMistake(v.ui.progress!, v.cur);
        e.step = 0;
        e.errs += 1;
    }
    return false;
}

/** 窗口镜像进持久 ladder（每卡存盘前调；毕业项已删，天然清除）。
 * 只重写当前书的 key——他书在学词的梯进度原样保留（跨书共享）。 */
export function syncLadderFor(v: WordView): void {
    const lib = wordLib();
    const p = v.ui.progress!;
    const next: Record<string, [number, number]> = {};
    for (const [key, st] of Object.entries(p.ladder)) {
        if (lib.keyIndex(key) === undefined) next[key] = st; // 他书在学词：保真
    }
    for (const [i, e] of v.freshWin) next[lib.keyOf(i)] = [e.step, e.errs];
    p.ladder = next;
}

/** 头部「剩」的书口径（fresh 会话用，随毕业递减）。 */
export function bookLeftFor(v: WordView): number {
    return v.ui.progress ? bookLeftOf(v.ui.progress) : 0;
}

/** 新词梯进度点（仿不背单词词尾四点）：不在梯内（已毕业/队列轨）
 * 返回 undefined，UI 不渲染。 */
export function ladderOf(v: WordView, idx: number): { done: number; total: number } | undefined {
    const e = v.freshWin.get(idx);
    if (v.ui.queueKind !== "fresh" || !e || e.step >= NEW_LADDER.length) return undefined;
    return { done: e.step, total: NEW_LADDER.length };
}
