import { flushSync } from "svelte";
import { appealMethodStep, nextRealtimeStep } from "../service/AiJudge";
import type { RealtimeHistoryItem } from "../service/AiJudge";
import type { AnswerHost } from "./AnswerFlow";
import { appealSessionResult, checkAllDone } from "./AnswerFlow";
import { markNum } from "../render/FlowDom";
import { appendRealtimeStep, markStepOpts, resetStepsOffline, setStepResult, stepResultsOf } from "../render/CardState";
import type { CardCtl } from "../render/CardCtl";
import { gradeStep } from "../service/QuestionService";
import type { WenguQuestion, WenguStep } from "../../types";
import { LETTERS, optionDisplayMd } from "../../types";
import { esc, fmt, mmss } from "../../ui/shared";

/**
 * 多步引导题作答流程（type="steps"，6-4b 状态化）：一张卡内逐步解锁
 * ——每步单选、即时判分反馈、解锁下一步；每步独立计入会话（qid#k），
 * 整题收口时写块属性（right=全步对 + 逐步 step-right/step-last）。
 * 全部作答态在 CardUi.steps（离线初始态由 buildCardInit 预渲染，
 * AI 实时模式逐步 appendRealtimeStep 追加）。
 *
 * 两种模式（开刷面板按轮选）：
 * - offline：作答转换时生成的静态参考路径（方法步可行集合任一即对）；
 * - ai：作答时 AiJudge 跟随用户选的方法逐步生成（较慢、可能出错，
 *   失败可一键切回离线静态步骤继续；实时步骤不落 step-* 属性）。
 */

/** 申诉复核通过的步序（按卡记忆）：收口统计按「复核通过即对」计。 */
const appealedSteps = new WeakMap<CardCtl, Set<number>>();

function appealedSet(ctl: CardCtl): Set<number> {
    let s = appealedSteps.get(ctl);
    if (!s) {
        s = new Set<number>();
        appealedSteps.set(ctl, s);
    }
    return s;
}

/** AI 实时模式的随卡上下文（作答历史 + 逐步 step 原型，供判分）。 */
const rtCtx = new WeakMap<CardCtl, { history: RealtimeHistoryItem[]; steps: WenguStep[] }>();

/** 挂载分派（QuizCardApp onMount 调）：本轮 AI 实时模式且无已答
 *  步骤才跑实时——已有作答（继续上次/收卷后重渲染）一律离线渲染
 *  （实时会清空步骤区重问，20260828 二轮审查口径）。 */
export function bindStepsMode(host: AnswerHost, q: WenguQuestion, ctl: CardCtl): void {
    const answered = ctl.ui.steps?.some((s) => s.graded) ?? false;
    const answeredBefore = stepResultsOf(host.currentSession()?.results ?? [], q.id).length > 0;
    if (!answered && !answeredBefore && host.currentSession()?.stepsMode === "ai") startRealtime(host, q, ctl);
}

/** 步骤选项点选（互斥单选）。 */
export function pickStep(ctl: CardCtl, k: number, letter: string): void {
    const su = ctl.ui.steps?.[k];
    if (!su || su.graded || ctl.graded) return;
    su.selected = letter;
}

/** 「下一步」提交（组件统一入口，按 rtMode 分流离线/实时）。 */
export function nextStep(host: AnswerHost, q: WenguQuestion, ctl: CardCtl, k: number): Promise<void> {
    return ctl.ui.rtMode ? submitRealtimeStep(host, q, ctl, k) : submitOfflineStep(host, q, ctl, k);
}

/** 离线单步提交：判分 → 反馈 → 解锁下一步 / 整题收口。 */
async function submitOfflineStep(host: AnswerHost, q: WenguQuestion, ctl: CardCtl, k: number): Promise<void> {
    const step = q.steps?.[k];
    const su = ctl.ui.steps?.[k];
    if (!step || !su || su.graded || ctl.graded) return;
    if (!su.selected) {
        setStepResult(su, esc(host.t("noAnswer")), "wengu-muted");
        return;
    }
    gradeAndShowStep(host, q, ctl, step, k, su.selected);
    const next = ctl.ui.steps?.[k + 1];
    if (next) {
        next.hidden = false;
        ctl.ui.stepCur = k + 1;
        stepEl(ctl, k + 1)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
        await finishFromState(host, q, ctl, true);
    }
}

/** 单步判分与反馈（离线/实时共用）：记会话 + 选项描色 + 步结果行；
 *  method 步答错附「AI 复核」申诉按钮（可行集合可能标漏）。 */
function gradeAndShowStep(
    host: AnswerHost,
    q: WenguQuestion,
    ctl: CardCtl,
    step: WenguStep,
    k: number,
    letter: string
): boolean {
    const ok = gradeStep(step, letter);
    const su = ctl.ui.steps![k]!;
    su.graded = true;
    su.locked = true;
    su.ok = ok;
    host.flushTime();
    host.recordAnswer(`${q.id}#${k}`, letter, ok);
    markStepOpts(step, su, letter);
    setStepResult(
        su,
        ok
            ? esc(host.t("correct"))
            : `${esc(host.t("wrong"))}${esc(host.t("answerLabel"))}${esc(stepAnswerLabel(host, step))}`,
        ok ? "wengu-right" : "wengu-wrong"
    );
    if (!ok && step.kind === "method") su.appeal = "idle";
    return ok;
}

/** method 步申诉：AI 独立复核所选方法可行性；通过则该步翻对并同步
 *  会话/块属性（已收口的卡就地重算整题结果）。 */
export async function appealStep(host: AnswerHost, q: WenguQuestion, ctl: CardCtl, k: number): Promise<void> {
    const su = ctl.ui.steps?.[k];
    const step = q.steps?.[k];
    if (!su || !su.appeal || su.appeal === "busy" || !step) return;
    const letter = su.selected;
    su.appeal = "busy";
    const idx = LETTERS.indexOf(letter);
    const chosen = idx >= 0 && idx < step.optionMd.length ? optionDisplayMd(step.optionMd[idx]) : letter;
    try {
        const v = await appealMethodStep(q, step, chosen, host.aiModelId());
        const opt = su.opts.find((o) => o.letter === letter);
        if (!v.feasible) {
            setStepResult(su, `${esc(host.t("stepAppealRejected"))}${esc(v.comment)}`, "wengu-wrong");
            if (opt) opt.mark = 2;
            su.appeal = "";
            return;
        }
        appealedSet(ctl).add(k);
        appealSessionResult(host, `${q.id}#${k}`, true);
        if (opt) opt.mark = 1;
        setStepResult(su, `${esc(host.t("stepAppealOk"))}${esc(v.comment)}`, "wengu-right");
        su.appeal = "";
        if (ctl.graded) await refreshFinishedAppeal(host, q, ctl);
    } catch (e) {
        su.appeal = "idle";
        setStepResult(su, esc(`${host.t("aiJudgeFailed")}${String((e as Error)?.message ?? e)}`), "wengu-muted");
    }
}

/** 已收口卡的申诉翻对：按收口快照 + 申诉集合重算整题并改判落盘。 */
async function refreshFinishedAppeal(host: AnswerHost, q: WenguQuestion, ctl: CardCtl): Promise<void> {
    const baseline = ctl.ui.stepOks.split("").map((c) => c === "1");
    const appealed = appealedSet(ctl);
    const oks = baseline.map((ok, i) => ok || appealed.has(i));
    const letters = (ctl.ui.steps ?? []).map((su) => su.selected);
    const allOk = oks.length > 0 && oks.every(Boolean);
    if (ctl.ui.stepPersist) host.bankOverride?.(q.id, allOk, { kind: "steps", letters, oks });
    markNum(host, q, allOk);
    const firstWrong = oks.findIndex((ok) => !ok);
    ctl.setResult(
        esc(allOk ? host.t("stepAllCorrect") : fmt(host.t("stepWrongAt"), { n: String(firstWrong + 1) })),
        allOk ? "right" : "wrong"
    );
}

/** 整题收口（离线）：按步骤态收集作答后统一记账（申诉步按对计）。 */
async function finishFromState(
    host: AnswerHost,
    q: WenguQuestion,
    ctl: CardCtl,
    persistStepState: boolean
): Promise<void> {
    if (ctl.graded) return;
    const steps = q.steps ?? [];
    const appealed = appealedSet(ctl);
    const letters: string[] = [];
    const oks: boolean[] = [];
    for (const [k, su] of (ctl.ui.steps ?? []).entries()) {
        letters.push(su.selected);
        const step = steps[k];
        oks.push(su.selected && step ? appealed.has(k) || gradeStep(step, su.selected) : false);
    }
    await finishCard(host, q, ctl, letters, oks, persistStepState);
}

/** 整题收口（共用）：写块属性 + 整题结果行 + 题号描色 + 收口检查。
 *  收口快照（stepOks/stepPersist）留在卡态，供申诉翻对后重算；
 *  申诉按钮不锁（step.appeal 渲染不受 locked 影响）。 */
async function finishCard(
    host: AnswerHost,
    q: WenguQuestion,
    ctl: CardCtl,
    letters: string[],
    oks: boolean[],
    persistStepState: boolean
): Promise<void> {
    const ui = ctl.ui;
    ui.graded = true;
    ui.locked = true;
    ui.stepOks = oks.map((ok) => (ok ? "1" : "0")).join("");
    ui.stepPersist = persistStepState;
    for (const su of ui.steps ?? []) su.locked = true;
    const allOk = oks.length > 0 && oks.every(Boolean);
    host.bankMirror?.(q.id, letters.join(""), allOk, { kind: "steps", letters, oks, persist: persistStepState });
    markNum(host, q, allOk);
    const firstWrong = oks.findIndex((ok) => !ok);
    const wrongLabel = firstWrong >= 0 ? fmt(host.t("stepWrongAt"), { n: String(firstWrong + 1) }) : host.t("noAnswer");
    ctl.setResult(esc(allOk ? host.t("stepAllCorrect") : wrongLabel), allOk ? "right" : "wrong");
    const sec = host.timerController().questionSec(q.id);
    if (sec > 0) ctl.setNote(fmt(host.t("perQTime"), { t: mmss(sec) }));
    checkAllDone(host);
}

/** method 步揭示可行集合，result 步揭示正确答案。 */
function stepAnswerLabel(host: AnswerHost, step: WenguStep): string {
    return step.kind === "method" ? fmt(host.t("stepFeasibleLabel"), { s: step.answer }) : step.answer;
}

/** 一步的 DOM 节点（解锁滚动用；组件渲染后可查）。 */
function stepEl(ctl: CardCtl, k: number): HTMLElement | undefined {
    return ctl.el?.querySelector<HTMLElement>(`[data-step='${k}']`);
}

/* ── AI 实时模式 ── */

/** 实时模式：丢弃静态步骤，逐步向 AiJudge 要「下一步」。 */
function startRealtime(host: AnswerHost, q: WenguQuestion, ctl: CardCtl): void {
    ctl.ui.steps = [];
    ctl.ui.rtMode = true;
    rtCtx.set(ctl, { history: [], steps: [] });
    void requestRealtimeStep(host, q, ctl, 0);
}

async function requestRealtimeStep(host: AnswerHost, q: WenguQuestion, ctl: CardCtl, k: number): Promise<void> {
    if (ctl.graded) return;
    const ctx = rtCtx.get(ctl)!;
    ctl.setNote(host.t("aiStepLoading"));
    try {
        const r = await nextRealtimeStep(q, ctx.history, host.aiModelId());
        ctl.hideNote();
        if (r.done || !r.step) {
            await finishCard(
                host,
                q,
                ctl,
                ctx.history.map((h) => h.letter),
                ctx.history.map((h) => h.ok),
                false
            );
            return;
        }
        ctx.steps.push(r.step);
        appendRealtimeStep(ctl.ui, r.step, k, host.t);
        flushSync(); // 状态先落 DOM 再滚动（新步节点可查）
        stepEl(ctl, k)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
        ctl.hideNote();
        ctl.ui.rtError = String((e as Error)?.message ?? e);
    }
}

/** 实时单步提交：判分反馈后向 AI 要下一步；AI 判定 DONE 则收口。 */
async function submitRealtimeStep(host: AnswerHost, q: WenguQuestion, ctl: CardCtl, k: number): Promise<void> {
    const ctx = rtCtx.get(ctl)!;
    const su = ctl.ui.steps?.[k];
    const step = ctx.steps[k];
    if (!su || !step || su.graded || ctl.graded) return;
    if (!su.selected) {
        setStepResult(su, esc(host.t("noAnswer")), "wengu-muted");
        return;
    }
    const letter = su.selected;
    const idx = LETTERS.indexOf(letter);
    const chosen = idx >= 0 && idx < step.optionMd.length ? optionDisplayMd(step.optionMd[idx]) : "";
    gradeAndShowStep(host, q, ctl, step, k, letter);
    ctx.history.push({ stem: step.stemMd, letter, chosen, ok: su.ok });
    await requestRealtimeStep(host, q, ctl, k + 1);
}

/** 实时失败「切离线继续」：重建静态步骤从头作答（已产生的实时会话
 *  记录保留，离线重做会追加记录）。 */
export function rtFallback(host: AnswerHost, q: WenguQuestion, ctl: CardCtl): void {
    ctl.ui.rtMode = false;
    resetStepsOffline(q, ctl.ui, { t: host.t, interactive: ctl.interactive, locked: false });
}
