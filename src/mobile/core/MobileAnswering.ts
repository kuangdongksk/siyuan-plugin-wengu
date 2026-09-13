import type { WenguQuestion } from "../../types";
import { AUTO_GRADE_TYPES, QuestionType, baseQid } from "../../types";
import { gradeQuestion } from "../../quiz/service/QuestionGrading";
import { judgeBrief } from "../../quiz/service/AiJudge";
import { mirrorAnswer, mirrorOverride, mirrorRepeatAnswer } from "../../quiz/service/AnswerMirror";
import { pushSessionAnswer } from "../../quiz/service/HistoryStore";
import type { WenguSessionResult } from "../../quiz/service/HistoryStore";
import { errText } from "../../ui/shared";
import { notifyInfo } from "../../ui/Notify";
import { isMobileText } from "./MobileModel";
import type { MobileCardState, MobileDrill } from "./MobileDrill";

/**
 * 移动端作答流程（自 MobileDrill 外移压 500 行红线，函数式友元——同
 * BankRegen/AnswerMirror 口径：接 drill 实例，读写 d.ui）：
 * 点选 / 文本写回 / 提交 / AI 判分 / 自评改判 / 「不会」/ 跳过，以及
 * 记账与判分呈现。
 *
 * ⚠️ **三态收口必须与桌面同口径**（见 AGENTS.md「揭示态/锁定态/记账态
 * 是三件事」）：即时判分 = graded + locked + revealed 一把置；收卷模式
 * 提交只置 graded +「已答」，locked/revealed 留到交卷。作答位守卫一律
 * 用 `frozen`（revealed || locked），别写 graded——那会打死「after 收卷
 * 前改答案」。
 */

/** 冻结判据（揭示或锁定；桌面 answeredFrozen 同口径）。 */
export function frozen(ui: MobileCardState): boolean {
    return ui.revealed || ui.locked;
}

/** 客观题（可自动判分）。 */
function isObjective(q: WenguQuestion): boolean {
    return q.type !== undefined && AUTO_GRADE_TYPES.includes(q.type) && !!q.answer;
}

/** AI 三态的结果行文案（与桌面 briefResultText 同口径）。 */
function verdictText(t: (k: string) => string, verdict: string): string {
    if (verdict === "right") return t("correct");
    if (verdict === "partial") return t("verdictPartial");
    return t("wrong");
}

export function qOf(d: MobileDrill): WenguQuestion | undefined {
    return d.ui.list[d.ui.qIdx];
}

export function curOf(d: MobileDrill): MobileCardState | undefined {
    return d.ui.cards[d.ui.qIdx];
}

/** 选项点选 / 判断题点选（单选与判断互斥、多选增删；已揭示或锁定即冻结）。
 *  判断题的「√ / ×」两钮也走本入口（组件只绑一个回调）。 */

export function pickLetter(d: MobileDrill, letter: string): void {
    const q = qOf(d);
    const ui = curOf(d);
    if (!q || !ui || frozen(ui)) return;
    if (q.type === QuestionType.Judge) {
        ui.judge = letter;
        ui.letters = "";
        return;
    }
    if (q.type === QuestionType.Single) {
        ui.letters = letter;
        ui.judge = "";
        return;
    }
    const next = ui.letters.includes(letter)
        ? ui.letters.split("").filter((c) => c !== letter)
        : [...ui.letters, letter];
    ui.letters = next.sort().join("");
}

/** 文本作答（受控写回）。 */

export function setMine(d: MobileDrill, text: string): void {
    const ui = curOf(d);
    if (ui && !frozen(ui)) ui.mine = text;
}

/** 当前题的作答串（提交通道口径）。 */

function submittedOf(q: WenguQuestion, ui: MobileCardState): string {
    if (q.type === QuestionType.Single || q.type === QuestionType.Multiple) return ui.letters;
    if (q.type === QuestionType.Judge) return ui.judge;
    return ui.mine.trim();
}

/** 提交（客观题即时判分；简答走 AI 判分；after 只记已答）。 */

export async function submit(d: MobileDrill): Promise<void> {
    const q = qOf(d);
    const ui = curOf(d);
    if (!q || !ui || frozen(ui) || ui.busy) return;
    // 多步题在移动端**不做逐步作答**：桌面 StepsFlow 的步态/申诉链
    // 属重型交互，小屏上无落脚点。按「整题文本作答」处理——steps 卡
    // 由 isText 分支给多行输入区，判分走 brief 同族（AI 判分）。
    const submitted = submittedOf(q, ui);
    const objective = isObjective(q);
    if (objective && !submitted) {
        ui.resultText = d.t("noAnswer");
        return;
    }
    const batch = d.ui.setup.reveal === "after";
    // 简答类（含 essay/trans）走 AI 判分：**收卷模式也要先判分**才能在
    // 交卷时给三态评语（与桌面 judgeBriefAnswer 同款——桌面在 after 下
    // 同样调 AI，只是结果行只显示「已答」）
    if (!objective && isMobileText(q) && submitted) {
        if (batch) {
            record(d, q, submitted, false, batch);
            ui.graded = true;
            ui.resultText = d.t("answeredPending");
            void judgeBriefCard(d, q, ui, submitted, true).then(() => checkAllDone(d));
            checkAllDone(d);
            return;
        }
        await judgeBriefCard(d, q, ui, submitted, false);
        return;
    }
    const ok = objective ? gradeQuestion(q, submitted) : false;
    record(d, q, submitted, ok, batch);
    if (batch) {
        ui.graded = true;
        ui.resultText = d.t("answeredPending");
        checkAllDone(d);
        return;
    }
    ui.graded = true;
    ui.locked = true;
    ui.revealed = true;
    ui.ok = ok;
    applyVerdict(d, d.ui.qIdx, q, ok);
    if (!objective) ui.selfOn = true;
    checkAllDone(d);
}

/** 简答/作文 AI 判分（挂单飞闸；失败回落自评）。
 *  收卷模式（batch）下**只回填三态与评语**，不揭答案不锁卡——
 *  揭示留到交卷（与桌面 after 口径一致）。 */

async function judgeBriefCard(
    d: MobileDrill,
    q: WenguQuestion,
    ui: MobileCardState,
    submitted: string,
    batch: boolean
): Promise<void> {
    ui.busy = true;
    try {
        const v = await judgeBrief(q, submitted, d.modelId);
        reRecord(d, q, submitted, v.ok, { verdict: v.verdict, comment: v.comment, cause: v.cause }, batch);
        ui.graded = true;
        ui.ok = v.ok;
        if (batch) return;
        ui.locked = true;
        ui.revealed = true;
        ui.comment = v.comment;
        ui.resultText = verdictText(d.t, v.verdict);
        ui.selfOn = true;
    } catch (e) {
        ui.resultText = `${d.t("aiJudgeFailed")}${errText(e)}`;
        ui.selfOn = true;
    } finally {
        ui.busy = false;
    }
}

/** 自评 / 改判（AI 判分失败兜底与误判纠错）。 */

export function selfAssess(d: MobileDrill, correct: boolean): void {
    const q = qOf(d);
    const ui = curOf(d);
    if (!q || !ui) return;
    const submitted = submittedOf(q, ui);
    const prev = d.ui.session?.results.find((r) => r.qid === q.id);
    const judged = !!prev?.comment || prev?.verdict !== undefined;
    if (judged) {
        // 改判：只翻 right 微调 wrongCount（不动 attempts）
        const hit = d.ui.session?.results.find((r) => baseQid(r.qid) === q.id);
        if (hit && hit.ok !== correct) {
            hit.ok = correct;
            if (d.ui.session) d.ui.session.correct = Math.max(0, d.ui.session.correct + (correct ? 1 : -1));
            if (hit.verdict) hit.verdict = correct ? "right" : "wrong";
        }
        mirrorOverride(d.deps.bank, q.id, correct);
        void d.deps.history?.upsert(d.ui.session!);
    } else {
        reRecord(d, q, submitted, correct, {});
    }
    ui.graded = true;
    ui.locked = true;
    ui.revealed = true;
    ui.ok = correct;
    ui.selfOn = false;
    ui.resultText = correct ? d.t("correct") : d.t("wrong");
    checkAllDone(d);
}

/** 「不会」：题级记一错（空串），即时模式直接揭示，收卷模式只记已答。 */

export function dunno(d: MobileDrill): void {
    const q = qOf(d);
    const ui = curOf(d);
    if (!q || !ui || frozen(ui)) return;
    const batch = d.ui.setup.reveal === "after";
    record(d, q, "", false, batch);
    ui.graded = true;
    if (batch) {
        ui.resultText = d.t("dunnoMarked");
        checkAllDone(d);
        return;
    }
    ui.locked = true;
    ui.revealed = true;
    ui.ok = false;
    const answer = q.answer ? `　${d.t("answerLabel")}${q.answer}` : "";
    ui.resultText = `${d.t("dunnoMarked")}${answer}`;
    checkAllDone(d);
}

/** 跳过（不记账不锁定，只滚到下一题；末题零动作）。 */

export function skip(d: MobileDrill): void {
    if (d.ui.qIdx < d.ui.list.length - 1) d.goto(d.ui.qIdx + 1);
}

/* ── 记账（会话 upsert + 题库镜像，口径与桌面 recordAnswer 同款） ── */

function record(d: MobileDrill, q: WenguQuestion, submitted: string, ok: boolean, batch: boolean): void {
    reRecord(d, q, submitted, ok, {}, batch);
}

function reRecord(
    d: MobileDrill,
    q: WenguQuestion,
    submitted: string,
    ok: boolean,
    extra: { verdict?: "right" | "partial" | "wrong"; comment?: string; cause?: string },
    batch = false
): void {
    const s = d.ui.session;
    if (!s) return;
    const former = s.results.some((r) => r.qid === q.id);
    pushSessionAnswer(s, q.id, submitted, ok, 0, d.ui.elapsedSec, extra);
    void d.deps.history?.upsert(s);
    // 题库镜像：首答 attempts+1，重复提交只覆写 lastAnswer/right（不动 attempts）；
    // 即时模式判分即纳入，收卷模式交卷时才补记（batched 记账在 endRound）
    if (batch) return;
    if (former) mirrorRepeatAnswer(d.deps.bank, q.id, submitted, ok);
    else mirrorAnswer(d.deps.bank, q.id, submitted, ok);
}

/** 判分呈现（选项描色 + 结果行）。 */

/** 答满收口（友元导出，MobileDrill.endRound 与作答流程共用）：
 *  即时模式自动收卷；收卷模式只一次性提示（编辑窗口保持到用户显式交卷）。 */
export function checkAllDone(d: MobileDrill): void {
    const done = d.ui.cards.length > 0 && d.ui.cards.every((c) => c.graded);
    if (!done) return;
    if (d.ui.setup.reveal === "after") {
        if (!d.allAnsweredNotified) {
            d.allAnsweredNotified = true;
            notifyInfo({ key: "allAnsweredPending" });
        }
        return;
    }
    d.endRound();
}

export function applyVerdict(d: MobileDrill, idx: number, q: WenguQuestion, ok: boolean, r?: WenguSessionResult): void {
    const ui = d.ui.cards[idx];
    if (!ui) return;
    ui.ok = ok;
    ui.revealed = true;
    if (r?.comment) ui.comment = r.comment;
    ui.resultText = ok ? d.t("correct") : `${d.t("wrong")}${q.answer ? `${d.t("answerLabel")}${q.answer}` : ""}`;
    if (r?.verdict === "partial") ui.resultText = d.t("verdictPartial");
}
