import { judgeBrief } from "../service/AiJudge";
import { isChoice, isObjective } from "../render/CardHtml";
import { statusIcon } from "../../ui/FormHtml";
import type { WenguSession, WenguSessionResult } from "../service/HistoryStore";
import { syncGroupReveal } from "./MaterialFlow";
import { optionIsRight, overrideAttemptResult, recordAttempt, recordAttemptResult } from "../service/QuestionService";
import { markNum, paintOptions, showNote } from "../render/FlowDom";
import { markNumRailAnswered } from "../render/NumRail";
import { bindSlotsCard, restoreSlotsCard } from "./SlotFlow";
import { bindStepsCard, restoreStepsCard } from "./StepsFlow";
import type { TimerController } from "../service/TimerController";
import type { WenguQuestion, WenguRevealMode } from "../../types";
import { hasSlots, hasSteps, isBriefLike, QuestionType } from "../../types";
import { esc, fmt, mmss } from "../../ui/shared";

/**
 * 作答流程（从 QuizView 拆出）：卡片事件绑定、提交判分、自评、
 * 恢复继续、即时/统一揭示、题号标记。DOM 只做展示，判定数据源是
 * 块属性（recordAttempt）+ 当前会话（host.recordAnswer）。
 * 多步引导题（steps）与 brief 的 AI 判分分别委派给 StepsFlow/AiJudge。
 */

/** AnswerFlow 需要的宿主能力（QuizView 实现这组薄接口）。 */
export interface AnswerHost {
    t(key: string): string;
    container(): HTMLElement;
    questions(): WenguQuestion[];
    currentRevealMode(): WenguRevealMode;
    timerController(): TimerController;
    currentSession(): WenguSession | undefined;
    /** AI 判分/实时引导使用的模型 id（空=智能体默认）。 */
    aiModelId(): string;
    /** 记入会话（含逐题秒数）并落库；extra 携带 brief 的 AI 三态/评语/错因。 */
    recordAnswer(
        qid: string,
        submitted: string,
        ok: boolean,
        extra?: { verdict?: "right" | "partial" | "wrong"; comment?: string; cause?: string }
    ): void;
    /** 整题收口镜像（steps/slots）：题库按整题记一次（可选，QuizView 提供）。 */
    bankMirror?(qid: string, submitted: string, ok: boolean): void;
    /** 本轮完成（全部作答或手动收卷）：显示总结报告。 */
    roundComplete(): void;
    flushTime(): void;
}

export function bindCardEvents(host: AnswerHost, card: HTMLElement, q: WenguQuestion): void {
    // 「思路」折叠开关：普通题/steps 题通用
    card.querySelector("[data-act='thought-toggle']")?.addEventListener("click", () => {
        card.querySelector("[data-thought-wrap]")?.toggleAttribute("hidden");
    });
    if (hasSteps(q)) {
        bindStepsCard(host, card, q);
        return;
    }
    if (hasSlots(q)) {
        bindSlotsCard(host, card, q);
        return;
    }
    // 作文：实时词数（E3）
    const mine = card.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-field='mine']");
    const wc = card.querySelector<HTMLElement>("[data-wordcount]");
    if (mine && wc) {
        mine.addEventListener("input", () => {
            const words = mine.value.trim() ? mine.value.trim().split(/\s+/).length : 0;
            wc.textContent = `${words} words`;
        });
    }
    if (isChoice(q)) {
        for (const chip of card.querySelectorAll<HTMLElement>(".wengu-chip")) {
            chip.addEventListener("click", () => toggleChip(q, card, chip));
        }
    }
    for (const btn of card.querySelectorAll<HTMLElement>("[data-judge]")) {
        btn.addEventListener("click", () => {
            card.querySelectorAll("[data-judge]").forEach((b) => b.classList.remove("wengu-selected"));
            btn.classList.add("wengu-selected");
            card.dataset.judge = btn.dataset.judge ?? "";
        });
    }
    card.querySelector("[data-act='submit']")?.addEventListener("click", () => void submitQuestion(host, q, card));
    // 自评按钮：brief 经 AI 判分后语义变为「改判」（appealGrade）
    const selfHandler =
        (correct: boolean): (() => void) =>
        () => {
            void (card.dataset.aiJudged === "1"
                ? appealGrade(host, q, card, correct)
                : selfGrade(host, q, card, correct));
        };
    card.querySelector("[data-act='self-right']")?.addEventListener("click", selfHandler(true));
    card.querySelector("[data-act='self-wrong']")?.addEventListener("click", selfHandler(false));
}

/** 字母 chip 点选：单选互斥，多选可增删。 */
function toggleChip(q: WenguQuestion, card: HTMLElement, chip: HTMLElement): void {
    if (card.dataset.graded === "1") return;
    if (q.type === QuestionType.Single) {
        card.querySelectorAll(".wengu-chip").forEach((c) => c.classList.remove("wengu-chip-selected"));
        chip.classList.add("wengu-chip-selected");
    } else {
        chip.classList.toggle("wengu-chip-selected");
    }
}

/** 从卡片 DOM 读出本次作答串（字母串 / √× / 文本）。 */
export function readSubmitted(q: WenguQuestion, card: HTMLElement): string {
    const field = card.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-field='mine']");
    if (field) return field.value.trim();
    if (q.type === QuestionType.Judge) return card.dataset.judge ?? "";
    if (isChoice(q)) {
        return [...card.querySelectorAll<HTMLElement>(".wengu-chip.wengu-chip-selected")]
            .map((c) => c.dataset.letter ?? "")
            .sort()
            .join("");
    }
    return "";
}

export async function submitQuestion(host: AnswerHost, q: WenguQuestion, card: HTMLElement): Promise<void> {
    if (card.dataset.graded === "1") return;
    const objective = isObjective(q);
    const submitted = readSubmitted(q, card);
    if (objective && !submitted) {
        showResult(card, esc(host.t("noAnswer")), "warn");
        return;
    }
    const batch = host.currentRevealMode() === "after";
    card.dataset.graded = "1";
    lockInputs(card);
    host.flushTime();
    if (!objective) {
        // brief（含英语 essay/trans）：AI 判分并计入（AI 不可用回落自评）；
        // 多步题在 StepsFlow，缺题型/答案属性的题维持自评（cloze/match
        // 的逐空作答是 E2，E0 先走这条自评降级）。after 模式判分照跑，
        // 揭示时只展示评语。
        if (isBriefLike(q) && submitted) {
            await judgeBriefAnswer(host, q, card, submitted, batch);
            return;
        }
        // 缺题型/答案属性的题：不自动判分，揭示后自评；
        // after 模式下自评也等统一揭示
        if (batch) {
            markNumAnswered(host, q);
            checkAllDone(host);
            return;
        }
        card.classList.add("wengu-graded");
        card.querySelector("[data-self]")?.removeAttribute("hidden");
        return;
    }
    const ok = await recordAttempt(q, submitted);
    host.recordAnswer(q.id, submitted, ok);
    if (batch) {
        // 统一展示：先只记「已作答」，不揭对错（避免剧透）
        showResult(card, esc(host.t("answeredPending")), "warn");
        markNumAnswered(host, q);
        checkAllDone(host);
        return;
    }
    revealCard(host, card, q, { submitted, ok });
    showQTime(host, card, q.id);
    checkAllDone(host);
}

/** brief 自评：对错由用户判定，同样记账。 */
export async function selfGrade(
    host: AnswerHost,
    q: WenguQuestion,
    card: HTMLElement,
    correct: boolean
): Promise<void> {
    const mine = readSubmitted(q, card);
    await recordAttemptResult(q.id, mine, correct);
    markNum(host, q, correct);
    host.recordAnswer(q.id, mine, correct);
    card.querySelector("[data-self]")?.setAttribute("hidden", "");
    card.classList.add("wengu-graded");
    showResult(card, correct ? esc(host.t("correct")) : esc(host.t("wrong")), correct ? "right" : "wrong");
    showQTime(host, card, q.id);
    syncGroupReveal(host.container(), host.questions());
    checkAllDone(host);
}

/** brief 提交：AI 判分并计入（串行队列），结果行显示评语，保留改判；
 *  AI 失败/超时回落纯自评。 */
async function judgeBriefAnswer(
    host: AnswerHost,
    q: WenguQuestion,
    card: HTMLElement,
    submitted: string,
    batch: boolean
): Promise<void> {
    card.dataset.graded = "1";
    lockInputs(card);
    host.flushTime();
    if (!batch) showResult(card, esc(host.t("aiJudging")), "warn");
    try {
        // 「思路」折叠区若填了内容，一并交给 AI（判 partial 的重要素材）
        const thought = card.querySelector<HTMLTextAreaElement>("[data-field='thought']")?.value.trim() ?? "";
        const v = await judgeBrief(q, submitted, host.aiModelId(), thought);
        card.dataset.aiJudged = "1";
        card.dataset.aiVerdict = v.verdict;
        await recordAttemptResult(q.id, submitted, v.ok);
        host.recordAnswer(q.id, submitted, v.ok, { verdict: v.verdict, comment: v.comment, cause: v.cause });
        const commentEl = card.querySelector<HTMLElement>("[data-ai-comment]");
        if (commentEl && v.comment) commentEl.textContent = v.comment;
        if (batch) {
            markNumAnswered(host, q);
            checkAllDone(host);
            return;
        }
        card.classList.add("wengu-graded");
        markNum(host, q, v.ok);
        showResult(card, briefResultHtml(host, v.verdict), verdictStatus(v.verdict));
        revealBriefExtras(host, card);
        showQTime(host, card, q.id);
        checkAllDone(host);
    } catch (e) {
        if (batch) {
            // AI 失败不再静默丢账（原只记号收卷，该题不进会话、收卷统计
            // 少一题、AI 报告当未答）——提示 + 露自评钮补账，20260828 二轮
            showNote(card, `${host.t("aiJudgeFailed")}${String((e as Error)?.message ?? e)}`);
            card.querySelector("[data-self]")?.removeAttribute("hidden");
            markNumAnswered(host, q);
            checkAllDone(host);
            return;
        }
        card.classList.add("wengu-graded");
        showNote(card, `${host.t("aiJudgeFailed")}${String((e as Error)?.message ?? e)}`);
        card.querySelector("[data-self]")?.removeAttribute("hidden");
    }
}

/** 揭示 brief 的评语与改判按钮（即时判分与统一揭示共用）。 */
function revealBriefExtras(host: AnswerHost, card: HTMLElement): void {
    const comment = card.querySelector<HTMLElement>("[data-ai-comment]");
    if (comment?.textContent) comment.removeAttribute("hidden");
    const self = card.querySelector<HTMLElement>("[data-self]");
    if (self) {
        self.removeAttribute("hidden");
        const label = self.querySelector("span");
        if (label) label.textContent = host.t("rejudgeHint");
    }
}

/** 会话结果原位改判（brief 改判 / steps 方法步申诉共用）：
 *  只翻该条 ok 并调整 correct 计数，不动 answered/attempts；
 *  brief 的三态标记随改判同步。 */
export function appealSessionResult(host: AnswerHost, qid: string, correct: boolean): void {
    const s = host.currentSession();
    const r = s?.results.find((x) => x.qid === qid);
    if (s && r && r.ok !== correct) {
        r.ok = correct;
        s.correct = Math.max(0, s.correct + (correct ? 1 : -1));
    }
    if (r?.verdict) r.verdict = correct ? "right" : "wrong";
}

/** brief 改判（AI 误判纠错）：翻块属性 right、微调 wrong-count，
 *  会话结果原位改写（不动 attempts/answered）。 */
async function appealGrade(host: AnswerHost, q: WenguQuestion, card: HTMLElement, correct: boolean): Promise<void> {
    await overrideAttemptResult(q.id, correct);
    appealSessionResult(host, q.id, correct);
    markNum(host, q, correct);
    card.querySelector("[data-self]")?.setAttribute("hidden", "");
    showResult(card, correct ? esc(host.t("correct")) : esc(host.t("wrong")), correct ? "right" : "wrong");
}

/** 判分后提示本题用时（秒数在所有模式都记录，统一展示）。 */
function showQTime(host: AnswerHost, card: HTMLElement, qid: string): void {
    const sec = host.timerController().questionSec(qid);
    if (sec > 0) showNote(card, fmt(host.t("perQTime"), { t: mmss(sec) }));
}

/** 继续上轮时：把已答卡片恢复为锁定状态（已选/已填 + 判分揭示视展示模式）。
 *  root 限定恢复范围——静态分片管线逐单元就地恢复（分片窗口内已答题
 *  呈现未答外观可重复提交）；allDone 触发的统一揭示只在全量恢复时收口，
 *  逐单元调用不提前出报告（幂等，重复执行无害）。 */
export function restoreAnsweredCards(host: AnswerHost, root?: HTMLElement): void {
    const s = host.currentSession();
    const list = host.questions();
    if (!s || s.results.length === 0) return;
    const byQid = new Map(s.results.map((r) => [r.qid, r] as const));
    const allDone =
        list.length > 0 &&
        list.every((q) =>
            hasSteps(q)
                ? stepResultsOf(s.results, q.id).length >= (q.steps?.length ?? Number.POSITIVE_INFINITY)
                : hasSlots(q)
                  ? s.results.some((r) => r.qid.startsWith(`${q.id}#`)) &&
                    slotResultsOf(s.results, q.id).length >= (q.slots?.length ?? 0)
                  : byQid.has(q.id)
        );
    const revealNow = host.currentRevealMode() === "instant" || allDone;
    for (const node of (root ?? host.container()).querySelectorAll<HTMLElement>(".wengu-card")) {
        const q = list.find((x) => x.id === node.dataset.qid);
        if (!q) continue;
        if (hasSteps(q)) {
            // 多步卡按 qid#k 逐步还原（完整则锁定收口，部分则待续）
            restoreStepsCard(host, node, q, stepResultsOf(s.results, q.id));
            continue;
        }
        if (hasSlots(q)) {
            // slots 卡按 qid#k 逐空还原（整题口径在 restoreSlotsCard 内收口）
            const slotResults = slotResultsOf(s.results, q.id);
            if (slotResults.length > 0) restoreSlotsCard(host, node, q, slotResults);
            continue;
        }
        const r = byQid.get(q.id);
        if (!r) continue;
        node.dataset.graded = "1";
        lockInputs(node);
        restoreSubmitted(q, node, r.submitted);
        if (revealNow) {
            revealCard(host, node, q, r);
        } else {
            showResult(node, esc(host.t("answeredPending")), "warn");
            markNumAnswered(host, q);
        }
    }
    if (allDone && !root) void revealAll(host);
}

/** 某 slots 题在会话里的逐空结果（原样传给 restoreSlotsCard）。 */
function slotResultsOf(results: WenguSessionResult[], qid: string): WenguSessionResult[] {
    const prefix = `${qid}#`;
    return results.filter((r) => r.qid.startsWith(prefix) && /^\d+$/.test(r.qid.slice(prefix.length)));
}

/** 某多步题在会话里的逐步结果（按步序排列）。 */
function stepResultsOf(
    results: { qid: string; submitted: string; ok: boolean }[],
    qid: string
): { k: number; submitted: string; ok: boolean }[] {
    const prefix = `${qid}#`;
    return results
        .filter((r) => r.qid.startsWith(prefix) && /^\d+$/.test(r.qid.slice(prefix.length)))
        .map((r) => ({ k: Number(r.qid.slice(prefix.length)), submitted: r.submitted, ok: r.ok }))
        .sort((a, b) => a.k - b.k);
}

/** 把某题的作答状态写回卡片 DOM（chip 选中/判断按钮/输入值）。 */
function restoreSubmitted(q: WenguQuestion, card: HTMLElement, submitted: string): void {
    if (isChoice(q)) {
        for (const ch of card.querySelectorAll<HTMLElement>(".wengu-chip")) {
            if (submitted.includes(ch.dataset.letter ?? "")) ch.classList.add("wengu-chip-selected");
        }
    } else if (q.type === QuestionType.Judge) {
        card.dataset.judge = submitted;
        card.querySelector(`[data-judge='${submitted}']`)?.classList.add("wengu-selected");
    } else {
        const field = card.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-field='mine']");
        if (field) field.value = submitted;
    }
}

/** after 模式全部作答完后统一揭示：判分、chip 描色、答案解析、总结。 */
export async function revealAll(host: AnswerHost): Promise<void> {
    const s = host.currentSession();
    const list = host.questions();
    const byQid = new Map((s?.results ?? []).map((r) => [r.qid, r] as const));
    for (const node of host.container().querySelectorAll<HTMLElement>(".wengu-card")) {
        const q = list.find((x) => x.id === node.dataset.qid);
        if (!q) continue;
        const r = byQid.get(q.id);
        if (r) {
            revealCard(host, node, q, r);
        } else if (!isObjective(q)) {
            // after 模式下已提交但未自评的简答题：揭示后补自评
            node.querySelector("[data-self]")?.removeAttribute("hidden");
        }
    }
    host.roundComplete();
}

/** 单卡揭示：答案/解析展开 + 结果与 chip 描色 + 题号上色。
 *  brief 按 AI 三态展示（partial 单列），恢复/统一揭示时从会话结果
 *  取 verdict 与评语。 */
function revealCard(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    r: { submitted: string; ok: boolean; verdict?: string; comment?: string }
): void {
    card.classList.add("wengu-graded");
    markNum(host, q, r.ok);
    if (isObjective(q)) {
        markChips(q, card, r.submitted);
        showResult(
            card,
            r.ok
                ? esc(host.t("correct"))
                : `${esc(host.t("wrong"))}${esc(host.t("answerLabel"))}${esc(q.answer ?? "")}`,
            r.ok ? "right" : "wrong"
        );
    } else {
        // brief：结果行按三态（恢复时 dataset 丢失则用会话 verdict 兜底）
        const verdict = card.dataset.aiVerdict ?? r.verdict ?? (r.ok ? "right" : "wrong");
        if (r.comment) {
            const commentEl = card.querySelector<HTMLElement>("[data-ai-comment]");
            if (commentEl && !commentEl.textContent) commentEl.textContent = r.comment;
        }
        showResult(card, briefResultHtml(host, verdict), verdictStatus(verdict));
        revealBriefExtras(host, card);
    }
    // 材料组：组内题目全部判分后揭示共享材料的译文（E0 防剧透规则）
    syncGroupReveal(host.container(), host.questions());
}

/** 全部作答后收口：after 模式先统一揭示（revealAll 会再触发总结），
 *  instant 模式直接给总结报告。StepsFlow 完成多步卡后也走这里。 */
export function checkAllDone(host: AnswerHost): void {
    const cards = [...host.container().querySelectorAll<HTMLElement>(".wengu-card")];
    if (cards.length === 0 || cards.some((c) => c.dataset.graded !== "1")) return;
    if (host.currentRevealMode() === "after") void revealAll(host);
    else host.roundComplete();
}

/** after 模式：已作答但尚未揭示的题，题号只标「已答」不透对错
 *  （写进题号栏组件响应态，Svelte 化 20260830 收口三写之一）。 */
function markNumAnswered(host: AnswerHost, q: WenguQuestion): void {
    markNumRailAnswered(host.questions().indexOf(q) + 1);
}

/** 判分后标记字母 chip：答案项描绿，误选项描红。 */
function markChips(q: WenguQuestion, card: HTMLElement, submitted: string): void {
    if (!isChoice(q)) return;
    paintOptions(
        card,
        ".wengu-chip",
        (idx) => optionIsRight(q, idx),
        submitted,
        "wengu-chip-right",
        "wengu-chip-wrong"
    );
}

/** 结果行状态：partial=brief 方向对但有缺口（统计记错，展示单列）。 */
type ResultStatus = "right" | "wrong" | "partial" | "warn";

/** brief 三态的结果行文案。 */
function briefResultHtml(host: AnswerHost, verdict: string): string {
    if (verdict === "right") return esc(host.t("correct"));
    if (verdict === "partial") return esc(host.t("verdictPartial"));
    return esc(host.t("wrong"));
}

function verdictStatus(verdict: string): ResultStatus {
    return verdict === "right" ? "right" : verdict === "partial" ? "partial" : "wrong";
}

function showResult(card: HTMLElement, html: string, status: ResultStatus): void {
    const result = card.querySelector<HTMLElement>("[data-result]");
    if (!result) return;
    result.innerHTML = (status === "warn" ? "" : statusIcon(status)) + html;
    result.removeAttribute("hidden");
    result.classList.remove("wengu-right", "wengu-wrong", "wengu-muted", "wengu-partial");
    result.classList.add(status === "warn" ? "wengu-muted" : `wengu-${status}`);
}

/** 判分后锁定作答位（chip/输入靠 dataset.graded 拦截点击）。 */
function lockInputs(card: HTMLElement): void {
    card.querySelectorAll("input, textarea, button[data-act='submit'], [data-judge], .wengu-chip").forEach((n) => {
        (n as HTMLButtonElement).disabled = true;
    });
}
