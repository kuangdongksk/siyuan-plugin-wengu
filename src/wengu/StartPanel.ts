import {
    formGroup,
    formOption,
    formRow,
    formSelect,
} from "./FormHtml";
import type {WenguSession} from "./HistoryStore";
import {newSessionId} from "./HistoryStore";
import type {TimerController} from "./TimerController";
import type {
    WenguQuestion,
    WenguRevealMode,
    WenguStepsMode,
    WenguTimingMode,
} from "./types";
import {baseQid} from "./types";
import {
    clampMinutes,
    esc,
    fmt,
} from "./ui";

/**
 * 开刷面板（design-review P1-1）：四组选择收敛为一张表单——
 * ① 上次进度（继续上次/重新开始，有未完成轮才出现）
 * ② 刷题范围（全部/只刷上次错题，上轮有错题才出现）
 * ③ 答案展示 ④ 多步题模式（离线参考路径 / AI 实时跟随）
 * ⑤ 计时方式（含倒计时分钟）
 *
 * 行样式与插件设置页同款（config-group / config-title / config-item，
 * 标题说明在左、下拉在右）。**继续上次 = 原样恢复**：选中后其余选项
 * 锁定并回显该轮原配置（要换配置就选重新开始），不再出现「选了却被
 * 静默忽略」或「继续却换了玩法」的歧义。
 */

/** 开刷面板读出的完整轮次配置。 */
export interface RoundConfig {
    progress: "continue" | "fresh";
    scope: "all" | "wrong";
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
    /** 上轮错题数（0 则不出现「刷题范围」组）。 */
    lastWrong: number;
    /** 未完成轮的原配置（继续时锁定回显这些值）。 */
    resume?: {timing: WenguTimingMode; reveal: WenguRevealMode; stepsMode: WenguStepsMode; countdownMin: number;};
}

export function renderStartPanel(m: StartPanelModel): string {
    const {t, defaults, resume} = m;
    // 继续上次默认选中：初始展示的就是要恢复的原配置
    const cont = m.unfinishedAnswered !== undefined && !!resume;
    const cur = cont ? resume : defaults;
    const progress = m.unfinishedAnswered !== undefined ?
        formGroup(
            t("progressTitle"),
            formRow(
                t("progressTitle"),
                fmt(t("continueHint"), {n: String(m.unfinishedAnswered ?? 0)}),
                formSelect(
                    "progress",
                    formOption("continue", fmt(t("continueLast"), {n: String(m.unfinishedAnswered ?? 0)}), true) +
                        formOption("fresh", t("startFresh"), false),
                ),
            ),
        ) :
        "";
    const scope = m.lastWrong > 0 ?
        formGroup(
            t("scopeTitle"),
            formRow(
                t("scopeTitle"),
                t("scopeHint"),
                formSelect(
                    "scope",
                    formOption("all", t("scopeAll"), !cont) +
                        formOption("wrong", fmt(t("scopeWrongOnly"), {n: String(m.lastWrong)}), false),
                ),
            ),
        ) :
        "";
    const reveal = formGroup(
        t("revealTitle"),
        formRow(
            t("revealTitle"),
            t("revealHint"),
            formSelect(
                "reveal",
                formOption("instant", t("revealInstant"), cur.reveal === "instant") +
                    formOption("after", t("revealAfter"), cur.reveal === "after"),
            ),
        ),
    );
    const stepsMode = formGroup(
        t("stepsModeTitle"),
        formRow(
            t("stepsModeTitle"),
            t("stepsModeHint"),
            formSelect(
                "steps",
                formOption("offline", t("stepsModeOffline"), cur.stepsMode !== "ai") +
                    formOption("ai", t("stepsModeAi"), cur.stepsMode === "ai"),
            ),
        ),
    );
    const timing = formGroup(
        t("timingTitle"),
        formRow(
            t("timingTitle"),
            t("timingHint"),
            formSelect(
                "timing",
                formOption("countUp", t("timingCountUp"), cur.timing === "countUp") +
                    formOption("countdown", t("timingCountdown"), cur.timing === "countdown") +
                    formOption("perQuestion", t("timingPerQuestion"), cur.timing === "perQuestion") +
                    formOption("none", t("timingNone"), cur.timing === "none"),
            ),
        ) + formRow(
            t("timingMinutes"),
            t("timingMinutesHint"),
            `<input class="b3-text-field fn__flex-center fn__size200" type="number" min="1" max="600" data-field="minutes" value="${cur.countdownMin}">`,
        ),
    );
    return `<div class="wengu-start">
  ${progress}
  ${scope}
  ${reveal}
  ${stepsMode}
  ${timing}
  <div><button class="b3-button b3-button--outline" data-act="start">${esc(t("startDrill"))}</button></div>
</div>`;
}

/** 由轮次与题目列表推导面板模型（继续的 resume 原样恢复）。 */
export function buildStartPanelModel(args: {
    t: (key: string) => string;
    defaults: RoundDefaults;
    rounds: WenguSession[];
    list: WenguQuestion[];
}): StartPanelModel {
    const last = args.rounds[args.rounds.length - 1];
    const answered = answeredQuestionCount(last);
    const unfinished = last && answered > 0 && answered < args.list.length ? last : undefined;
    const resumeReveal: WenguRevealMode = unfinished?.revealMode === "after" ? "after" : "instant";
    return {
        t: args.t,
        defaults: args.defaults,
        unfinishedAnswered: unfinished ? answered : undefined,
        // 多步题的会话记录是 qid#k 条目，按块 id 归并后才等于「题数」
        lastWrong: new Set(
            (last?.results ?? []).filter((r) => !r.ok).map((r) => baseQid(r.qid)),
        ).size,
        resume: unfinished ?
            {
                timing: unfinished.mode,
                reveal: resumeReveal,
                stepsMode: unfinished.stepsMode === "ai" ? "ai" : "offline",
                countdownMin: unfinished.plannedSec ?
                    clampMinutes(Math.ceil(unfinished.plannedSec / 60)) :
                    args.defaults.countdownMin,
            } :
            undefined,
    };
}

/** 一轮里已作答的题目数（多步题的 qid#k 条目按块 id 去重）。 */
function answeredQuestionCount(s: WenguSession | undefined): number {
    return new Set((s?.results ?? []).map((r) => baseQid(r.qid))).size;
}

/** 从面板 DOM 读出完整轮次配置（读不到的按默认/安全值回退）。 */
export function readRoundConfig(root: ParentNode, defaults: RoundDefaults): RoundConfig {
    const val = (f: string) => (root.querySelector(`[data-field='${f}']`) as HTMLSelectElement | null)?.value;
    const minutes = root.querySelector<HTMLInputElement>("[data-field='minutes']");
    return {
        progress: val("progress") === "continue" ? "continue" : "fresh",
        scope: val("scope") === "wrong" ? "wrong" : "all",
        reveal: val("reveal") === "after" ? "after" : "instant",
        stepsMode: val("steps") === "ai" ? "ai" : "offline",
        timing: (() => {
            const v = val("timing");
            return v === "countdown" || v === "none" || v === "perQuestion" ? v : "countUp";
        })(),
        countdownMin: clampMinutes(Number(minutes?.value ?? defaults.countdownMin)),
    };
}

/**
 * 绑定：开始按钮 + 「继续上次 = 原样恢复」。选中继续时锁定
 * 范围/展示/计时/分钟并回显该轮原配置；切回重新开始则解锁并恢复
 * 设置页默认值。任何选项都不会出现「能选但不生效」。
 */
export function bindStartPanel(root: ParentNode, m: StartPanelModel, onStart: () => void): void {
    root.querySelector("[data-act='start']")?.addEventListener("click", () => onStart());
    const progressSel = root.querySelector<HTMLSelectElement>("[data-field='progress']");
    if (!progressSel) return;
    const fields = ["scope", "reveal", "steps", "timing", "minutes"]
        .map((f) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field='${f}']`))
        .filter((el): el is HTMLInputElement | HTMLSelectElement => !!el);
    const setVal = (f: string, v: string) => {
        const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field='${f}']`);
        if (el) el.value = v;
    };
    const sync = () => {
        const cont = progressSel.value === "continue";
        fields.forEach((el) => el.disabled = cont);
        const cur = cont && m.resume ? m.resume : m.defaults;
        setVal("scope", "all"); // 继续=原范围；重新开始默认全部
        setVal("reveal", cur.reveal);
        setVal("steps", cur.stepsMode);
        setVal("timing", cur.timing);
        setVal("minutes", String(cur.countdownMin));
    };
    progressSel.addEventListener("change", sync);
    sync(); // 默认选中「继续上次」时先锁定
}

/** 开轮执行入参（视图提供状态与收尾回调）。 */
export interface StartRoundCtx {
    root: ParentNode;
    defaults: RoundDefaults;
    rounds: WenguSession[];
    fullList: WenguQuestion[];
    docId: string;
    timer: TimerController;
    history?: {upsert(s: WenguSession): Promise<void>;};
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

/** 「开始刷题」：读 RoundConfig 开轮——继续上次原样恢复，否则新会话。 */
export function startRound(ctx: StartRoundCtx): void {
    const cfg = readRoundConfig(ctx.root, ctx.defaults);
    ctx.setRevealMode(cfg.reveal);
    ctx.setActiveIdx(0);
    const last = ctx.rounds[ctx.rounds.length - 1];
    const wrong = new Set((last?.results ?? []).filter((r) => !r.ok).map((r) => baseQid(r.qid)));
    const useWrong = cfg.scope === "wrong" && wrong.size > 0;
    ctx.setList(useWrong ? ctx.fullList.filter((q) => wrong.has(q.id)) : ctx.fullList);
    const lastAnswered = new Set((last?.results ?? []).map((r) => baseQid(r.qid))).size;
    const unfinished = !useWrong && cfg.progress === "continue" && last && lastAnswered > 0 &&
            lastAnswered < ctx.fullList.length ?
        last :
        undefined;
    let session: WenguSession;
    if (unfinished) {
        // 继续上次 = 原样恢复该轮配置（面板上已锁定回显）
        ctx.setRevealMode(unfinished.revealMode === "after" ? "after" : "instant");
        const resumeMin = unfinished.plannedSec ?
            clampMinutes(Math.ceil(unfinished.plannedSec / 60)) :
            cfg.countdownMin;
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
