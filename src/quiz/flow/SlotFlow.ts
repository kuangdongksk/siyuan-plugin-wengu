import type { AnswerHost } from "./AnswerFlow";
import { checkAllDone } from "./AnswerFlow";
import { markNum } from "../render/FlowDom";
import { fillClozeCur, markClozeOpts } from "../render/CardState";
import type { CardCtl } from "../render/CardCtl";
import { gradeSlot } from "../service/QuestionGrading";
import { applyGapSame, reviewGap } from "./GapReview";
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

/** cloze 提交本空：判分描色 → 记账 → 跳下一空（全部作答完收口）。
 *  Jev 复核（#187）在逐空侧是**外层异步**：不进这条同步链，避免把
 *  「点一下、立刻跳下一空」的既有手感改成等待（判定回来再按结果补账）。 */
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
    void reviewSlotGap(host, q, ctl, k, slot, letter, ok);
    markClozeOpts(q, ui, letter);
    s.marks[k] = { answered: true, letter, ok };
    settleSlot(host, q, ctl, k, letter, ok);
    fillClozeCur(q, ui, host.t); // 自愈推进：跳过已答空到下一空
}

/** 逐空复核的**异步补账**（#187）：判定回来判同 ⇒ 翻该空的 ok。
 *
 *  ⚠️ **逐空的会话记录身份是 `slotQid(q.id, k)`**（提交那一刻 `settleSlot`
 *  落的账），判同标记必须按它写（20260921 复核修正：原实现拿整题 id 去查，
 *  逐空的会话结果永远是 `qid#k` ⇒ 标记 100% 丢失，只有卡面翻色）。
 *
 *  **不重记逐空账**（那条已在提交那一刻写死；复核只补「对」的事实），
 *  也不重跑收口——整题收口由 `finishSlots` 在判分时按 marks 一次性算出。
 *  未判同/失败/无 key ⇒ 什么都不做（逐空维持现状判错）。 */
async function reviewSlotGap(
    host: AnswerHost,
    q: WenguQuestion,
    ctl: CardCtl,
    k: number,
    slot: { optionMd: string[]; answer: string },
    letter: string,
    ok: boolean
): Promise<void> {
    const site = { host, q, ctl, slot, submitted: letter, ok, recordQid: slotQid(q.id, k) };
    const outcome = await reviewGap(site);
    if (!outcome.same) return;
    // 先落账（会话记录已在同步链里建好），再补卡面/题库——顺序同桌面主链
    applyGapSame(site, outcome);
    const s = ctl.ui.slots;
    const mark = s?.marks[k];
    if (!mark || mark.ok) return;
    mark.ok = true; // 逐空账翻对（会话侧整题账由 finishSlots 重取 marks 时带上）
    if (s!.marks.every((m) => m.answered)) settleSlotsResult(host, q, ctl);
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
    void reviewSlotGap(host, q, ctl, k, slot, letter, ok);
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
    // 揭示闸（Issue #12）：逐空题整卡做完即揭示（自判分）——setGraded 一把
    // 置 graded+locked+revealed，解析区（只认 .wengu-revealed）随之显现。
    ctl.setGraded();
    settleSlotsResult(host, q, ctl);
    checkAllDone(host);
}

/** 整题结果行（按 marks 现算；复核补账后重跑它把「有错」改写成全对）。 */
function settleSlotsResult(host: AnswerHost, q: WenguQuestion, ctl: CardCtl): void {
    const marks = ctl.ui.slots?.marks ?? [];
    const right = marks.filter((m) => m.ok).length;
    const allOk = marks.length > 0 && marks.every((m) => m.ok);
    ctl.setResult(
        esc(
            allOk
                ? host.t("correct")
                : host.t("slotsSummary").replace("{r}", String(right)).replace("{n}", String(marks.length))
        ),
        allOk ? "right" : "wrong"
    );
    if (allOk) markNum(host, q, true);
}
