import { attributeWrongCauses } from "../service/AiJudge";
import type { CauseItem } from "../service/AiJudge";
import { svgIcon } from "../../ui/FormHtml";
import type { WenguSession } from "../service/HistoryStore";
import type { TimerController } from "../service/TimerController";
import type { WenguQuestion } from "../../types";
import { baseQid } from "../../types";
import { esc, mmss } from "../../ui/shared";
import type { QuestionBank } from "../../bank/data/QuestionBank";
import type { WeakCause, WeakTopRow, WeaknessStore } from "../../bank/data/WeaknessStore";
import { openWeakDrill } from "../../bank/ui/WeakDrill";
import { roundAggByQid } from "../../bank/data/WeaknessStore";
import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";
import RoundReportApp from "../components/RoundReportApp.svelte";

/**
 * 一轮完成后的总结报告（纯 CSS 条形图，不引图表库）：渲染在
 * components/RoundReportApp.svelte（Svelte 化 20260830），本文件保留
 * 模型与收卷编排（showRoundReportNow）+ AI 分析 prompt 构建 +
 * 错因沉淀；AI 通道走 ai 域客户端。
 */

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
    /** 薄弱沉淀 Top 行（WeaknessStore 同步快照，空=不渲染）。 */
    weakRows: WeakTopRow[];
}

/** 把一轮的会话结果按题目块 id 聚合（多步题的 qid#k 条目合并：
 *  ok=全步对、sec=各步求和；verdict 保留 brief 的 partial 标记）。 */
export function byBaseQid(s: WenguSession): Map<string, { ok: boolean; sec: number; verdict?: string }> {
    const out = new Map<string, { ok: boolean; sec: number; verdict?: string }>();
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

/** 把一轮数据交给 AI 判卷（总体/薄弱点/思路点评/建议；带各题思路时重点点评思路）。 */
export function buildAnalysisPrompt(m: RoundReportModel): string {
    const { session: s, list, rounds } = m;
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
    const thoughtRule = hasThoughts
        ? "【思路判卷】逐条点评带「思路」的题（按题号）：思路方向是否正确、卡在哪一步、下次该怎么想；思路与答案对错不一致的要点出来。"
        : "";
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
    handlers: { onOvertime: () => void; onFinish: () => void }
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
    /** 薄弱画像（有则收卷计数 + 异步补错因 + 报告展示）。 */
    weakness?: WeaknessStore;
    /** 题库（针对性加练入库）。 */
    bank?: QuestionBank;
    /** 专题清单变化后刷新侧栏。 */
    refreshCollections?(): void;
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

/* ── 报告挂载编排（Svelte 化 20260830，组件在 components/RoundReportApp） ── */

let reportApp: MountedSvelteApp | undefined;

/** 卸载轮次报告（renderQuizShellFor 整壳重建前与 QuizView.destroy 兜底）。 */
export function detachRoundReport(): void {
    reportApp?.unmount();
    reportApp = undefined;
}

/** 一轮完成：收卷 + 挂载总结报告（总用时/用时图/得分图 + AI 分析入口）。 */
export function showRoundReportNow(ctx: RoundFinishCtx): void {
    const s = ctx.session ?? ctx.finished;
    const host = ctx.el.querySelector<HTMLElement>("[data-report]");
    if (!s || !host) return;
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
        weakRows: ctx.weakness?.topSync(8) ?? [],
    };
    detachRoundReport();
    host.removeAttribute("hidden");
    reportApp = mountSvelteApp(RoundReportApp, host, {
        model,
        modelId: ctx.aiModelId,
        onWeakDrill: (rows: WeakTopRow[]) => {
            if (ctx.weakness && ctx.bank)
                openWeakDrill(
                    {
                        t: ctx.t,
                        bank: ctx.bank,
                        weakness: ctx.weakness,
                        modelId: ctx.aiModelId,
                        onDone: () => ctx.refreshCollections?.(),
                    },
                    rows
                );
        },
    });
    host.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (ctx.weakness) void settleWeakness(ctx.weakness, s, ctx.list, ctx.aiModelId);
}

/** 收卷后异步沉淀错因：brief 判分自带的先入账，客观/steps 错题打包
 *  一次 AI 归因（≤12 题、≤4000 字），任何失败静默降级（计数已在）。 */
async function settleWeakness(
    store: WeaknessStore,
    s: WenguSession,
    list: WenguQuestion[],
    modelId: string
): Promise<void> {
    try {
        const agg = roundAggByQid(s);
        const causes = new Map<string, WeakCause>();
        const notes = new Map<string, string>();
        const mineByQid = new Map<string, string>();
        for (const r of s.results) {
            const b = baseQid(r.qid);
            mineByQid.set(b, r.submitted);
            if (!r.ok && r.cause) causes.set(b, r.cause as WeakCause);
            if (!r.ok && r.comment) notes.set(b, r.comment);
        }
        const items: CauseItem[] = [];
        let chars = 0;
        for (const q of list) {
            if (agg.get(q.id) !== false || causes.has(q.id) || items.length >= 12) continue;
            const stem = (q.stemMd ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
            if (!stem) continue;
            chars += stem.length;
            if (chars > 4000) break;
            items.push({ qid: q.id, stem, mine: mineByQid.get(q.id) ?? "", answer: q.answer ?? "" });
        }
        if (items.length > 0) {
            for (const [qid, cause] of await attributeWrongCauses(items, modelId)) causes.set(qid, cause);
        }
        await store.applyCauses(s, list, causes, notes);
    } catch (_) {
        // 归因失败不影响报告（计数已本地落）
    }
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
    weaknessStore(): WeaknessStore | undefined;
    bankStore(): QuestionBank | undefined;
    refreshCollections(): void;
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
        weakness: view.weaknessStore(),
        bank: view.bankStore(),
        refreshCollections: () => view.refreshCollections(),
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
