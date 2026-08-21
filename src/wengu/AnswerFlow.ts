import {
    isChoice,
    isObjective,
} from "./CardHtml";
import type {WenguSession} from "./HistoryStore";
import {
    optionIsRight,
    recordAttempt,
    recordAttemptResult,
} from "./QuestionService";
import type {TimerController} from "./TimerController";
import type {
    WenguQuestion,
    WenguRevealMode,
} from "./types";
import {
    LETTERS,
    QuestionType,
} from "./types";
import {
    esc,
    fmt,
    mmss,
} from "./ui";

/**
 * 作答流程（从 QuizView 拆出）：卡片事件绑定、提交判分、自评、
 * 恢复继续、即时/统一揭示、题号标记。DOM 只做展示，判定数据源是
 * 块属性（recordAttempt）+ 当前会话（host.recordAnswer）。
 */

/** AnswerFlow 需要的宿主能力（QuizView 实现这组薄接口）。 */
export interface AnswerHost {
    t(key: string): string;
    container(): HTMLElement;
    questions(): WenguQuestion[];
    currentRevealMode(): WenguRevealMode;
    timerController(): TimerController;
    currentSession(): WenguSession | undefined;
    /** 记入会话（含逐题秒数）并落库。 */
    recordAnswer(qid: string, submitted: string, ok: boolean): void;
    /** 本轮完成（全部作答或手动收卷）：显示总结报告。 */
    roundComplete(): void;
    flushTime(): void;
}

export function bindCardEvents(host: AnswerHost, card: HTMLElement, q: WenguQuestion): void {
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
    card.querySelector("[data-act='self-right']")?.addEventListener(
        "click",
        () => void selfGrade(host, q, card, true),
    );
    card.querySelector("[data-act='self-wrong']")?.addEventListener(
        "click",
        () => void selfGrade(host, q, card, false),
    );
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
        showResult(card, esc(host.t("noAnswer")), false, true);
        return;
    }
    const batch = host.currentRevealMode() === "after";
    card.dataset.graded = "1";
    lockInputs(card);
    host.flushTime();
    if (!objective) {
        // brief（或缺题型/答案属性的题）：不自动判分，揭示后自评；
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
        showResult(card, esc(host.t("answeredPending")), false, true);
        markNumAnswered(host, q);
        checkAllDone(host);
        return;
    }
    revealCard(host, card, q, {submitted, ok});
    showQTime(host, card, q.id);
    checkAllDone(host);
}

/** brief 自评：对错由用户判定，同样记账。 */
export async function selfGrade(
    host: AnswerHost,
    q: WenguQuestion,
    card: HTMLElement,
    correct: boolean,
): Promise<void> {
    const mine = readSubmitted(q, card);
    await recordAttemptResult(q.id, mine, correct);
    markNum(host, q, correct);
    host.recordAnswer(q.id, mine, correct);
    card.querySelector("[data-self]")?.setAttribute("hidden", "");
    showResult(card, correct ? esc(host.t("correct")) : esc(host.t("wrong")), correct);
    showQTime(host, card, q.id);
    checkAllDone(host);
}

/** 判分后提示本题用时（秒数在所有模式都记录，统一展示）。 */
function showQTime(host: AnswerHost, card: HTMLElement, qid: string): void {
    const sec = host.timerController().questionSec(qid);
    if (sec > 0) showNote(card, fmt(host.t("perQTime"), {t: mmss(sec)}));
}

/** 继续上轮时：把已答卡片恢复为锁定状态（已选/已填 + 判分揭示视展示模式）。 */
export function restoreAnsweredCards(host: AnswerHost): void {
    const s = host.currentSession();
    const list = host.questions();
    if (!s || s.results.length === 0) return;
    const byQid = new Map(s.results.map((r) => [r.qid, r] as const));
    const allDone = list.length > 0 && list.every((q) => byQid.has(q.id));
    const revealNow = host.currentRevealMode() === "instant" || allDone;
    for (const node of host.container().querySelectorAll<HTMLElement>(".wengu-card")) {
        const q = list.find((x) => x.id === node.dataset.qid);
        const r = q ? byQid.get(q.id) : undefined;
        if (!q || !r) continue;
        node.dataset.graded = "1";
        lockInputs(node);
        restoreSubmitted(q, node, r.submitted);
        if (revealNow) {
            revealCard(host, node, q, r);
        } else {
            showResult(node, esc(host.t("answeredPending")), false, true);
            markNumAnswered(host, q);
        }
    }
    if (allDone) void revealAll(host);
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

/** 单卡揭示：答案/解析展开 + 结果与 chip 描色 + 题号上色。 */
function revealCard(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    r: {submitted: string; ok: boolean;},
): void {
    card.classList.add("wengu-graded");
    markNum(host, q, r.ok);
    if (isObjective(q)) {
        markChips(q, card, r.submitted);
        showResult(
            card,
            r.ok ?
                esc(host.t("correct")) :
                `${esc(host.t("wrong"))}${esc(host.t("answerLabel"))}${esc(q.answer ?? "")}`,
            r.ok,
        );
    } else {
        card.querySelector("[data-self]")?.removeAttribute("hidden");
    }
}

/** 全部作答后收口：after 模式先统一揭示（revealAll 会再触发总结），
 *  instant 模式直接给总结报告。 */
function checkAllDone(host: AnswerHost): void {
    const cards = [...host.container().querySelectorAll<HTMLElement>(".wengu-card")];
    if (cards.length === 0 || cards.some((c) => c.dataset.graded !== "1")) return;
    if (host.currentRevealMode() === "after") void revealAll(host);
    else host.roundComplete();
}

/** 判分/自评后同步题号导航的对错标记。 */
function markNum(host: AnswerHost, q: WenguQuestion, ok: boolean): void {
    const n = host.questions().indexOf(q) + 1;
    const btn = host.container().querySelector<HTMLElement>(`.wengu-num[data-num="${n}"]`);
    if (!btn) return;
    btn.classList.remove("wengu-num-answered");
    btn.classList.toggle("wengu-num-right", ok);
    btn.classList.toggle("wengu-num-wrong", !ok);
}

/** after 模式：已作答但尚未揭示的题，题号只标「已答」不透对错。 */
function markNumAnswered(host: AnswerHost, q: WenguQuestion): void {
    const n = host.questions().indexOf(q) + 1;
    const btn = host.container().querySelector<HTMLElement>(`.wengu-num[data-num="${n}"]`);
    if (btn && !btn.classList.contains("wengu-num-right") && !btn.classList.contains("wengu-num-wrong")) {
        btn.classList.add("wengu-num-answered");
    }
}

/** 判分后标记字母 chip：答案项描绿，误选项描红。 */
function markChips(q: WenguQuestion, card: HTMLElement, submitted: string): void {
    if (!isChoice(q)) return;
    for (const chip of card.querySelectorAll<HTMLElement>(".wengu-chip")) {
        const idx = LETTERS.indexOf(chip.dataset.letter ?? "");
        if (idx < 0) continue;
        if (optionIsRight(q, idx)) {
            chip.classList.add("wengu-chip-right");
        } else if (submitted.includes(LETTERS[idx])) {
            chip.classList.add("wengu-chip-wrong");
        }
    }
}

function showResult(card: HTMLElement, html: string, ok: boolean, warn = false): void {
    const result = card.querySelector<HTMLElement>("[data-result]");
    if (!result) return;
    result.innerHTML = html;
    result.removeAttribute("hidden");
    result.classList.remove("wengu-right", "wengu-wrong", "wengu-muted");
    result.classList.add(warn ? "wengu-muted" : ok ? "wengu-right" : "wengu-wrong");
}

function showNote(card: HTMLElement, text: string): void {
    const note = card.querySelector<HTMLElement>("[data-note]");
    if (!note) return;
    note.textContent = text;
    note.removeAttribute("hidden");
}

/** 判分后锁定作答位（chip/输入靠 dataset.graded 拦截点击）。 */
function lockInputs(card: HTMLElement): void {
    card.querySelectorAll("input, textarea, button[data-act='submit'], [data-judge], .wengu-chip").forEach((n) => {
        (n as HTMLButtonElement).disabled = true;
    });
}
