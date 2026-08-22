import {
    appealMethodStep,
    nextRealtimeStep,
} from "./AiJudge";
import type {RealtimeHistoryItem} from "./AiJudge";
import type {AnswerHost} from "./AnswerFlow";
import {
    appealSessionResult,
    checkAllDone,
    markNum,
} from "./AnswerFlow";
import {
    fillOneStep,
    renderOneStepHtml,
    renderStepsInnerHtml,
} from "./CardHtml";
import {
    gradeStep,
    overrideStepsResult,
    recordStepsResult,
    stepOptionIsRight,
} from "./QuestionService";
import type {
    WenguQuestion,
    WenguStep,
} from "./types";
import {
    LETTERS,
    optionDisplayMd,
} from "./types";
import {
    esc,
    fmt,
    mmss,
} from "./ui";

/**
 * 多步引导题作答流程（type="steps"）：一张卡内逐步解锁——每步单选、
 * 即时判分反馈、解锁下一步；每步独立计入会话（qid#k），整题收口时
 * 写块属性（right=全步对 + 逐步 step-right/step-last）。
 *
 * 两种模式（开刷面板按轮选）：
 * - offline：作答转换时生成的静态参考路径（方法步可行集合任一即对）；
 * - ai：作答时 AiJudge 跟随用户选的方法逐步生成（较慢、可能出错，
 *   失败可一键切回离线静态步骤继续；实时步骤不落 step-* 属性）。
 *
 * 与 AnswerFlow 循环引用是安全的：双方只在事件回调里调用对方导出。
 */

/** 申诉复核通过的步序（按卡记忆）：收口统计按「复核通过即对」计。 */
const appealedSteps = new WeakMap<HTMLElement, Set<number>>();

function appealedSet(card: HTMLElement): Set<number> {
    let s = appealedSteps.get(card);
    if (!s) {
        s = new Set<number>();
        appealedSteps.set(card, s);
    }
    return s;
}

/** 绑定一张多步卡：填充步骤内容并按本轮模式走离线/实时。 */
export function bindStepsCard(host: AnswerHost, card: HTMLElement, q: WenguQuestion): void {
    if (card.dataset.stepsBound === "1") return;
    card.dataset.stepsBound = "1";
    if (host.currentSession()?.stepsMode === "ai") {
        startRealtime(host, card, q);
    } else {
        bindOffline(host, card, q);
    }
}

/** 给一步的选项行绑单选互斥（离线/实时共用）。 */
function bindStepSelect(stepEl: HTMLElement): void {
    for (const opt of stepEl.querySelectorAll<HTMLElement>(".wengu-step-opt")) {
        opt.addEventListener("click", () => {
            if (stepEl.dataset.graded === "1") return;
            stepEl.querySelectorAll(".wengu-step-opt").forEach((o) => o.classList.remove("wengu-step-selected"));
            opt.classList.add("wengu-step-selected");
        });
    }
}

/** 离线模式：填充步骤内容并绑定全部静态步骤（后续步随作答逐步解锁）。 */
function bindOffline(host: AnswerHost, card: HTMLElement, q: WenguQuestion): void {
    card.dataset.stepCur = "0";
    for (const stepEl of card.querySelectorAll<HTMLElement>("[data-step]")) {
        const k = Number(stepEl.dataset.step);
        const step = q.steps?.[k];
        if (step) fillOneStep(stepEl, step);
        bindStepSelect(stepEl);
        stepEl.querySelector("[data-act='step-next']")?.addEventListener(
            "click",
            () => void submitOfflineStep(host, card, q, stepEl, k),
        );
    }
}

/** 离线单步提交：判分 → 反馈 → 解锁下一步 / 整题收口。 */
async function submitOfflineStep(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    stepEl: HTMLElement,
    k: number,
): Promise<void> {
    if (stepEl.dataset.graded === "1" || card.dataset.graded === "1") return;
    const step = q.steps?.[k];
    const selected = stepEl.querySelector<HTMLElement>(".wengu-step-opt.wengu-step-selected");
    if (!step) return;
    if (!selected) {
        showStepResult(stepEl, esc(host.t("noAnswer")), false, true);
        return;
    }
    gradeAndShowStep(host, card, q, stepEl, step, k, selected.dataset.letter ?? "");
    const next = card.querySelector<HTMLElement>(`[data-step='${k + 1}']`);
    if (next) {
        next.removeAttribute("hidden");
        card.dataset.stepCur = String(k + 1);
        next.scrollIntoView({behavior: "smooth", block: "nearest"});
    } else {
        await finishFromDom(host, card, q, true);
    }
}

/** 单步判分与反馈（离线/实时共用）：记会话 + 选项描色 + 步结果行；
 *  method 步答错附「AI 复核」申诉按钮（可行集合可能标漏）。 */
function gradeAndShowStep(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    stepEl: HTMLElement,
    step: WenguStep,
    k: number,
    letter: string,
): boolean {
    const ok = gradeStep(step, letter);
    stepEl.dataset.graded = "1";
    stepEl.querySelectorAll("button").forEach((b) => (b as HTMLButtonElement).disabled = true);
    host.flushTime();
    host.recordAnswer(`${q.id}#${k}`, letter, ok);
    markStepOptions(step, stepEl, letter);
    showStepResult(
        stepEl,
        ok ?
            esc(host.t("correct")) :
            `${esc(host.t("wrong"))}${esc(host.t("answerLabel"))}${esc(stepAnswerLabel(host, step))}`,
        ok,
    );
    if (!ok && step.kind === "method") {
        const btn = document.createElement("button");
        btn.className = "wengu-btn wengu-step-appeal";
        btn.dataset.act = "step-appeal";
        btn.textContent = host.t("stepAppeal");
        stepEl.appendChild(btn);
        btn.addEventListener("click", () => void runMethodAppeal(host, card, q, stepEl, step, k, letter, btn));
    }
    return ok;
}

/** 方法步申诉：AI 独立复核所选方法可行性；通过则该步翻对并同步
 *  会话/块属性（已收口的卡就地重算整题结果）。 */
async function runMethodAppeal(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    stepEl: HTMLElement,
    step: WenguStep,
    k: number,
    letter: string,
    btn: HTMLButtonElement,
): Promise<void> {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = host.t("stepAppealing");
    const idx = LETTERS.indexOf(letter);
    const chosen = idx >= 0 && idx < step.optionMd.length ? optionDisplayMd(step.optionMd[idx]) : letter;
    try {
        const v = await appealMethodStep(q, step, chosen, host.aiModelId());
        const opt = stepEl.querySelector<HTMLElement>(`.wengu-step-opt[data-letter='${letter}']`);
        if (!v.feasible) {
            showStepResult(stepEl, `${esc(host.t("stepAppealRejected"))}${esc(v.comment)}`, false);
            opt?.classList.add("wengu-step-wrong");
            btn.remove();
            return;
        }
        appealedSet(card).add(k);
        appealSessionResult(host, `${q.id}#${k}`, true);
        opt?.classList.add("wengu-step-right");
        opt?.classList.remove("wengu-step-wrong");
        showStepResult(stepEl, `${esc(host.t("stepAppealOk"))}${esc(v.comment)}`, true);
        btn.remove();
        if (card.dataset.graded === "1") await refreshFinishedAppeal(host, card, q);
    } catch (e) {
        btn.disabled = false;
        btn.textContent = host.t("stepAppeal");
        showStepResult(
            stepEl,
            esc(`${host.t("aiJudgeFailed")}${String((e as Error)?.message ?? e)}`),
            false,
            true,
        );
    }
}

/** 已收口卡的申诉翻对：按收口快照 + 申诉集合重算整题并改判落盘。 */
async function refreshFinishedAppeal(host: AnswerHost, card: HTMLElement, q: WenguQuestion): Promise<void> {
    const baseline = (card.dataset.stepOks ?? "").split("").map((c) => c === "1");
    const appealed = appealedSet(card);
    const oks = baseline.map((ok, i) => ok || appealed.has(i));
    const letters: string[] = [];
    for (const stepEl of card.querySelectorAll<HTMLElement>("[data-step]")) {
        const sel = stepEl.querySelector<HTMLElement>(".wengu-step-opt.wengu-step-selected");
        letters.push(sel?.dataset.letter ?? "");
    }
    const allOk = oks.length > 0 && oks.every(Boolean);
    if (card.dataset.stepPersist !== "0") await overrideStepsResult(q, letters, oks);
    markNum(host, q, allOk);
    const firstWrong = oks.findIndex((ok) => !ok);
    showCardResult(
        card,
        allOk ? esc(host.t("stepAllCorrect")) : esc(fmt(host.t("stepWrongAt"), {n: String(firstWrong + 1)})),
        allOk,
    );
}

/** 整题收口（离线）：从卡片 DOM 收集各步作答后统一记账（申诉步按对计）。 */
async function finishFromDom(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    persistStepState: boolean,
): Promise<void> {
    if (card.dataset.graded === "1") return;
    const steps = q.steps ?? [];
    const appealed = appealedSet(card);
    const letters: string[] = [];
    const oks: boolean[] = [];
    for (const stepEl of card.querySelectorAll<HTMLElement>("[data-step]")) {
        const k = Number(stepEl.dataset.step);
        const sel = stepEl.querySelector<HTMLElement>(".wengu-step-opt.wengu-step-selected");
        const letter = sel?.dataset.letter ?? "";
        letters.push(letter);
        const step = steps[k];
        oks.push(letter && step ? (appealed.has(k) || gradeStep(step, letter)) : false);
    }
    await finishCard(host, card, q, letters, oks, persistStepState);
}

/** 整题收口（共用）：写块属性 + 整题结果行 + 题号描色 + 收口检查。
 *  收口快照（stepOks/stepPersist）留在卡片上，供申诉翻对后重算。 */
async function finishCard(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    letters: string[],
    oks: boolean[],
    persistStepState: boolean,
): Promise<void> {
    card.dataset.graded = "1";
    card.dataset.stepOks = oks.map((ok) => ok ? "1" : "0").join("");
    card.dataset.stepPersist = persistStepState ? "1" : "0";
    card.classList.add("wengu-graded");
    // 申诉按钮不锁：收口后仍可对答错的 method 步发起 AI 复核
    card.querySelectorAll("button:not(.wengu-step-appeal)").forEach((b) => (b as HTMLButtonElement).disabled = true);
    const allOk = oks.length > 0 && oks.every(Boolean);
    await recordStepsResult(q, letters, oks, persistStepState);
    markNum(host, q, allOk);
    const firstWrong = oks.findIndex((ok) => !ok);
    const wrongLabel = firstWrong >= 0 ?
        fmt(host.t("stepWrongAt"), {n: String(firstWrong + 1)}) :
        host.t("noAnswer");
    showCardResult(card, allOk ? esc(host.t("stepAllCorrect")) : esc(wrongLabel), allOk);
    const sec = host.timerController().questionSec(q.id);
    if (sec > 0) showCardNote(card, fmt(host.t("perQTime"), {t: mmss(sec)}));
    checkAllDone(host);
}

/** method 步揭示可行集合，result 步揭示正确答案。 */
function stepAnswerLabel(host: AnswerHost, step: WenguStep): string {
    return step.kind === "method" ? fmt(host.t("stepFeasibleLabel"), {s: step.answer}) : step.answer;
}

/** 选项行描色：正确（可行）项绿、误选红。 */
function markStepOptions(step: WenguStep, stepEl: HTMLElement, submitted: string): void {
    for (const opt of stepEl.querySelectorAll<HTMLElement>(".wengu-step-opt")) {
        const idx = LETTERS.indexOf(opt.dataset.letter ?? "");
        if (idx < 0) continue;
        if (stepOptionIsRight(step, idx)) {
            opt.classList.add("wengu-step-right");
        } else if (submitted.includes(LETTERS[idx])) {
            opt.classList.add("wengu-step-wrong");
        }
    }
}

/** 步结果行（data-step-result）。 */
function showStepResult(stepEl: HTMLElement, html: string, ok: boolean, warn = false): void {
    const el = stepEl.querySelector<HTMLElement>("[data-step-result]");
    if (!el) return;
    el.innerHTML = html;
    el.removeAttribute("hidden");
    el.className = `wengu-step-result ${warn ? "wengu-muted" : ok ? "wengu-right" : "wengu-wrong"}`;
}

/** 整题结果行（data-result）。 */
function showCardResult(card: HTMLElement, html: string, ok: boolean): void {
    const el = card.querySelector<HTMLElement>("[data-result]");
    if (!el) return;
    el.innerHTML = html;
    el.removeAttribute("hidden");
    el.className = `wengu-result ${ok ? "wengu-right" : "wengu-wrong"}`;
}

function showCardNote(card: HTMLElement, text: string): void {
    const el = card.querySelector<HTMLElement>("[data-note]");
    if (!el) return;
    el.textContent = text;
    el.removeAttribute("hidden");
}

function hideCardNote(card: HTMLElement): void {
    card.querySelector<HTMLElement>("[data-note]")?.setAttribute("hidden", "");
}

/* ── AI 实时模式 ── */

/** 实时模式：丢弃静态步骤，逐步向 AiJudge 要「下一步」。 */
function startRealtime(host: AnswerHost, card: HTMLElement, q: WenguQuestion): void {
    const box = card.querySelector<HTMLElement>("[data-steps]");
    if (!box) return;
    box.innerHTML = "";
    const history: RealtimeHistoryItem[] = [];
    void requestRealtimeStep(host, card, q, box, history, 0);
}

async function requestRealtimeStep(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    box: HTMLElement,
    history: RealtimeHistoryItem[],
    k: number,
): Promise<void> {
    if (card.dataset.graded === "1") return;
    showCardNote(card, host.t("aiStepLoading"));
    try {
        const r = await nextRealtimeStep(q, history, host.aiModelId());
        hideCardNote(card);
        if (r.done || !r.step) {
            await finishCard(host, card, q, history.map((h) => h.letter), history.map((h) => h.ok), false);
            return;
        }
        const step = r.step;
        const holder = document.createElement("div");
        holder.innerHTML = renderOneStepHtml(step, k, host.t);
        const node = holder.firstElementChild as HTMLElement;
        box.appendChild(node);
        fillOneStep(node, step);
        node.scrollIntoView({behavior: "smooth", block: "nearest"});
        bindStepSelect(node);
        node.querySelector("[data-act='step-next']")?.addEventListener(
            "click",
            () => void submitRealtimeStep(host, card, q, box, node, step, history, k),
        );
    } catch (e) {
        hideCardNote(card);
        showRealtimeError(host, card, q, box, String((e as Error)?.message ?? e));
    }
}

/** 实时单步提交：判分反馈后向 AI 要下一步；AI 判定 DONE 则收口。 */
async function submitRealtimeStep(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    box: HTMLElement,
    node: HTMLElement,
    step: WenguStep,
    history: RealtimeHistoryItem[],
    k: number,
): Promise<void> {
    if (node.dataset.graded === "1" || card.dataset.graded === "1") return;
    const selected = node.querySelector<HTMLElement>(".wengu-step-opt.wengu-step-selected");
    if (!selected) {
        showStepResult(node, esc(host.t("noAnswer")), false, true);
        return;
    }
    const letter = selected.dataset.letter ?? "";
    const idx = LETTERS.indexOf(letter);
    const chosen = idx >= 0 && idx < step.optionMd.length ? optionDisplayMd(step.optionMd[idx]) : "";
    const ok = gradeAndShowStep(host, card, q, node, step, k, letter);
    history.push({stem: step.stemMd, letter, chosen, ok});
    await requestRealtimeStep(host, card, q, box, history, k + 1);
}

/** 实时失败：报错 + 「切离线继续」（重建静态步骤从头作答；
 *  已产生的实时会话记录保留，离线重做会追加记录）。 */
function showRealtimeError(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    box: HTMLElement,
    message: string,
): void {
    if (box.querySelector("[data-rt-error]")) return;
    const err = document.createElement("div");
    err.className = "wengu-step-error";
    err.dataset.rtError = "1";
    err.innerHTML = `<span class="wengu-wrong">${esc(message)}</span>
    <button class="wengu-btn" data-act="rt-fallback">${esc(host.t("rtFallback"))}</button>`;
    box.appendChild(err);
    err.querySelector("[data-act='rt-fallback']")?.addEventListener("click", () => {
        err.remove();
        box.innerHTML = renderStepsInnerHtml(q, host.t);
        for (const stepEl of box.querySelectorAll<HTMLElement>("[data-step]")) {
            const step = q.steps?.[Number(stepEl.dataset.step)];
            if (step) fillOneStep(stepEl, step);
        }
        bindOffline(host, card, q);
    });
}

/* ── 恢复继续 ── */

/** 继续上轮时恢复多步卡：按 qid#k 结果逐步还原（完整则锁定收口）。
 *  事件绑定已在 bindStepsCard 完成，这里只恢复状态与进度。 */
export function restoreStepsCard(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    results: {k: number; submitted: string; ok: boolean;}[],
): void {
    const steps = q.steps ?? [];
    const byK = new Map(results.map((r) => [r.k, r] as const));
    let answered = 0;
    for (const stepEl of card.querySelectorAll<HTMLElement>("[data-step]")) {
        const k = Number(stepEl.dataset.step);
        const r = byK.get(k);
        const step = steps[k];
        if (!r || !step) {
            stepEl.setAttribute("hidden", "");
            continue;
        }
        answered++;
        stepEl.removeAttribute("hidden");
        stepEl.dataset.graded = "1";
        stepEl.querySelectorAll("button").forEach((b) => (b as HTMLButtonElement).disabled = true);
        stepEl
            .querySelector<HTMLElement>(`.wengu-step-opt[data-letter='${r.submitted}']`)
            ?.classList.add("wengu-step-selected");
        markStepOptions(step, stepEl, r.submitted);
        showStepResult(
            stepEl,
            r.ok ?
                esc(host.t("correct")) :
                `${esc(host.t("wrong"))}${esc(host.t("answerLabel"))}${esc(stepAnswerLabel(host, step))}`,
            r.ok,
        );
        card.dataset.stepCur = String(k + 1);
    }
    if (answered > 0 && answered >= steps.length) {
        card.dataset.graded = "1";
        card.classList.add("wengu-graded");
        const oks = results.map((r) => r.ok);
        const allOk = oks.every(Boolean);
        markNum(host, q, allOk);
        const firstWrong = oks.findIndex((ok) => !ok);
        showCardResult(
            card,
            allOk ? esc(host.t("stepAllCorrect")) : esc(fmt(host.t("stepWrongAt"), {n: String(firstWrong + 1)})),
            allOk,
        );
    } else {
        // 部分作答：解锁第一个未答步待续
        card.querySelector<HTMLElement>(`[data-step='${answered}']`)?.removeAttribute("hidden");
        card.dataset.stepCur = String(answered);
    }
}
