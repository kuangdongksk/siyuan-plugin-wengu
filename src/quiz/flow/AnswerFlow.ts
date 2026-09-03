import { errText } from "./../../ui/shared";
import { judgeBrief } from "../service/AiJudge";
import { isObjective } from "../render/CardHtml";
import type { WenguSession } from "../service/HistoryStore";
import type { TimerController } from "../service/TimerController";
import { syncGroupReveal } from "./MaterialFlow";
import { gradeQuestion } from "../service/QuestionGrading";
import { markNum } from "../render/FlowDom";
import { markNumRailAnswered } from "../render/NumRail";
import { allCards, allCardsGraded } from "../render/CardRegistry";
import type { CardCtl } from "../render/CardCtl";
import type { WenguQuestion } from "../../types";
import { isBriefLike, QuestionType } from "../../types";
import { esc, fmt, mmss } from "../../ui/shared";

/**
 * 作答流程（6-4b 状态化）：卡片事件由 QuizCardApp 组件直调本流程
 * （pickLetter/pickJudge/submitQuestion/selfAssess），判定走纯函数判分
 * （gradeQuestion）+ 当前会话与题库镜像（host.recordAnswer——20260831
 * 起运行时统计自托管，块属性停写）；DOM 只做展示
 * → 全部写 CardCtl.ui 响应态。多步（steps）与逐空（slots）题分别
 * 委派给 StepsFlow/SlotFlow；brief 的 AI 判分委派 AiJudge。
 */

/** AnswerFlow 需要的宿主能力（QuizView 实现这组薄接口）。 */
export interface AnswerHost {
    t(key: string): string;
    container(): HTMLElement;
    questions(): WenguQuestion[];
    currentRevealMode(): "instant" | "after";
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
    /** 整题收口镜像（steps/slots）：题库按整题记一次，detail 携带
     *  逐空/逐步细粒度（自托管后块属性停写，统计唯一落点在题库）。 */
    bankMirror?(
        qid: string,
        submitted: string,
        ok: boolean,
        detail?: { kind: "steps" | "slots"; letters: string[]; oks: boolean[]; persist?: boolean }
    ): void;
    /** 改判镜像（brief 纠错/steps 申诉复核）：只翻 right 微调 wrongCount。 */
    bankOverride?(qid: string, correct: boolean, detail?: { kind: "steps"; letters: string[]; oks: boolean[] }): void;
    /** 本轮完成（全部作答或手动收卷）：显示总结报告。 */
    roundComplete(): void;
    flushTime(): void;
    /** 当前题切换（题号导航/组内导航）：同步下标、逐题计时、线索行。
     *  可选——QuizView 之外的宿主（测试/预览壳）不实现即跳过同步。 */
    onActiveQ?(idx: number): void;
}

/** 字母 chip 点选：单选互斥（重选保持选中），多选可增删（序保持升序）。 */
export function pickLetter(ctl: CardCtl, letter: string): void {
    if (ctl.graded) return;
    const ui = ctl.ui;
    if (ctl.q.type === QuestionType.Single) {
        ui.letters = letter;
        return;
    }
    const next = ui.letters.includes(letter)
        ? ui.letters.split("").filter((c) => c !== letter)
        : [...ui.letters, letter];
    ui.letters = next.sort().join("");
}

/** 判断题 √/× 点选（互斥即覆盖）。 */
export function pickJudge(ctl: CardCtl, judge: string): void {
    if (!ctl.graded) ctl.ui.judge = judge;
}

export async function submitQuestion(host: AnswerHost, q: WenguQuestion, ctl: CardCtl): Promise<void> {
    if (ctl.graded) return;
    const objective = isObjective(q);
    const submitted = ctl.submitted();
    if (objective && !submitted) {
        ctl.setResult(esc(host.t("noAnswer")), "warn");
        return;
    }
    const batch = host.currentRevealMode() === "after";
    ctl.setGraded();
    host.flushTime();
    if (!objective) {
        // brief（含英语 essay/trans）：AI 判分并计入（AI 不可用回落自评）；
        // 多步题在 StepsFlow，缺题型/答案属性的题维持自评（after 模式
        // 下自评也等统一揭示）
        if (isBriefLike(q) && submitted) {
            await judgeBriefAnswer(host, q, ctl, submitted, batch);
            return;
        }
        if (batch) {
            markNumAnswered(host, q);
            checkAllDone(host);
            return;
        }
        ctl.showSelf(); // 缺题型/答案属性的题：揭示后自评
        return;
    }
    const ok = gradeQuestion(q, submitted);
    host.recordAnswer(q.id, submitted, ok);
    if (batch) {
        // 统一展示：先只记「已作答」，不揭对错（避免剧透）
        ctl.setResult(esc(host.t("answeredPending")), "warn");
        markNumAnswered(host, q);
        checkAllDone(host);
        return;
    }
    revealCard(host, ctl, q, { submitted, ok });
    showQTime(host, ctl, q.id);
    checkAllDone(host);
}

/** 自评按钮（brief 经 AI 判分后语义变为「改判」appealGrade）。 */
export async function selfAssess(host: AnswerHost, q: WenguQuestion, ctl: CardCtl, correct: boolean): Promise<void> {
    if (ctl.ui.aiJudged) await appealGrade(host, q, ctl, correct);
    else await selfGrade(host, q, ctl, correct);
}

/** brief 自评：对错由用户判定，同样记账。 */
async function selfGrade(host: AnswerHost, q: WenguQuestion, ctl: CardCtl, correct: boolean): Promise<void> {
    const mine = ctl.submitted();
    markNum(host, q, correct);
    host.recordAnswer(q.id, mine, correct);
    ctl.hideSelf();
    ctl.setResult(correct ? esc(host.t("correct")) : esc(host.t("wrong")), correct ? "right" : "wrong");
    showQTime(host, ctl, q.id);
    syncGroupReveal(host.container(), host.questions());
    checkAllDone(host);
}

/** brief 提交：AI 判分并计入（串行队列），结果行显示评语，保留改判；
 *  AI 失败/超时回落纯自评。 */
async function judgeBriefAnswer(
    host: AnswerHost,
    q: WenguQuestion,
    ctl: CardCtl,
    submitted: string,
    batch: boolean
): Promise<void> {
    host.flushTime();
    if (!batch) ctl.setNote(host.t("aiJudging"));
    try {
        // 「思路」折叠区若填了内容，一并交给 AI（判 partial 的重要素材）
        const thought = ctl.ui.thought.trim();
        const v = await judgeBrief(q, submitted, host.aiModelId(), thought);
        ctl.ui.aiJudged = true;
        ctl.setAi(v.verdict, v.comment);
        host.recordAnswer(q.id, submitted, v.ok, { verdict: v.verdict, comment: v.comment, cause: v.cause });
        if (batch) {
            markNumAnswered(host, q);
            checkAllDone(host);
            return;
        }
        markNum(host, q, v.ok);
        ctl.setResult(briefResultText(host, v.verdict), verdictStatus(v.verdict));
        revealBriefExtras(host, ctl);
        showQTime(host, ctl, q.id);
        checkAllDone(host);
    } catch (e) {
        // AI 失败不再静默丢账（该题不进会话、收卷统计少一题）——提示 +
        // 露自评钮补账（20260828 二轮审查）
        const msg = `${host.t("aiJudgeFailed")}${errText(e)}`;
        ctl.setNote(msg);
        ctl.showSelf();
        if (batch) {
            markNumAnswered(host, q);
            checkAllDone(host);
        }
    }
}

/** 揭示 brief 的评语与改判按钮（即时判分与统一揭示共用）。 */
function revealBriefExtras(host: AnswerHost, ctl: CardCtl): void {
    ctl.showSelf(host.t("rejudgeHint"));
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

/** brief 改判（AI 误判纠错）：翻题库 right、微调 wrongCount，
 *  会话结果原位改写（不动 attempts/answered）。 */
async function appealGrade(host: AnswerHost, q: WenguQuestion, ctl: CardCtl, correct: boolean): Promise<void> {
    host.bankOverride?.(q.id, correct);
    appealSessionResult(host, q.id, correct);
    markNum(host, q, correct);
    ctl.hideSelf();
    ctl.setResult(correct ? esc(host.t("correct")) : esc(host.t("wrong")), correct ? "right" : "wrong");
}

/** 判分后提示本题用时（秒数在所有模式都记录，统一展示）。 */
function showQTime(host: AnswerHost, ctl: CardCtl, qid: string): void {
    const sec = host.timerController().questionSec(qid);
    if (sec > 0) ctl.setNote(fmt(host.t("perQTime"), { t: mmss(sec) }));
}

/** after 模式全部作答完后统一揭示：判分、chip 描色、答案解析、总结。 */
export async function revealAll(host: AnswerHost): Promise<void> {
    const s = host.currentSession();
    const byQid = new Map((s?.results ?? []).map((r) => [r.qid, r] as const));
    for (const ctl of allCards()) {
        const r = byQid.get(ctl.q.id);
        if (r) revealCard(host, ctl, ctl.q, r);
        else if (!isObjective(ctl.q)) {
            // after 模式下已提交但未自评的简答题：揭示后补自评
            ctl.showSelf();
        }
    }
    host.roundComplete();
}

/** 单卡揭示：答案/解析展开 + 结果与 chip 描色 + 题号上色。
 *  brief 按 AI 三态展示（partial 单列），恢复/统一揭示时从会话结果
 *  取 verdict 与评语。 */
export function revealCard(
    host: AnswerHost,
    ctl: CardCtl,
    q: WenguQuestion,
    r: { submitted: string; ok: boolean; verdict?: string; comment?: string }
): void {
    markNum(host, q, r.ok);
    if (isObjective(q)) {
        ctl.reveal(r.submitted); // chip 描色派生（right/wrong 由 optionIsRight 算）
        ctl.setResult(
            r.ok
                ? esc(host.t("correct"))
                : `${esc(host.t("wrong"))}${esc(host.t("answerLabel"))}${esc(q.answer ?? "")}`,
            r.ok ? "right" : "wrong"
        );
    } else {
        // brief：结果行按三态（恢复时状态无 aiVerdict 则用会话 verdict 兜底）
        const verdict = ctl.ui.aiVerdict || r.verdict || (r.ok ? "right" : "wrong");
        if (r.comment && !ctl.ui.aiComment) ctl.ui.aiComment = r.comment;
        ctl.setResult(briefResultText(host, verdict), verdictStatus(verdict));
        revealBriefExtras(host, ctl);
    }
    // 材料组：组内题目全部判分后揭示共享材料的译文（E0 防剧透规则）
    syncGroupReveal(host.container(), host.questions());
}

/** 全部作答后收口：after 模式先统一揭示（revealAll 会再触发总结），
 *  instant 模式直接给总结报告。StepsFlow 完成多步卡后也走这里。 */
export function checkAllDone(host: AnswerHost): void {
    if (!allCardsGraded()) return;
    if (host.currentRevealMode() === "after") void revealAll(host);
    else host.roundComplete();
}

/** after 模式：已作答但尚未揭示的题，题号只标「已答」不透对错
 *  （写进题号栏组件响应态）。 */
function markNumAnswered(host: AnswerHost, q: WenguQuestion): void {
    markNumRailAnswered(host.questions().indexOf(q) + 1);
}

/** brief 三态的结果行文案。 */
function briefResultText(host: AnswerHost, verdict: string): string {
    if (verdict === "right") return esc(host.t("correct"));
    if (verdict === "partial") return esc(host.t("verdictPartial"));
    return esc(host.t("wrong"));
}

type ResultStatus = "right" | "wrong" | "partial" | "warn";

function verdictStatus(verdict: string): ResultStatus {
    return verdict === "right" ? "right" : verdict === "partial" ? "partial" : "wrong";
}
