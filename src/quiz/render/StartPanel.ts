import type { HistoryStore, WenguRoundScope, WenguSession } from "../service/HistoryStore";
import { newSessionId } from "../service/HistoryStore";
import type { TimerController } from "../service/TimerController";
import type { WenguQuestion, WenguRevealMode, WenguStepsMode, WenguTimingMode } from "../../types";
import { baseQid } from "../../types";
import { clampMinutes } from "../../ui/shared";
import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";
import StartPanelApp from "../components/StartPanelApp.svelte";

/**
 * 开刷面板（design-review P1-1；Svelte 化 20260830——渲染在
 * components/StartPanelApp.svelte，挂载编排见文末 mountStartPanelFor）：
 * 四组选择收敛为一张表单——①上次进度（继续上次/重新开始，有未完成轮
 * 才出现）②刷题范围（全部/只刷上次错题/错题重刷=历史未掌握，有错题才
 * 出现）③答案展示 ④多步题模式（离线参考路径 / AI 实时跟随）⑤计时方式
 * （含倒计时分钟）。**继续上次 = 原样恢复**：选中后其余选项锁定并回显
 * 该轮原配置（含刷题范围，P2-6）。本文件保留：模型构建（buildStartPanel
 * Model）与开轮执行（startRound/beginDrillFor）。
 */

/** 开刷面板读出的完整轮次配置。 */
export interface RoundConfig {
    progress: "continue" | "fresh";
    scope: WenguRoundScope;
    reveal: WenguRevealMode;
    stepsMode: WenguStepsMode;
    timing: WenguTimingMode;
    countdownMin: number;
}

/** 面板初始默认值（来自插件设置，见 design-review P1-3）。 */
export interface RoundDefaults {
    reveal: WenguRevealMode;
    stepsMode: WenguStepsMode;
    timing: WenguTimingMode;
    countdownMin: number;
}

/** render/bind 入参：默认值 + 条件组的现状 + 继续时锁定的原配置。 */
export interface StartPanelModel {
    t: (key: string) => string;
    defaults: RoundDefaults;
    /** 未完成轮的已答题数（不传则不出现「上次进度」组）。 */
    unfinishedAnswered?: number;
    /** 上轮错题数（0 且无未掌握错题则不出现「刷题范围」组）。 */
    lastWrong: number;
    /** 历史未掌握错题数（scope=wrongAll 的清单长度）。 */
    wrongAll: number;
    /** 未完成轮的原配置（继续时锁定回显这些值，含范围）。 */
    resume?: {
        timing: WenguTimingMode;
        reveal: WenguRevealMode;
        stepsMode: WenguStepsMode;
        countdownMin: number;
        scope: WenguRoundScope;
    };
}

/** 由轮次与题目列表推导面板模型（继续的 resume 原样恢复，含范围）。 */
export function buildStartPanelModel(args: {
    t: (key: string) => string;
    defaults: RoundDefaults;
    rounds: WenguSession[];
    list: WenguQuestion[];
}): StartPanelModel {
    const last = args.rounds[args.rounds.length - 1];
    const answered = answeredQuestionCount(last);
    // endedAt 已写=该轮已收卷，不是「未完成」（否则 wrong/wrongAll 轮
    // 答完重开永远默认「继续上次」，点了就续开已收卷的轮，20260828
    // 二轮审查）
    const unfinished = last && !last.endedAt && answered > 0 && answered < args.list.length ? last : undefined;
    const resumeReveal: WenguRevealMode = unfinished?.revealMode === "after" ? "after" : "instant";
    return {
        t: args.t,
        defaults: args.defaults,
        unfinishedAnswered: unfinished ? answered : undefined,
        // 多步题的会话记录是 qid#k 条目，按块 id 归并后才等于「题数」
        lastWrong: new Set((last?.results ?? []).filter((r) => !r.ok).map((r) => baseQid(r.qid))).size,
        wrongAll: args.list.filter((q) => q.wrongCount > 0 && q.right === "0").length,
        resume: unfinished
            ? {
                  timing: unfinished.mode,
                  reveal: resumeReveal,
                  stepsMode: unfinished.stepsMode === "ai" ? "ai" : "offline",
                  countdownMin: unfinished.plannedSec
                      ? clampMinutes(Math.ceil(unfinished.plannedSec / 60))
                      : args.defaults.countdownMin,
                  scope: unfinished.scope ?? "all",
              }
            : undefined,
    };
}

/** 一轮里已作答的题目数（多步题的 qid#k 条目按块 id 去重）。 */
function answeredQuestionCount(s: WenguSession | undefined): number {
    return new Set((s?.results ?? []).map((r) => baseQid(r.qid))).size;
}

/** 开轮执行入参（视图提供状态与收尾回调）。 */
export interface StartRoundCtx {
    defaults: RoundDefaults;
    rounds: WenguSession[];
    fullList: WenguQuestion[];
    docId: string;
    timer: TimerController;
    history?: { upsert(s: WenguSession): Promise<void> };
    /** 视图侧状态写入。 */
    setList(list: WenguQuestion[]): void;
    setRevealMode(m: "instant" | "after"): void;
    setActiveIdx(i: number): void;
    setStarted(v: boolean): void;
    setFinished(s: WenguSession | undefined): void;
    setSession(s: WenguSession | undefined): void;
    /** 开轮后的收尾（重渲染、恢复已答、刷新标签）。 */
    afterStart(): void;
}

/** 「开始刷题」：按面板读出的 RoundConfig 开轮——继续上次原样恢复
 * （含范围），否则新会话；scopeFilter 把 fullList 按范围裁剪
 * （P2-6：中断轮继续不再展开为全量）。 */
export function startRound(ctx: StartRoundCtx, cfg: RoundConfig, override?: { scope?: WenguRoundScope }): void {
    if (override?.scope) {
        cfg.scope = override.scope; // 复习模式「重刷本文档」直落范围
        cfg.progress = "fresh"; // 显式重刷=新轮——否则旧未完成轮换走「继续」吞掉按钮意图
    }
    ctx.setRevealMode(cfg.reveal);
    ctx.setActiveIdx(0);
    const last = ctx.rounds[ctx.rounds.length - 1];
    const lastAnswered = new Set((last?.results ?? []).map((r) => baseQid(r.qid))).size;
    const unfinished =
        cfg.progress === "continue" && last && !last.endedAt && lastAnswered > 0 && lastAnswered < ctx.fullList.length
            ? last
            : undefined;
    // 范围裁剪：进行中的轮优先按它**落盘的范围清单**恢复（scopeIds 快照，
    // 开轮时冻结）——旧轮没有快照的按 scope+该轮结果重算；范围自引用会
    // 漂移：wrong 轮按本轮结果重算丢原范围、wrongAll 轮内答对的题被
    // 静默移出（20260828 二轮审查）
    const scope = unfinished ? (unfinished.scope ?? "all") : cfg.scope;
    let list: WenguQuestion[];
    if (unfinished?.scopeIds?.length) {
        const ids = new Set(unfinished.scopeIds);
        list = ctx.fullList.filter((q) => ids.has(q.id));
    } else {
        list = scopeFilter(ctx.fullList, scope, last);
    }
    ctx.setList(list);
    let session: WenguSession;
    if (unfinished) {
        // 继续上次 = 原样恢复该轮配置（面板上已锁定回显）
        ctx.setRevealMode(unfinished.revealMode === "after" ? "after" : "instant");
        const resumeMin = unfinished.plannedSec
            ? clampMinutes(Math.ceil(unfinished.plannedSec / 60))
            : cfg.countdownMin;
        ctx.timer.start(unfinished.mode, resumeMin, unfinished.elapsedSec);
        for (const r of unfinished.results) {
            if (r.sec) ctx.timer.restoreQuestionSec(r.qid, r.sec);
        }
        session = unfinished;
    } else {
        ctx.timer.start(cfg.timing, cfg.countdownMin, 0);
        session = {
            id: newSessionId(),
            docId: ctx.docId,
            startedAt: Date.now(),
            mode: cfg.timing,
            plannedSec: cfg.timing === "countdown" ? cfg.countdownMin * 60 : undefined,
            revealMode: cfg.reveal,
            stepsMode: cfg.stepsMode,
            scope,
            scopeIds: scope === "all" ? undefined : list.map((q) => q.id), // 范围快照：恢复不自引用
            elapsedSec: 0,
            answered: 0,
            correct: 0,
            results: [],
        };
    }
    ctx.setStarted(true);
    ctx.setFinished(undefined);
    ctx.setSession(session);
    void ctx.history?.upsert(session);
    ctx.afterStart();
}

/** 范围裁剪：all=全量；wrong=上轮错题；wrongAll=历史未掌握（right=0 且错过）。 */
function scopeFilter(fullList: WenguQuestion[], scope: WenguRoundScope, last?: WenguSession): WenguQuestion[] {
    if (scope === "wrong") {
        const wrong = new Set((last?.results ?? []).filter((r) => !r.ok).map((r) => baseQid(r.qid)));
        return wrong.size > 0 ? fullList.filter((q) => wrong.has(q.id)) : fullList;
    }
    if (scope === "wrongAll") {
        const pending = fullList.filter((q) => q.wrongCount > 0 && q.right === "0");
        return pending.length > 0 ? pending : fullList;
    }
    return fullList;
}

/** 轮次默认值（开刷面板模型与开轮共用；stepsMode 默认离线）。 */
export function roundDefaults(reveal: WenguRevealMode, timer: TimerController): RoundDefaults {
    return {
        reveal,
        stepsMode: "offline",
        timing: timer.mode,
        countdownMin: timer.countdownMin,
    };
}

/** 开刷编排所需的视图能力（QuizView 用箭头属性实现，beginDrillFor 消费）。 */
export interface DrillViewAccess {
    t: (key: string) => string;
    container(): HTMLElement;
    currentRevealMode(): WenguRevealMode;
    timerController(): TimerController;
    allRounds(): WenguSession[];
    questions(): WenguQuestion[];
    fullListOf(): WenguQuestion[];
    docIdOf(): string;
    historyStore(): HistoryStore | undefined;
    setQuizList(list: WenguQuestion[]): void;
    setQuizRevealMode(mode: WenguRevealMode): void;
    setActiveQIdx(idx: number): void;
    setStartedFlag(v: boolean): void;
    setFinishedSession(s: WenguSession | undefined): void;
    setCurSession(s: WenguSession | undefined): void;
    renderQuizList(): void;
    updateTimerLabelNow(): void;
    /** 开刷后的收尾（视图自实现：重渲染/恢复已答/计时标签）。 */
    afterStartHook(): void;
}

/** 开刷面板模型（startPanelModel 的拆出体）。 */
export function startPanelModelFor(v: DrillViewAccess): StartPanelModel {
    return buildStartPanelModel({
        t: v.t,
        defaults: roundDefaults(v.currentRevealMode(), v.timerController()),
        rounds: v.allRounds(),
        list: v.questions(),
    });
}

/** beginDrill（从 QuizView 拆出）：由视图能力组装 StartRoundCtx 开刷
 *（override 供复习模式「重刷本文档」直落范围）。 */
/** 默认轮次配置（override 路径——复习模式「重刷本文档」不经过面板）。 */
export function defaultRoundConfig(d: RoundDefaults): RoundConfig {
    return {
        progress: "fresh",
        scope: "all",
        reveal: d.reveal,
        stepsMode: d.stepsMode,
        timing: d.timing,
        countdownMin: d.countdownMin,
    };
}

/** beginDrill（从 QuizView 拆出）：由视图能力组装 StartRoundCtx 开刷。
 * cfg=面板读出的配置（StartPanelApp onStart 交来）；override 供复习
 * 模式「重刷本文档」直落范围（cfg 缺省用默认配置）。 */
export function beginDrillFor(v: DrillViewAccess, override?: { scope?: WenguRoundScope }, cfg?: RoundConfig): void {
    startRound(
        {
            defaults: roundDefaults(v.currentRevealMode(), v.timerController()),
            rounds: v.allRounds(),
            fullList: v.fullListOf(),
            docId: v.docIdOf(),
            timer: v.timerController(),
            history: v.historyStore(),
            setList: (l) => v.setQuizList(l),
            setRevealMode: (m) => v.setQuizRevealMode(m),
            setActiveIdx: (i) => v.setActiveQIdx(i),
            setStarted: (flag) => v.setStartedFlag(flag),
            setFinished: (s) => v.setFinishedSession(s),
            setSession: (s) => v.setCurSession(s),
            afterStart: () => v.afterStartHook(),
        },
        cfg ?? defaultRoundConfig(roundDefaults(v.currentRevealMode(), v.timerController())),
        override
    );
}

/* ── 开刷面板挂载编排（Svelte 化 20260830，组件在 components/StartPanelApp） ── */

let startApp: MountedSvelteApp | undefined;

/** 挂载开刷面板（QuizShell 壳落后、renderMainShell 的面板态条件下调）。 */
export function mountStartPanelFor(
    v: DrillViewAccess & {
        el: HTMLElement;
        enterPreviewMode(): void;
        enterReviewMode(opt: { docId?: string; qid?: string }): void;
        bankStore?(): import("../../bank/data/QuestionBank").QuestionBank | undefined;
        reloadView(): Promise<void>;
    }
): void {
    detachStartPanel();
    const host = v.el.querySelector<HTMLElement>("[data-startpanel-host]");
    if (!host) return;
    startApp = mountSvelteApp(StartPanelApp, host, {
        model: startPanelModelFor(v),
        onStart: (cfg: RoundConfig) => beginDrillFor(v, undefined, cfg),
        onPreview: () => v.enterPreviewMode(),
        onReview: () => v.enterReviewMode({}),
    });
}

/** 卸载开刷面板（renderQuizShellFor 整壳重建前与 QuizView.destroy 兜底）。 */
export function detachStartPanel(): void {
    startApp?.unmount();
    startApp = undefined;
}
