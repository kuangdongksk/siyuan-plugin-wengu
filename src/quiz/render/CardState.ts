import { statusIcon } from "../../ui/FormHtml";
import { esc, fmt } from "../../ui/shared";
import type { WenguSession, WenguSessionResult } from "../service/HistoryStore";
import { optionIsRight, slotOptionIsRight, stepOptionIsRight } from "../service/QuestionGrading";
import { mdFragmentHtml, optionInline } from "../service/ProtyleHost";
import { hasSlots, hasSteps, LETTERS, optionDisplayMd, QuestionType } from "../../types";
import type { WenguQuestion, WenguRevealMode, WenguStep } from "../../types";
import { isChoice, isObjective } from "./CardHtml";

/**
 * 题卡响应态（6-4b 三写收敛）：初始渲染/恢复继续/判分揭示原本散在
 * renderCardHtml、restoreAnsweredCards（含 restoreSubmitted/revealCard）、
 * 三流程直改 DOM 三处，统一收敛为 CardUi——组件渲染全部派生自它，
 * 写入经 CardCtl/三流程。初始态构建 buildCardInit 是纯函数（新卡与
 * 恢复卡同一条路，恢复矩阵见 CardState.test.ts），挂载编排把它连同
 * 恢复上下文一次算好传入组件。
 */

/** 选项渲染快照（steps 步选项 / cloze 当前空选项共用形状）。 */
export interface OptSnap {
    letter: string;
    html: string;
    tier: string;
    /** 判分描色（判分时写入）：1=正确项、2=误选项。 */
    mark: 0 | 1 | 2;
}

/** 一步的渲染态（离线静态与 AI 实时追加同构）。 */
export interface StepUi {
    kind: "method" | "result";
    badge: string;
    stemHtml: string;
    opts: OptSnap[];
    selected: string;
    graded: boolean;
    ok: boolean;
    resultHtml: string;
    resultCls: string;
    resultOn: boolean;
    hidden: boolean;
    locked: boolean;
    /** method 步答错后的「AI 复核」申诉按钮：""=无 / idle / busy。 */
    appeal: "" | "idle" | "busy";
}

/** 逐空作答账（cloze 空号条与 match 槽位行共用）。 */
export interface SlotMark {
    answered: boolean;
    letter: string;
    ok: boolean;
}

export interface SlotsUi {
    kind: "cloze" | "match";
    marks: SlotMark[];
    /** cloze 当前空（引导语 + 选项快照，切空重灌）。 */
    cur: number;
    curStem: string;
    curOpts: OptSnap[];
    curSelected: string;
    curLocked: boolean;
}

export type ResultStatus = "" | "right" | "wrong" | "partial" | "warn";

/** 一张题卡的完整渲染态（普通/steps/slots 三形态共用，可选项按题型空缺）。 */
export interface CardUi {
    /* ── 作答位 ── */
    /** 已选字母（升序拼接，choice chip）。 */
    letters: string;
    /** 判断题 √ / ×。 */
    judge: string;
    /** 文本作答（非受控记录，提交读取）。 */
    mine: string;
    /** 「思路」草稿与折叠态。 */
    thought: string;
    thoughtOpen: boolean;
    /* ── 判分/揭示 ── */
    /** 已判分（data-graded + .wengu-graded；答满判据 / 结果行依据）。 */
    graded: boolean;
    /** 作答位禁用（提交/收卷/未开刷）。 */
    locked: boolean;
    /** 判分揭示（chip/选项描色派生源）。 */
    revealed: boolean;
    /** 判分时的作答快照（描色/答案行展示）。 */
    submitted: string;
    resultHtml: string;
    resultStatus: ResultStatus;
    note: string;
    /** 自评/改判行。 */
    selfOn: boolean;
    /** 自评行提示文案（selfAssess / rejudgeHint）。 */
    selfLabel: string;
    aiComment: string;
    /** brief AI 判分三态（改判与恢复兜底用）。 */
    aiVerdict: string;
    /** 经 AI 判分（true=自评语义变「改判」appealGrade；恢复卡不带）。 */
    aiJudged: boolean;
    /* ── 多步 ── */
    steps?: StepUi[];
    stepCur: number;
    /** 收口快照（申诉翻对重算整题用，"101" 形）。 */
    stepOks: string;
    stepPersist: boolean;
    /** AI 实时模式失败框文案（含「切离线继续」）。 */
    rtError: string;
    /** AI 实时引导模式（挂载分派置位；「下一步」提交走实时链）。 */
    rtMode: boolean;
    /* ── 逐空 ── */
    slots?: SlotsUi;
}

/** 初始态构建上下文（挂载编排按视图状态一次算好）。 */
export interface CardInitCtx {
    t: (k: string) => string;
    /** 绑作答事件（quiz 已开刷且非渐进；预览/渐进/收卷后为 false）。 */
    interactive: boolean;
    /** 整卡锁（未开刷在途分片/收卷后，旧 lockAllCards 语义）。 */
    locked: boolean;
    /** 恢复源（继续上轮/收卷重渲染）；预览与无会话不传。 */
    restore?: {
        results: WenguSessionResult[];
        byQid: Map<string, WenguSessionResult>;
        /** instant 或全卷完成 → 挂载即揭示。 */
        revealNow: boolean;
        /** after 模式（挂载后题号标「已答」由编排补）。 */
        batch: boolean;
    };
}

/** 某多步题在会话里的逐步结果（按步序）。 */
export function stepResultsOf(
    results: WenguSessionResult[],
    qid: string
): { k: number; submitted: string; ok: boolean }[] {
    const prefix = `${qid}#`;
    return results
        .filter((r) => r.qid.startsWith(prefix) && /^\d+$/.test(r.qid.slice(prefix.length)))
        .map((r) => ({ k: Number(r.qid.slice(prefix.length)), submitted: r.submitted, ok: r.ok }))
        .sort((a, b) => a.k - b.k);
}

/** 某 slots 题在会话里的逐空结果。 */
export function slotResultsOf(results: WenguSessionResult[], qid: string): WenguSessionResult[] {
    const prefix = `${qid}#`;
    return results.filter((r) => r.qid.startsWith(prefix) && /^\d+$/.test(r.qid.slice(prefix.length)));
}

/** 构建一张题卡的初始态（新卡与恢复卡同一条路）。 */
export function buildCardInit(q: WenguQuestion, ctx: CardInitCtx): CardUi {
    const ui: CardUi = {
        letters: "",
        judge: "",
        mine: "",
        thought: "",
        thoughtOpen: false,
        graded: false,
        locked: ctx.locked,
        revealed: false,
        submitted: "",
        resultHtml: "",
        resultStatus: "",
        note: "",
        selfOn: false,
        selfLabel: ctx.t("selfAssess"),
        aiComment: "",
        aiVerdict: "",
        aiJudged: false,
        stepCur: 0,
        stepOks: "",
        stepPersist: true,
        rtError: "",
        rtMode: false,
    };
    if (hasSteps(q)) {
        ui.steps = [];
        initSteps(q, ui, ctx);
    } else if (hasSlots(q)) {
        initSlots(q, ui, ctx);
    } else if (ctx.restore) {
        initRestoredNormal(q, ui, ctx);
    }
    return ui;
}

/* ── 普通卡恢复（旧 restoreSubmitted + revealCard 的恢复路径） ── */

function initRestoredNormal(q: WenguQuestion, ui: CardUi, ctx: CardInitCtx): void {
    const r = ctx.restore!.byQid.get(q.id);
    if (!r) return;
    ui.graded = true;
    // 锁定只跟揭示走（Issue #12 B2③）：after 模式未收卷的进行中轮，
    // 恢复回来的已答题**仍可修改**（旧实现无条件 locked=true，重开
    // 页签/「继续上次」就把编辑窗口关死了）；已收卷（revealNow）或
    // instant 模式照旧锁。
    const revealed = ctx.restore!.revealNow;
    ui.locked = revealed || !ctx.restore!.batch;
    ui.submitted = r.submitted;
    if (isChoice(q)) ui.letters = r.submitted;
    else if (q.type === QuestionType.Judge) ui.judge = r.submitted;
    else ui.mine = r.submitted;
    if (!revealed) {
        ui.resultHtml = esc(ctx.t("answeredPending"));
        ui.resultStatus = "warn";
        return;
    }
    ui.revealed = true;
    if (isObjective(q)) {
        setResult(
            ui,
            r.ok ? ctx.t("correct") : `${ctx.t("wrong")}${ctx.t("answerLabel")}${q.answer ?? ""}`,
            r.ok ? "right" : "wrong"
        );
    } else {
        const verdict = r.verdict ?? (r.ok ? "right" : "wrong");
        ui.aiVerdict = verdict;
        if (r.comment) ui.aiComment = r.comment;
        setResult(
            ui,
            verdict === "right" ? ctx.t("correct") : verdict === "partial" ? ctx.t("verdictPartial") : ctx.t("wrong"),
            verdict === "right" ? "right" : verdict === "partial" ? "partial" : "wrong"
        );
        ui.selfOn = true;
        ui.selfLabel = ctx.t("rejudgeHint");
    }
}

/** 结果行（icon 前缀由状态派生，此处只存正文与状态）。 */
function setResult(ui: CardUi, html: string, status: ResultStatus): void {
    ui.resultHtml = html;
    ui.resultStatus = status;
}
/* ── steps 初始/恢复 ── */

/** 选项快照（渲染 html 预建，判分描色后补 mark）。 */
function optSnaps(optionMd: string[]): OptSnap[] {
    return optionMd.map((md, i) => {
        const { body, tier } = optionInline(optionDisplayMd(md));
        return { letter: LETTERS[i] ?? "", html: body, tier, mark: 0 as const };
    });
}

function initSteps(q: WenguQuestion, ui: CardUi, ctx: CardInitCtx): void {
    const results = ctx.restore ? stepResultsOf(ctx.restore.results, q.id) : [];
    const byK = new Map(results.map((r) => [r.k, r] as const));
    const steps = q.steps ?? [];
    ui.steps = steps.map((s, k) => {
        const step: StepUi = {
            kind: s.kind,
            badge: s.kind === "method" ? ctx.t("stepMethodBadge") : ctx.t("stepResultBadge"),
            stemHtml: s.stemMd ? mdFragmentHtml(s.stemMd) : "",
            opts: optSnaps(s.optionMd),
            selected: "",
            graded: false,
            ok: false,
            resultHtml: "",
            resultCls: "",
            resultOn: false,
            hidden: k > 0,
            locked: false,
            appeal: "",
        };
        const r = byK.get(k);
        if (r) {
            step.selected = r.submitted;
            step.graded = true;
            step.ok = r.ok;
            step.locked = true;
            step.hidden = false;
            markStepOpts(s, step, r.submitted);
            setStepResult(step, stepResultText(s, r.ok, ctx.t), r.ok ? "wengu-right" : "wengu-wrong");
            ui.stepCur = k + 1;
        }
        return step;
    });
    const answered = results.length;
    if (answered > 0 && answered >= steps.length) {
        // 完整作答：锁定收口（旧 restoreStepsCard 完整分支）
        const oks = results.map((r) => r.ok);
        const allOk = oks.every(Boolean);
        ui.graded = true;
        ui.locked = true;
        // 已完成 steps 卡恢复同揭示（Issue #12 B4 复审修正）：解析区只认
        // .wengu-revealed，恢复的完成卡与当场做完的卡同态——否则重开页签
        // 后解析区永久隐藏。部分作答分支维持隐藏（该卡尚未收口）。
        ui.revealed = true;
        ui.stepOks = oks.map((ok) => (ok ? "1" : "0")).join("");
        setResult(
            ui,
            allOk ? ctx.t("stepAllCorrect") : fmt(ctx.t("stepWrongAt"), { n: String(firstWrong(oks) + 1) }),
            allOk ? "right" : "wrong"
        );
    } else if (answered > 0) {
        // 部分作答：解锁第一个未答步待续
        const next = ui.steps[answered];
        if (next) {
            next.hidden = false;
            ui.stepCur = answered;
        }
    }
}

/** 步选项描色（正确项绿、误选红；旧 paintOptions 语义）。 */
export function markStepOpts(step: WenguStep, ui: StepUi, submitted: string): void {
    for (const opt of ui.opts) {
        const idx = LETTERS.indexOf(opt.letter);
        if (idx < 0) continue;
        if (stepOptionIsRight(step, idx)) opt.mark = 1;
        else if (submitted.includes(opt.letter)) opt.mark = 2;
    }
}

/** 步结果行正文（对/错+答案；method 步给可行集合）。 */
function stepResultText(step: WenguStep, ok: boolean, t: (k: string) => string): string {
    if (ok) return t("correct");
    const label = step.kind === "method" ? fmt(t("stepFeasibleLabel"), { s: step.answer }) : step.answer;
    return `${t("wrong")}${t("answerLabel")}${label}`;
}

/** 步结果行落笔（icon 前缀按描色态拼，warn/muted 无 icon）。 */
export function setStepResult(
    step: StepUi,
    html: string,
    cls: "" | "wengu-right" | "wengu-wrong" | "wengu-muted"
): void {
    step.resultOn = true;
    step.resultCls = cls;
    step.resultHtml =
        (cls === "wengu-right" ? statusIcon("right") : cls === "wengu-wrong" ? statusIcon("wrong") : "") + html;
}

function firstWrong(oks: boolean[]): number {
    return oks.findIndex((ok) => !ok);
}

/** AI 实时模式追加一步（StepsFlow 调；内容预渲染）。 */
export function appendRealtimeStep(ui: CardUi, step: WenguStep, k: number, t: (k2: string) => string): void {
    ui.steps!.push({
        kind: step.kind,
        badge: step.kind === "method" ? t("stepMethodBadge") : t("stepResultBadge"),
        stemHtml: step.stemMd ? mdFragmentHtml(step.stemMd) : "",
        opts: optSnaps(step.optionMd),
        selected: "",
        graded: false,
        ok: false,
        resultHtml: "",
        resultCls: "",
        resultOn: false,
        hidden: false,
        locked: false,
        appeal: "",
    });
    ui.stepCur = k + 1;
}

/** 实时失败回落离线：重建静态步骤从头作答（旧 showRealtimeError 回落）。 */
export function resetStepsOffline(q: WenguQuestion, ui: CardUi, ctx: CardInitCtx): void {
    ui.rtError = "";
    initSteps(q, ui, { ...ctx, restore: undefined });
}

/* ── slots 初始/恢复 ── */

function initSlots(q: WenguQuestion, ui: CardUi, ctx: CardInitCtx): void {
    const slots = q.slots ?? [];
    const results = ctx.restore ? slotResultsOf(ctx.restore.results, q.id) : [];
    const done = new Map<number, { letter: string; ok: boolean }>();
    for (const r of results) {
        const k = Number(r.qid.slice(q.id.length + 1));
        if (Number.isInteger(k) && k >= 0 && k < slots.length) done.set(k, { letter: r.submitted, ok: r.ok });
    }
    const marks: SlotMark[] = slots.map((_, k) => {
        const d = done.get(k);
        return d ? { answered: true, letter: d.letter, ok: d.ok } : { answered: false, letter: "", ok: false };
    });
    const kind = q.type === QuestionType.Match ? "match" : "cloze";
    ui.slots = { kind, marks, cur: 0, curStem: "", curOpts: [], curSelected: "", curLocked: false };
    if (kind === "cloze") fillClozeCur(q, ui, ctx.t); // 新卡也要灌首空（旧 bindCloze 首帧 render）
    if (done.size === 0) return;
    if (done.size < slots.length) {
        // 部分作答：整卡不判满，首个未答空接着作答（旧对称语义）
        return;
    }
    const allOk = marks.every((m) => m.ok);
    ui.graded = true;
    ui.locked = true;
    ui.revealed = true; // 完整作答恢复同揭示（同上：解析区只认 .wengu-revealed）
    setResult(
        ui,
        allOk
            ? ctx.t("correct")
            : fmt(ctx.t("slotsSummary"), { r: String(marks.filter((m) => m.ok).length), n: String(slots.length) }),
        allOk ? "right" : "wrong"
    );
}

/** 灌当前空（引导语 + 选项快照；旧 fillClozeSlot 语义，html 预建）。 */
export function fillClozeCur(q: WenguQuestion, ui: CardUi, t: (k: string) => string): void {
    const s = ui.slots!;
    const slots = q.slots ?? [];
    while (s.cur < slots.length && s.marks[s.cur].answered) s.cur++;
    if (s.cur >= slots.length) return; // 全部作答完（提交钮隐藏由派生）
    s.curStem = t("slotNO").replace("{n}", String(s.cur + 1));
    s.curOpts = optSnaps(slots[s.cur].optionMd);
    s.curSelected = "";
    s.curLocked = false;
}

/** 判分后给当前空选项描色并锁定（旧 markClozeOptions）。 */
export function markClozeOpts(q: WenguQuestion, ui: CardUi, letter: string): void {
    const s = ui.slots!;
    const slot = (q.slots ?? [])[s.cur];
    if (!slot) return;
    s.curLocked = true;
    for (const opt of s.curOpts) {
        const idx = LETTERS.indexOf(opt.letter);
        if (idx < 0) continue;
        if (slotOptionIsRight(slot, idx)) opt.mark = 1;
        else if (opt.letter === letter) opt.mark = 2;
    }
}

/** 恢复上下文（挂载编排一次算好，全部卡片共用）。
 *
 *  揭示判据（Issue #12 B3 复审修正）：after 模式的揭示**只看轮次是否已
 *  封卷**（`session.endedAt` 已写）。B3「答满不自动收卷」落地后「答满但
 *  未收卷」成了可持久化状态（旧实现答满即自动收卷，该状态不存在），若
 *  仍按「答满」判揭示，重开页签/「继续上次」会把全卷恢复成已揭示+锁定：
 *  答案泄了、编辑窗口也被关死。「答满提示」另走 QuizView.onAllAnswered
 *  链路，与揭示判据无关。存量兼容天然成立——
 *  旧 after 轮答满时必已被自动收卷（endedAt 已写）；instant 恒真不变；
 *  未答满的进行中轮不变（两种判据同取假）。 */
export function restoreContextFor(
    list: WenguQuestion[],
    session: WenguSession | undefined,
    revealMode: WenguRevealMode
): CardInitCtx["restore"] | undefined {
    // 空卡卷无恢复可言；`list` 保持实参与其它判据同源（不再改成 _list，
    // 留个显式的空卷守卫比下划线占位有用——见下方签名）
    if (!session || session.results.length === 0 || list.length === 0) return undefined;
    return {
        results: session.results,
        byQid: new Map(session.results.map((r) => [r.qid, r] as const)),
        revealNow: revealMode === "instant" || !!session.endedAt,
        batch: revealMode === "after",
    };
}

/** 结果行完整 html（icon 前缀按状态拼，组件与结果写入共用）。 */
export function resultRowHtml(ui: CardUi): string {
    if (!ui.resultStatus) return ui.resultHtml;
    return (ui.resultStatus === "warn" ? "" : statusIcon(ui.resultStatus)) + ui.resultHtml;
}

/** 字母 chip 描色判定（组件派生用；revealed 才描对错）。 */
export function chipMarkOf(q: WenguQuestion, ui: CardUi, idx: number): 0 | 1 | 2 {
    if (!ui.revealed || !isChoice(q)) return 0;
    return optionIsRight(q, idx) ? 1 : ui.submitted.includes(LETTERS[idx] ?? "") ? 2 : 0;
}
