import type { AnswerHost } from "./AnswerFlow";
import { checkAllDone } from "./AnswerFlow";
import { markNum } from "../render/FlowDom";
import { fillClozeCur, markClozeOpts } from "../render/CardState";
import type { CardCtl } from "../render/CardCtl";
import { gradeSlot } from "../service/QuestionGrading";
import type { WenguQuestion } from "../../types";
import { slotQid } from "../../types";
import { esc } from "../../ui/shared";

/**
 * slots 题作答流程（E2，与 StepsFlow 平行，6-4b 状态化）：完形/新题型
 * 逐空独立判分（每空一条会话记录 qid#k，同 steps 口径），全部作答完
 * 写整题账（right=全空对）并揭示。slots 不参与 after 统一揭示——
 * 逐空反馈依赖即时判分（同 steps 的取舍）。全部作答态在 CardUi.slots
 * （marks 逐空账 + cloze 当前空快照），事件由组件直调本流程。
 */

/* ── 完形：空号条 + 当前空选项（一次一空，提交后自动跳下一空） ── */

/** 空号条点选：跳到指定空（已答空不可回）。 */
export function gotoSlot(ctl: CardCtl, k: number): void {
    const ui = ctl.ui;
    const s = ui.slots;
    if (!s || s.kind !== "cloze" || ui.graded || s.marks[k]?.answered) return;
    s.cur = k;
    fillClozeCur(ctl.q, ui, ctl.host.t);
}

/** 当前空选项点选（互斥单选，锁定后不可点）。 */
export function pickSlotOpt(ctl: CardCtl, letter: string): void {
    const s = ctl.ui.slots;
    if (!s || s.curLocked || ctl.graded) return;
    s.curSelected = letter;
}

/** cloze 提交本空：判分描色 → 记账 → 跳下一空（全部作答完收口）。 */
export function submitSlot(host: AnswerHost, q: WenguQuestion, ctl: CardCtl): void {
    const ui = ctl.ui;
    const s = ui.slots;
    if (!s || s.kind !== "cloze" || ui.graded) return;
    const letter = s.curSelected;
    if (!letter) {
        ctl.setNote(host.t("noAnswer"));
        return;
    }
    const k = s.cur;
    const slot = (q.slots ?? [])[k];
    if (!slot) return;
    const ok = gradeSlot(slot, letter);
    markClozeOpts(q, ui, letter);
    s.marks[k] = { answered: true, letter, ok };
    settleSlot(host, q, ctl, k, letter, ok);
    fillClozeCur(q, ui, host.t); // 自愈推进：跳过已答空到下一空
}

/* ── 新题型：候选池只读 + 每槽一行（下拉选字母提交） ── */

/** match 下拉草稿（未提交前的字母暂存）。 */
export function pickMatch(ctl: CardCtl, k: number, value: string): void {
    const s = ctl.ui.slots;
    if (!s || ctl.graded || s.marks[k]?.answered) return;
    s.marks[k].letter = value.toUpperCase();
}

/** match 单行提交：判分 + 描色锁定。 */
export function submitMatch(host: AnswerHost, q: WenguQuestion, ctl: CardCtl, k: number): void {
    const s = ctl.ui.slots;
    if (!s || ctl.ui.graded) return;
    const letter = (s.marks[k]?.letter ?? "").toUpperCase();
    if (!letter) {
        ctl.setNote(host.t("noAnswer"));
        return;
    }
    const slot = (q.slots ?? [])[k];
    if (!slot) return;
    const ok = gradeSlot(slot, letter);
    s.marks[k] = { answered: true, letter, ok };
    settleSlot(host, q, ctl, k, letter, ok);
}

/* ── 共用：单空记账 + 整题收口 ── */

function settleSlot(host: AnswerHost, q: WenguQuestion, ctl: CardCtl, k: number, letter: string, ok: boolean): void {
    host.recordAnswer(slotQid(q.id, k), letter, ok);
    markNum(host, q, ok);
    ctl.setNote(ok ? host.t("correct") : host.t("slotWrong").replace("{L}", (q.slots ?? [])[k]?.answer ?? ""));
    if (ctl.ui.slots?.marks.every((m) => m.answered)) void finishSlots(host, q, ctl);
}

/** 全部空作答完：整题记账 + 揭示 + 收口检查。 */
async function finishSlots(host: AnswerHost, q: WenguQuestion, ctl: CardCtl): Promise<void> {
    const s = ctl.ui.slots!;
    const letters = s.marks.map((m) => m.letter);
    const oks = s.marks.map((m) => m.ok);
    const allOk = oks.length > 0 && oks.every(Boolean);
    host.bankMirror?.(q.id, letters.join(""), allOk, { kind: "slots", letters, oks });
    ctl.setGraded();
    const right = oks.filter(Boolean).length;
    ctl.setResult(
        esc(
            allOk
                ? host.t("correct")
                : host.t("slotsSummary").replace("{r}", String(right)).replace("{n}", String(oks.length))
        ),
        allOk ? "right" : "wrong"
    );
    checkAllDone(host);
}
