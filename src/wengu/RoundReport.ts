import {agentChat} from "./AgentClient";
import {svgIcon} from "./FormHtml";
import type {WenguSession} from "./HistoryStore";
import type {TimerController} from "./TimerController";
import type {WenguQuestion} from "./types";
import {baseQid} from "./types";
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
    const byQid = byBaseQid(s);
    // 每题用时条形图：高度 ∝ 秒数，对错描色，未答灰色（多步题按整题聚合）
    const maxSec = Math.max(1, ...list.map((q) => byQid.get(q.id)?.sec ?? 0));
    const timeBars = list
        .map((q, i) => {
            const r = byQid.get(q.id);
            const sec = r?.sec ?? 0;
            const h = Math.max(4, Math.round((sec / maxSec) * 100));
            // partial（brief 方向对但有缺口）单独描黄，区别于全错
            const cls = !r ?
                "wengu-bar-muted" :
                r.verdict === "partial" ?
                "wengu-bar-partial" :
                r.ok ?
                "wengu-bar-right" :
                "wengu-bar-wrong";
            const state = !r ?
                t("reportUnanswered") :
                r.verdict === "partial" ?
                t("verdictPartial") :
                r.ok ?
                t("correct") :
                t("wrong");
            const title = fmt(t("reportQTime"), {n: String(i + 1), t: mmss(sec)}) + ` · ${state}`;
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
    <span class="wengu-meta">${svgIcon("iconClock")} ${esc(mmss(m.totalSec))}</span>
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
    <button class="b3-button b3-button--outline" data-act="ai-report">${esc(t("reportAiBtn"))}</button>
  </div>
  <div class="wengu-report-ai" data-ai hidden></div>
</div>`;
}

/** 把一轮的会话结果按题目块 id 聚合（多步题的 qid#k 条目合并：
 *  ok=全步对、sec=各步求和；verdict 保留 brief 的 partial 标记）。 */
function byBaseQid(s: WenguSession): Map<string, {ok: boolean; sec: number; verdict?: string;}> {
    const out = new Map<string, {ok: boolean; sec: number; verdict?: string;}>();
    for (const r of s.results) {
        const b = baseQid(r.qid);
        const cur = out.get(b);
        out.set(b, {
            ok: cur ? cur.ok && r.ok : r.ok,
            sec: (cur?.sec ?? 0) + (r.sec ?? 0),
            verdict: cur?.verdict ?? r.verdict,
        });
    }
    return out;
}

/** 绑定 AI 报告按钮：优先开思源智能体新会话，失败降级页内拉取。 */
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
    // 首选：在思源内置智能体里开新会话发分析（可追问、markdown 渲染）
    if (await openAgentWithPrompt(buildAnalysisPrompt(m))) return;
    // 降级：页内拉智能体回答（纯文本）
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

/**
 * 打开思源内置智能体面板、开新会话并填入 prompt 发送。DOM 自动化
 * （插件 API 无官方入口，选择器按 3.8.0 真机 dump 校准）；任何一步
 * 失配都返回 false，调用方降级页内分析。
 */
async function openAgentWithPrompt(prompt: string): Promise<boolean> {
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const visible = (): HTMLElement | null => {
        for (const el of document.querySelectorAll<HTMLElement>(".agent-chat")) {
            if (el.offsetHeight > 0) return el;
        }
        return null;
    };
    try {
        let panel = visible();
        if (!panel) {
            const dockItem = document.querySelector<HTMLElement>('.dock__item[data-type="agentChat"]');
            if (!dockItem) return false;
            dockItem.click(); // 单击展开（再点是最小化，仅在不可见时点）
            await sleep(400);
            panel = visible();
        }
        if (!panel) return false;
        panel.querySelector<HTMLElement>('[data-type="new-session"]')?.click(); // 新会话
        const wysiwyg = panel.querySelector<HTMLElement>(".agent-chat__composer-host .protyle-wysiwyg");
        const send = panel.querySelector<HTMLButtonElement>(".agent-chat__send");
        if (!wysiwyg || !send) return false;
        wysiwyg.focus();
        // 以纯文本粘贴喂给 Protyle（自带粘贴解析；execCommand 不处理多行）
        const dt = new DataTransfer();
        dt.setData("text/plain", prompt);
        wysiwyg.dispatchEvent(
            new ClipboardEvent("paste", {clipboardData: dt, bubbles: true, cancelable: true}),
        );
        await sleep(150);
        if (!wysiwyg.textContent?.includes("刷题分析助手")) return false; // 未粘上
        send.click();
        return true;
    } catch (_) {
        return false;
    }
}

/** 把一轮数据交给 AI 判卷（总体/薄弱点/思路点评/建议；带各题思路时重点点评思路）。 */
function buildAnalysisPrompt(m: RoundReportModel): string {
    const {session: s, list, rounds} = m;
    const byQid = byBaseQid(s);
    const thoughts = s.thoughts ?? {};
    const hasThoughts = Object.keys(thoughts).length > 0;
    const perQ = list
        .map((q, i) => {
            const r = byQid.get(q.id);
            const label = q.knowledge || q.chapter || String(i + 1);
            // partial=方向对但有缺口（统计记错），AI 分析要单独点名
            const state = !r ? "未答" : r.verdict === "partial" ? "部分正确" : r.ok ? "对" : "错";
            const base = r ? `${i + 1}. ${label} ${state} ${r.sec ?? 0}s` : `${i + 1}. ${label} 未答`;
            return thoughts[q.id] ? `${base}｜思路：${thoughts[q.id]}` : base;
        })
        .join("；\n");
    const history = rounds.map((r, i) => `第${i + 1}轮 ${r.correct}/${r.answered}`).join("；");
    const overtime = m.overtimeSec > 0 ? `；超时 ${mmss(m.overtimeSec)}` : "";
    const thoughtRule = hasThoughts ?
        "【思路判卷】逐条点评带「思路」的题（按题号）：思路方向是否正确、卡在哪一步、下次该怎么想；思路与答案对错不一致的要点出来。" :
        "";
    return `你是刷题判卷助手。根据下面的一轮刷题数据给出分析报告，不超过 300 字，分四段：总体评价；薄弱知识点与明显偏慢的题（指出题号）；思路点评；下一轮建议。${thoughtRule}
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
  <span>${svgIcon("iconClock")} ${esc(t("timeUpShort"))}</span>
  <button class="b3-button b3-button--outline" data-act="overtime">${esc(t("continueAnswer"))}</button>
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

/** 锁定全部卡片的作答位（收卷用）。 */
export function lockAllCards(el: HTMLElement): void {
    el.querySelectorAll<HTMLElement>(".wengu-card").forEach((c) => {
        c.querySelectorAll("input, textarea, button").forEach((n) => {
            (n as HTMLButtonElement).disabled = true;
        });
    });
}
