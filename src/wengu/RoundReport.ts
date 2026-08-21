import {agentChat} from "./AgentClient";
import type {WenguSession} from "./HistoryStore";
import type {TimerController} from "./TimerController";
import type {WenguQuestion} from "./types";
import {
    esc,
    fmt,
    mmss,
} from "./ui";

/**
 * 一轮完成后的总结报告（纯 CSS 条形图，不引图表库）：
 * 总用时/得分摘要 + 每题用时图 + 历史轮次得分图 + AI 分析报告
 * （走 AgentClient，同一智能体端点）。
 */

/** AI 分析超时（毫秒）。 */
const REPORT_TIMEOUT_MS = 120_000;

export interface RoundReportModel {
    t: (key: string) => string;
    /** 本轮会话（已收卷或即将收卷的快照）。 */
    session: WenguSession;
    /** 本轮题目（含未答的，按顺序给图条标签）。 */
    list: WenguQuestion[];
    /** 该文档全部历史轮次（含本轮）。 */
    rounds: WenguSession[];
    /** 报告显示的用时（秒，通常 = 会话 elapsedSec 快照）。 */
    totalSec: number;
    /** 倒计时超时段（秒，非倒计时报 0）。 */
    overtimeSec: number;
}

export function renderRoundReport(m: RoundReportModel): string {
    const {t, session: s, list, rounds} = m;
    const byQid = new Map(s.results.map((r) => [r.qid, r] as const));
    // 每题用时条形图：高度 ∝ 秒数，对错描色，未答灰色
    const maxSec = Math.max(1, ...list.map((q) => byQid.get(q.id)?.sec ?? 0));
    const timeBars = list
        .map((q, i) => {
            const r = byQid.get(q.id);
            const sec = r?.sec ?? 0;
            const h = Math.max(4, Math.round((sec / maxSec) * 100));
            const cls = !r ? "wengu-bar-muted" : r.ok ? "wengu-bar-right" : "wengu-bar-wrong";
            const title = fmt(t("reportQTime"), {n: String(i + 1), t: mmss(sec)}) +
                (r ? (r.ok ? ` · ${t("correct")}` : ` · ${t("wrong")}`) : ` · ${t("reportUnanswered")}`);
            return `<div class="wengu-bar-col" title="${esc(title)}">
  <div class="wengu-bar ${cls}" style="height:${h}%"></div>
  <span class="wengu-bar-label">${i + 1}</span>
</div>`;
        })
        .join("");
    // 历史轮次得分条形图：高度 ∝ 正确率
    const scoreBars = rounds
        .map((r, i) => {
            const rate = r.answered > 0 ? r.correct / r.answered : 0;
            const h = Math.max(4, Math.round(rate * 100));
            const title = fmt(t("reportRoundScore"), {n: String(i + 1), c: String(r.correct), a: String(r.answered)});
            return `<div class="wengu-bar-col" title="${esc(title)}">
  <div class="wengu-bar wengu-bar-score" style="height:${h}%"></div>
  <span class="wengu-bar-label">${i + 1}</span>
</div>`;
        })
        .join("");
    const overtime = m.overtimeSec > 0 ?
        `<span class="wengu-meta">+${mmss(m.overtimeSec)} ${esc(t("reportOvertime"))}</span>` :
        "";
    return `<div class="wengu-report" data-report>
  <div class="wengu-start-title">${esc(t("reportTitle"))}</div>
  <div class="wengu-report-summary">
    <span class="wengu-meta">${esc(fmt(t("reportScore"), {c: String(s.correct), a: String(s.answered)}))}</span>
    <span class="wengu-meta">⏱ ${esc(mmss(m.totalSec))}</span>
    ${overtime}
  </div>
  <div class="wengu-report-chart">
    <div class="wengu-report-label">${esc(t("reportTimeChart"))}</div>
    <div class="wengu-bars">${timeBars}</div>
  </div>
  ${
        rounds.length > 0 ?
            `<div class="wengu-report-chart">
    <div class="wengu-report-label">${esc(t("reportScoreChart"))}</div>
    <div class="wengu-bars">${scoreBars}</div>
  </div>` :
            ""
    }
  <div>
    <button class="b3-button b3-button--text" data-act="ai-report">${esc(t("reportAiBtn"))}</button>
  </div>
  <div class="wengu-report-ai" data-ai hidden></div>
</div>`;
}

/** 绑定 AI 报告按钮（点击 → 加载态 → 展示分析文本）。 */
export function bindRoundReport(root: HTMLElement, m: RoundReportModel, modelId: string): void {
    const btn = root.querySelector<HTMLButtonElement>("[data-act='ai-report']");
    const out = root.querySelector<HTMLElement>("[data-ai]");
    if (!btn || !out) return;
    btn.addEventListener("click", () => void run(btn, out, m, modelId));
}

async function run(
    btn: HTMLButtonElement,
    out: HTMLElement,
    m: RoundReportModel,
    modelId: string,
): Promise<void> {
    btn.disabled = true;
    out.textContent = m.t("reportAiLoading");
    out.removeAttribute("hidden");
    try {
        const text = await agentChat(buildAnalysisPrompt(m), modelId, REPORT_TIMEOUT_MS);
        out.textContent = text.trim() || m.t("convertEmptyReply");
    } catch (e) {
        out.textContent = `${m.t("convertAiFailed")}${String((e as Error)?.message ?? e)}`;
    } finally {
        btn.disabled = false;
    }
}

/** 把一轮数据交给 AI 出简短分析（总体/薄弱点/用时异常/建议）。 */
function buildAnalysisPrompt(m: RoundReportModel): string {
    const {session: s, list, rounds} = m;
    const byQid = new Map(s.results.map((r) => [r.qid, r] as const));
    const perQ = list
        .map((q, i) => {
            const r = byQid.get(q.id);
            const label = q.knowledge || q.chapter || String(i + 1);
            return r ? `${i + 1}. ${label} ${r.ok ? "对" : "错"} ${r.sec ?? 0}s` : `${i + 1}. ${label} 未答`;
        })
        .join("；");
    const history = rounds.map((r, i) => `第${i + 1}轮 ${r.correct}/${r.answered}`).join("；");
    const overtime = m.overtimeSec > 0 ? `；超时 ${mmss(m.overtimeSec)}` : "";
    return `你是刷题分析助手。根据下面的一轮刷题数据给出简短分析报告，不超过 150 字，分三行：总体评价；薄弱知识点与明显偏慢的题（指出题号）；下一轮建议。
本轮：作答 ${s.answered}/${list.length}，答对 ${s.correct}；计时方式 ${s.mode}；总用时 ${mmss(m.totalSec)}${overtime}
每题：${perQ}
历史轮次：${history}
只输出报告正文，不要客套。`;
}

/** 倒计时归零的选择条：「继续作答」（转超时正计时）或「结束本轮」。 */
export function showTimeUpChoice(
    slot: HTMLElement,
    t: (k: string) => string,
    handlers: {onOvertime: () => void; onFinish: () => void;},
): void {
    slot.innerHTML = `<div class="wengu-timeup">
  <span>⏰ ${esc(t("timeUpShort"))}</span>
  <button class="b3-button b3-button--text" data-act="overtime">${esc(t("continueAnswer"))}</button>
  <button class="b3-button b3-button--cancel" data-act="finish-round">${esc(t("finishRound"))}</button>
</div>`;
    const clear = () => (slot.innerHTML = "");
    slot.querySelector("[data-act='overtime']")?.addEventListener("click", () => {
        clear();
        handlers.onOvertime();
    });
    slot.querySelector("[data-act='finish-round']")?.addEventListener("click", () => {
        clear();
        handlers.onFinish();
    });
}

/** 收卷/报告编排所需的视图能力（QuizView 提供薄实现）。 */
export interface RoundFinishCtx {
    el: HTMLElement;
    t: (k: string) => string;
    list: WenguQuestion[];
    rounds: WenguSession[];
    session?: WenguSession;
    finished?: WenguSession;
    timer: TimerController;
    revealMode: "instant" | "after";
    /** AI 报告使用的模型 id（空=智能体默认）。 */
    aiModelId: string;
    /** 收卷：落库、置 finished、清 session（视图实现）。 */
    finishSession(): void;
    /** after 模式手动收卷时揭示已答部分。 */
    revealAnswered(): void;
    /** 停走秒并刷新头部标签。 */
    stopRound(): void;
    /** 锁定全部作答位。 */
    lockAllCards(): void;
}

function roundsWithCurrent(rounds: WenguSession[], cur?: WenguSession): WenguSession[] {
    return cur && !rounds.some((x) => x.id === cur.id) ? [...rounds, cur] : rounds;
}

/** 一轮完成：收卷 + 渲染总结报告（总用时/用时图/得分图 + AI 分析入口）。 */
export function showRoundReportNow(ctx: RoundFinishCtx): void {
    const s = ctx.session ?? ctx.finished;
    const out = ctx.el.querySelector<HTMLElement>("[data-report]");
    if (!s || !out) return;
    const totalSec = ctx.timer.elapsed();
    const overtime = ctx.timer.inOvertime ? ctx.timer.overtimeSec : 0;
    ctx.finishSession();
    ctx.stopRound();
    const model: RoundReportModel = {
        t: ctx.t,
        session: s,
        list: ctx.list,
        rounds: roundsWithCurrent(ctx.rounds, s),
        totalSec,
        overtimeSec: overtime,
    };
    out.innerHTML = renderRoundReport(model);
    out.removeAttribute("hidden");
    bindRoundReport(out, model, ctx.aiModelId);
    out.scrollIntoView({behavior: "smooth", block: "nearest"});
}

/** 手动收卷（倒计时归零选「结束本轮」）：after 模式先揭示已答，再报告。 */
export function manualFinishRound(ctx: RoundFinishCtx): void {
    if (!ctx.session) return;
    if (ctx.revealMode === "after") ctx.revealAnswered();
    else showRoundReportNow(ctx);
    ctx.lockAllCards();
}

/** 视图侧能力（QuizView 用箭头属性实现，与 AnswerHost 同风格）。 */
export interface RoundFinishView {
    container(): HTMLElement;
    t(key: string): string;
    questions(): WenguQuestion[];
    allRounds(): WenguSession[];
    currentSession(): WenguSession | undefined;
    finishedSession(): WenguSession | undefined;
    timerController(): TimerController;
    currentRevealMode(): "instant" | "after";
    aiModelId(): string;
    finishSession(): void;
    revealAnsweredNow(): void;
    stopRoundNow(): void;
    lockAllCardsNow(): void;
}

/** 由视图组装 RoundFinishCtx。 */
export function roundFinishCtx(view: RoundFinishView): RoundFinishCtx {
    return {
        el: view.container(),
        t: view.t,
        list: view.questions(),
        rounds: view.allRounds(),
        session: view.currentSession(),
        finished: view.finishedSession(),
        timer: view.timerController(),
        revealMode: view.currentRevealMode(),
        aiModelId: view.aiModelId(),
        finishSession: () => view.finishSession(),
        revealAnswered: () => view.revealAnsweredNow(),
        stopRound: () => view.stopRoundNow(),
        lockAllCards: () => view.lockAllCardsNow(),
    };
}
