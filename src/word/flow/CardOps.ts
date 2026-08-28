import { settleFreshFor, pickNextFresh, syncLadderFor } from "./FreshFlow";
import { flushGroupFor, settleGroupBoundary } from "./GroupFlow";
import { notifyWordDone, notifyWordGrade } from "../../companion";
import { addPair } from "../service/WordConfusables";
import { wordLib } from "../service/WordLib";
import { wordAiInput } from "../service/WordAi";
import { keyOf, markFamiliar, pushTiming } from "../core/WordStore";
import { reviewWord } from "../core/WordFsrs";
import { remainingWordCount } from "./WordQuiz";
import { REINSERT_GAP } from "../core/WordTiming";
import type { WordGrade } from "../core/WordStore";
import type { WordView } from "../core/WordView";

/**
 * 卡级杂项动作（自 WordView 拆出压 500 行红线）：与组机制无关、
 * 但依赖会话状态机的小操作，友元函数直读视图公开字段。
 * finishCard/finishMastered/advanceAfterFinish 三兄弟也在此（20260829
 * 三轮审查波E 拆出——收尾/推进是同一状态机的连续段落，整体搬家）。
 */

/** 卡收尾：批改并进下一张。fresh=滚动梯步进（know 前进、错即整梯
 *  清零、④毕业进 FSRS）；队列轨=FSRS 复习步进 + 答错隔卡重现。 */
export function finishCardFor(v: WordView, grade: WordGrade): void {
    if (!(v.ui.phase === "result" || v.ui.answered) || v.busy || !v.ui.progress) return;
    v.busy = true;
    const p = v.ui.progress;
    const idx = v.currentIdx;
    // 自述「认成了什么」：填了即没记住（决策 7，不论点什么档位）；
    // 「记错了」同路——点了即按不认识批改，填没填自述都算
    const confess = v.ui.confessedDraft.trim();
    if (confess || v.ui.mistakeClaimed) grade = "no";
    // 停留超时（走神）按「忘记」处理（决策 2）
    if (v.curTiming?.over) grade = "no";
    let counted = true;
    if (v.ui.queueKind === "fresh" && v.freshWin.has(idx)) {
        counted = settleFreshFor(v, grade);
    } else if (!v.familiarized.has(idx)) {
        // 查词已标熟的当前词不再复习批改（标熟时已计 revCount/建
        // FSRS，二次 reviewWord 双计，20260829 三轮审查）
        reviewWord(p, idx, grade);
    }
    if (confess) {
        const mk = p.mistakes[keyOf(idx)];
        if (mk) mk.confused = confess;
    }
    // 误认实证（决策 7）：自述「认成了 B」，否则错选 B 的选项
    const pf = v.ui.answered && !v.ui.answered.correct ? v.ui.answered.pickFrom : undefined;
    if (confess) addPair(p, keyOf(idx), confess, "evidence");
    else if (pf !== undefined && pf !== idx) addPair(p, keyOf(idx), wordLib().curBook().words[pf].w, "evidence");
    if (v.curTiming) {
        v.curTiming.typed = v.spellTyped;
        pushTiming(p, idx, v.curTiming);
    }
    v.groupLog.push(wordAiInput(p, idx, grade, v.ui.answered?.correct, v.curTiming, v.spellTyped, confess));
    v.curTiming = undefined;
    v.spellTyped = undefined;
    notifyWordGrade(v, grade, idx);
    advanceAfterFinishFor(v, grade, idx, counted);
}

/** 标「熟」收尾：退出复习循环，不进误认/重现（fresh 同样出窗毕业）。
 *  查词已标熟的词不重复 markFamiliar（双计 revCount）。记账与普通
 *  收尾同口径（groupLog/notifyWordGrade 原缺失——组复盘少一档、
 *  看板娘不感知，20260829 单词域审查挂账）。 */
export function finishMasteredFor(v: WordView): void {
    if (!(v.ui.phase === "result" || v.ui.answered) || v.busy || !v.ui.progress) return;
    v.busy = true;
    const p = v.ui.progress;
    const idx = v.currentIdx;
    const fresh = v.ui.queueKind === "fresh" && v.freshWin.has(idx);
    if (!v.familiarized.has(idx)) markFamiliar(p, idx, fresh);
    v.groupLog.push(wordAiInput(p, idx, "know", v.ui.answered?.correct, v.curTiming, v.spellTyped, undefined));
    notifyWordGrade(v, "know", idx);
    if (fresh) {
        v.freshWin.delete(idx);
        v.finishCount++;
    }
    advanceAfterFinishFor(v, "know", idx, true);
}

/** finishCard/finishMastered 公共推进 + 组边界（决策 3/6；counted=
 *  本卡计入 finishCount——fresh 非毕业卡不判组边界，GroupFlow）。 */
function advanceAfterFinishFor(v: WordView, grade: WordGrade, idx: number, counted: boolean): void {
    const p = v.ui.progress!;
    v.learned.add(idx); // 会话内已作答：队列轨重现时走题型轮换（enterPrompt 读）
    if (grade === "no" && !v.hardList.includes(idx)) v.hardList.push(idx);
    if (v.ui.queueKind === "fresh") {
        syncLadderFor(v);
        void v.store.save(p);
        v.doneSet.add(idx);
        v.ui.cardSeq++;
        v.ui.hardN = v.hardList.length;
        settleGroupBoundary(v, p, counted);
        pickNextFresh(v);
    } else {
        // 会话内重现：插到 3 张卡之后（到末尾则接着出）
        if (grade === "no") {
            v.queue.splice(Math.min(v.pos + 1 + REINSERT_GAP, v.queue.length), 0, idx);
        }
        void v.store.save(p);
        v.doneSet.add(idx);
        v.pos++;
        v.ui.cardSeq++;
        v.finishCount++;
        v.ui.hardN = v.hardList.length;
        settleGroupBoundary(v, p, counted);
        if (v.pos >= v.queue.length) {
            v.ui.pos = v.pos;
            v.ui.queueLen = v.queue.length;
            v.ui.remainWords = remainingWordCount(v.queue, v.pos);
            v.ui.mode = "done";
            flushGroupFor(v);
            notifyWordDone(v.hardList.length, v.finishCount);
        } else {
            v.enterPrompt();
        }
    }
    v.busy = false;
    v.syncAi();
}

/** 一键重过难词（完成屏「重过难词」）：难词清空重建队列从头来——
 *  按队列轨 review 跑（题型轮换 + FSRS 复习步进 + 隔卡重现）。
 *  会话进度三件一并清零：重过是独立一轮——原延续上一会话的
 *  finishCount/doneSet/groupLog，重过词全在旧 doneSet 里被 buildQueue
 *  过滤掉，撞上组边界整数倍且组 AI 已落盘时 rebuildTail 产出空尾、
 *  剩余待重过词被静默吞（20260829 三轮审查 P1）。 */
export function redoHardFor(v: WordView): void {
    if (v.hardList.length === 0) return;
    v.queue = [...v.hardList];
    v.hardList = [];
    v.ui.hardN = 0;
    v.pos = 0;
    v.freshWin = new Map();
    v.doneSet.clear();
    v.learned.clear();
    v.groupLog = [];
    v.finishCount = 0;
    v.ui.queueKind = "review";
    v.ui.mode = "card";
    v.enterPrompt();
}
