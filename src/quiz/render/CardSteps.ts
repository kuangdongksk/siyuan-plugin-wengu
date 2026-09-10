import { fmt } from "../../ui/shared";
import type { WenguSessionResult } from "../service/HistoryStore";
import { stepOptionIsRight } from "../service/QuestionGrading";
import { mdFragmentHtml, optionInline } from "../service/ProtyleHost";
import { LETTERS, optionDisplayMd } from "../../types";
import type { WenguQuestion, WenguStep } from "../../types";
import { statusIcon } from "../../ui/FormHtml";
import type { CardInitRestore, CardUi, OptSnap, StepUi } from "./CardState";

/**
 * 多步（steps）卡的响应态构建与全步揭示落格（Issue #21 从 CardState
 * 外移压 500 行红线）：题卡三形态里 steps 独有一整套步级状态，恢复
 * 分账（题级账 vs 逐步账）与揭示落格都在这里。CardState 只保留
 * buildCardInit 的分派入口。
 */

/** 逐步账快照（Issue #21）：会话里 `qid#k` 条目按步序对齐成定长数组。
 *  **空串条目一律滤除**——空串不是作答（「不会」只写题级账），把它当
 *  作答会把该步渲染成「错误 + 答案」的半揭示；越界步号同样丢弃。 */
export interface StepsSnapshot {
    letters: string[];
    oks: boolean[];
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

export function stepsSnapshotOf(results: WenguSessionResult[], qid: string, count: number): StepsSnapshot {
    const letters: string[] = new Array(count).fill("");
    const oks: boolean[] = new Array(count).fill(false);
    for (const r of stepResultsOf(results, qid)) {
        if (r.submitted === "" || r.k < 0 || r.k >= count) continue;
        letters[r.k] = r.submitted;
        oks[r.k] = r.ok;
    }
    return { letters, oks };
}

/** 选项快照（渲染 html 预建，判分描色后补 mark）。 */
function optSnaps(optionMd: string[]): OptSnap[] {
    return optionMd.map((md, i) => {
        const { body, tier } = optionInline(optionDisplayMd(md));
        return { letter: LETTERS[i] ?? "", html: body, tier, mark: 0 as const };
    });
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

/** 步答案文案（method 给可行集合，result 给正确答案）。 */
export function stepAnswerLabel(step: WenguStep, t: (k: string) => string): string {
    return step.kind === "method" ? fmt(t("stepFeasibleLabel"), { s: step.answer }) : step.answer;
}

/** 步结果行正文（对/错+答案；method 步给可行集合）。 */
function stepResultText(step: WenguStep, ok: boolean, t: (k: string) => string): string {
    if (ok) return t("correct");
    return `${t("wrong")}${t("answerLabel")}${stepAnswerLabel(step, t)}`;
}

function firstWrong(oks: boolean[]): number {
    return oks.findIndex((ok) => !ok);
}

/** 逐步账分账（Issue #21）：逐步账（qid#k）与题级账（qid）在会话里是
 *  两个条目——「不会」只写题级空串（步骤一条都没答，不逐格写空串：
 *  库里没有「答过这步」的记录，逐格空串账会污染逐步统计），恢复时
 *  按题级账形态分流：
 *  - dunno：题级空串 = 主动认输 → 走全步揭示（已收卷）或挂起态；
 *  - answered：逐步账条数（部分作答解锁下一格用）；
 *  - letters/oks：逐步账本身，**滤掉空串**（同 stepsSnapshotOf）。 */
interface StepsBand {
    dunno: boolean;
    revealNow: boolean;
    answered: number;
    letters: string[];
    oks: boolean[];
}

function stepsBand(q: WenguQuestion, restore: CardInitRestore | undefined): StepsBand {
    const all = restore ? stepResultsOf(restore.results, q.id) : [];
    const snap = stepsSnapshotOf(restore?.results ?? [], q.id, q.steps?.length ?? 0);
    const own = restore?.byQid.get(q.id);
    const answered = all.filter((r) => r.submitted !== "").length;
    return {
        // 题级空串 = 主动认输，**且逐步账为空**（after 模式认输后反悔改了
        // 正常作答时题级账仍在——逐步账非空即按作答恢复，不误判成「不会」）
        dunno: own?.submitted === "" && !own.ok && answered === 0,
        revealNow: !!restore?.revealNow,
        answered,
        letters: snap.letters,
        oks: snap.oks,
    };
}

/** 多步卡的初始/恢复态（新卡与恢复卡同一条路）。 */
export function initSteps(
    q: WenguQuestion,
    ui: CardUi,
    ctx: { t: (k: string) => string; restore?: CardInitRestore }
): void {
    const steps = q.steps ?? [];
    const band = stepsBand(q, ctx.restore);
    const byK = new Map(stepResultsOf(ctx.restore?.results ?? [], q.id).map((r) => [r.k, r] as const));
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
        if (r && r.submitted !== "") {
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
    if (band.dunno) {
        initStepsDunno(q, ui, ctx.t, band.revealNow);
        return;
    }
    const answered = band.answered;
    if (answered > 0 && answered >= steps.length) {
        // 完整作答：锁定收口（旧 restoreStepsCard 完整分支）
        const oks = band.oks;
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
        // 部分作答：解锁**第一个未落格的步**待续（按实际步态定位，不按
        // 逐步账条数——逐步账可能带空洞，按下标取会错位）
        const resume = (ui.steps ?? []).findIndex((su) => !su.graded);
        if (resume >= 0) {
            ui.steps![resume].hidden = false;
            ui.stepCur = resume;
        }
    }
}

/** 「不会」的 steps 恢复（Issue #21 验收第 5 条）：
 *  - 已收卷/instant：全步一次揭示 + 锁定 + 题号标错（与当场「不会」同态）；
 *  - after 未收卷：只认「已作答」可反悔——**不揭示不锁**，且步格全部
 *    展开成干净未作答态（让步格亮 dunnoMarked/答案就是部分步有内容、
 *    部分步空白的半揭示）。 */
function initStepsDunno(q: WenguQuestion, ui: CardUi, t: (k: string) => string, revealNow: boolean): void {
    if (!revealNow) {
        ui.graded = true;
        ui.locked = false;
        for (const su of ui.steps ?? []) su.hidden = false;
        setResult(ui, t("dunnoMarked"), "warn");
        return;
    }
    const steps = q.steps ?? [];
    settleSteps(q, ui, { t });
    ui.graded = true;
    ui.locked = true;
    ui.revealed = true;
    ui.stepOks = steps.map(() => "0").join("");
    setResult(ui, t("dunnoMarked"), "wrong");
}

/** 全步揭示的逐格落格（Issue #21 收口共用）：
 *  按快照把每步的选取/判分/描色/结果行补齐，再整片锁定——组件
 *  `.wengu-step` 的 disabled 闸只看 `step.locked`，锁定必须显式遍历，
 *  否则收卷/「不会」后步选项仍可点。
 *
 *  **无快照时只补未落格的步**（Issue #21 复审修复）：本函数既当场收口
 *  （finishCard 带准确 letters/oks）又兜底揭示（收卷统一揭示 / 恢复 /
 *  「不会」，拿不到逐格快照）。若无条件按「空串 + 全错」重写，当场答完
 *  的卡会被覆盖成「全错 + 空选」——真机表现为答完答案行全变错。
 *  故无快照时已 graded 的步原样保留，只补没落格的。 */
export function settleSteps(
    q: WenguQuestion,
    ui: CardUi,
    ctx: { t: (k: string) => string; letters?: string[]; oks?: boolean[] }
): void {
    const steps = q.steps ?? [];
    const hasSnap = ctx.letters !== undefined;
    for (const [k, step] of steps.entries()) {
        const su = ui.steps?.[k];
        if (!su) continue; // AI 实时模式步原型可能与静态步数不一致
        su.hidden = false;
        if (!hasSnap && su.graded) continue; // 兜底揭示：已落格的步保留原样
        const letter = ctx.letters?.[k] ?? "";
        const ok = ctx.oks?.[k] ?? false;
        su.selected = letter;
        su.graded = true;
        su.ok = ok;
        markStepOpts(step, su, letter);
        setStepResult(
            su,
            ok ? ctx.t("correct") : `${ctx.t("wrong")}${ctx.t("answerLabel")}${stepAnswerLabel(step, ctx.t)}`,
            ok ? "wengu-right" : "wengu-wrong"
        );
        // 申诉钮只挂「真有作答的答错方法步」：没答过的步无从复核所选
        su.appeal = !ok && step.kind === "method" && letter !== "" ? "idle" : "";
    }
    for (const su of ui.steps ?? []) su.locked = true;
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
export function resetStepsOffline(q: WenguQuestion, ui: CardUi, t: (k: string) => string): void {
    ui.rtError = "";
    initSteps(q, ui, { t });
}

/** 结果行落笔（steps 模块自用，避免与 CardState 的私有 setResult 互引）。 */
function setResult(ui: CardUi, html: string, status: "right" | "wrong" | "warn"): void {
    ui.resultHtml = html;
    ui.resultStatus = status;
}
