import type { WenguQuestion } from "../../types";
import { baseQid, isObjective, QuestionType, toggleLetters } from "../../types";
import { gradeQuestion, verdictLabelKey } from "../../quiz/service/QuestionGrading";
import { judgeBrief } from "../../quiz/service/AiJudge";
import { mirrorAnswer, mirrorOverride, mirrorRepeatAnswer } from "../../quiz/service/AnswerMirror";
import { pushSessionAnswer } from "../../quiz/service/HistoryStore";
import type { WenguSessionResult } from "../../quiz/service/HistoryStore";
import { errText } from "../../ui/shared";
import { notifyInfo } from "../../ui/Notify";
import { answerKindOf } from "./MobileModel";
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

/** 「已选未确认」判据（**唯一实现**，Issue #164）：这道题已经进入可作答
 *  形态且落了选择/输入，但**还没按「确认答案」**（两段式确认，Issue #105
 *  ——点选只落选择态，提交一律由确认钮触发）。
 *
 *  ⚠️ **别在第二处再写一份**：交卷守卫（`MobileEndGuard.requestEnd`）拿它
 *  分流空轮、`goConfirmEndPicked` 拿它定位第一道该类题；两处各写一份选择态
 *  判定必漂（本单的根因就是「两段式确认」与「空轮判据只认 answered」两套
 *  口径各自为政）。契约测试会数全仓该判据的落点。
 *
 *  口径按 `answerKindOf` 的形态分派（与提交链 `submittedOf` 同源）：
 *  - choice / judge：对应选择态非空且未判分；
 *  - text / fill：输入区非空白且未判分（空提交本就走「未作答」提示）；
 *  - slots（逐空题移动端无作答位）/ plain（无题型兜底，无「选择」可确认）
 *    / 挂起未揭示的兜底题（`selfOn`）都不算——它们没有「去确认」这个出口。
 *  `graded`（及 `revealed`/`locked`）为真即已记账，不再重复计入。 */
export function isPickedUnconfirmed(q: WenguQuestion, ui: MobileCardState): boolean {
    if (ui.graded || ui.revealed || ui.locked || ui.selfOn) return false;
    const kind = answerKindOf(q);
    if (kind === "choice") return ui.letters.trim() !== "";
    if (kind === "judge") return ui.judge.trim() !== "";
    if (kind === "text" || kind === "fill") return ui.mine.trim() !== "";
    return false;
}

/** 「已选未确认」补记（**走既有提交链**，Issue #164）：用户按「点选项=已答」
 *  的心智刷完直接交卷时，把这批已选按**正常提交流程**补记——提交 / 判分 /
 *  记账（会话 upsert + 题库镜像）全在 {@link submit} 里，此处只做逐题推进，
 *  **不新开第二条记账路径**（禁区别碰）。
 *
 *  两模式（即时 / 收卷）同口径：交卷是用户显式表态（弹层上点的「按当前已选
 *  交卷」），这批已选就该按原样记进去；模式差异只落在 `submit` 内部（即时判分
 *  即锁定+揭示，收卷只记「已答」、揭示留到收卷）。
 *  逐题 `await`（交卷可能触发一次 AI 判分，必须等它落账再收卷）。
 *  调用侧 `MobileEndGuard.endNowPicked`。 */
export async function submitPickedUnconfirmed(d: MobileDrill): Promise<void> {
    for (let i = 0; i < d.ui.list.length; i++) {
        const q = d.ui.list[i];
        const ui = d.ui.cards[i];
        if (!q || !ui || !isPickedUnconfirmed(q, ui)) continue;
        d.ui.qIdx = i;
        await submit(d);
    }
}

/** AI 三态的结果行文案（与桌面 briefResultText 同口径，键收口 verdictLabelKey）。 */
function verdictText(t: (k: string) => string, verdict: string): string {
    return t(verdictLabelKey(verdict));
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
    if (answerKindOf(q) === "judge") {
        ui.judge = letter;
        ui.letters = "";
        return;
    }
    if (q.type === QuestionType.Single) {
        ui.judge = "";
        ui.letters = toggleLetters(ui.letters, letter, true);
        return;
    }
    ui.letters = toggleLetters(ui.letters, letter, false);
}

/** 文本作答（受控写回）。 */

export function setMine(d: MobileDrill, text: string): void {
    const ui = curOf(d);
    if (ui && !frozen(ui)) ui.mine = text;
}

/** 当前题的作答串（提交通道口径）。 */

function submittedOf(q: WenguQuestion, ui: MobileCardState): string {
    const kind = answerKindOf(q);
    if (kind === "choice") return ui.letters;
    if (kind === "judge") return ui.judge;
    // 填空与文本作答都走输入区；逐空题移动端不给作答位（见 answerKindOf）
    if (kind === "fill" || kind === "text") return ui.mine.trim();
    return "";
}

/**
 * 提交：客观题即时判分（含填空）、简答类走 AI 判分、无题型兜底题揭示后
 * 自评、逐空题移动端不给作答位（只提示）。
 *
 * 分流口径一律取 `answerKindOf`（唯一判据，见 MobileModel）——别在这里
 * 再写一份「有没有选项 / 是不是 brief」的派生判断：改造前正是那种写法
 * 让填空题落进空档（提交按钮点了什么都不发生）。
 */

export async function submit(d: MobileDrill): Promise<void> {
    const q = qOf(d);
    const ui = curOf(d);
    if (!q || !ui || frozen(ui) || ui.busy) return;
    const kind = answerKindOf(q);
    // 逐空题（完形/新题型）：移动端本轮不给作答位——逐空作答是桌面
    // SlotFlow 的重型交互（空号条 + 候选池 + 逐空判分），小屏无落脚点；
    // 整题文本作答又会把它记成「一道题的一个答案」，与 qid#k 的逐空记账
    // 口径冲突（统计与错题清单全错位），故只提示、不记账。
    if (kind === "slots") {
        ui.resultText = d.t("mobileSlotsDesktopOnly");
        return;
    }
    // 多步题在移动端**不做逐步作答**：桌面 StepsFlow 的步态/申诉链
    // 属重型交互，小屏上无落脚点。按「整题文本作答」处理——steps 卡
    // 由 text 分支给多行输入区，判分走 brief 同族（AI 判分）。
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
    if (kind === "text") {
        if (!submitted) {
            ui.resultText = d.t("noAnswer");
            return;
        }
        if (batch) {
            record(d, q, submitted, false, batch);
            markPending(d, ui);
            void judgeBriefCard(d, q, ui, submitted, true).then(() => checkAllDone(d));
            checkAllDone(d);
            return;
        }
        await judgeBriefCard(d, q, ui, submitted, false);
        // 即时模式判完即收口（桌面 judgeBriefAnswer 成功路径同款）：末题若
        // 是 brief，不在此调 checkAllDone 就不会自动出报告，只能靠用户点
        // 自评或手动交卷——与客观题「答满即出报告」不一致。
        // ⚠️ 判据只能取 `ui.graded`（成功路径唯一写入点）；`selfOn` 在成功
        // 与失败两路都置（那是「改判」钮），拿它分流会把成功路也挡住。
        // 判分失败回落自评时不调（等 selfAssess 收口，与桌面 catch 分支同款）。
        if (ui.graded) checkAllDone(d);
        return;
    }
    // 无题型/无答案的兜底题：与桌面 submitQuestion 同款——**先不记账**
    // （对错由用户自评给，见 selfAssess），揭示后露自评钮。
    // 收卷模式只置「已答」（与桌面同款：揭示留到交卷，提前揭示即泄题）；
    // 即时模式三态一起置并露自评钮。
    if (!objective) {
        if (batch) {
            markPending(d, ui);
            checkAllDone(d);
            return;
        }
        ui.graded = true;
        ui.locked = true;
        ui.revealed = true;
        ui.resultText = d.t("mobileSelfHint");
        ui.selfOn = true;
        checkAllDone(d);
        return;
    }
    const ok = gradeQuestion(q, submitted);
    record(d, q, submitted, ok, batch);
    if (batch) {
        markPending(d, ui);
        checkAllDone(d);
        return;
    }
    ui.graded = true;
    ui.locked = true;
    ui.revealed = true;
    ui.ok = ok;
    applyVerdict(d, d.ui.qIdx, q, ok);
    checkAllDone(d);
}

/** 兜底题（无题型/无答案）在交卷时补揭示（与桌面 revealAll 同款）：
 *  这类题在收卷前只置了「已答」、没记账也没揭示，交卷后必须补揭示 +
 *  露自评钮，否则用户既看不到答案也没有收口入口。
 *  ⚠️ 揭示态的写入一律留在本模块（编排层只调，不自己写字段）。 */
export function revealPlainFallback(d: MobileDrill, idx: number): void {
    const ui = d.ui.cards[idx];
    if (!ui) return;
    ui.revealed = true;
    ui.resultText = d.t("mobileSelfHint");
    ui.selfOn = true;
}

/** 收卷模式的「已答」态（与桌面 setPending 同口径：只置 graded）。 */
function markPending(d: MobileDrill, ui: MobileCardState): void {
    ui.graded = true;
    ui.resultText = d.t("answeredPending");
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
    // 逐空题不给「不会」（与桌面 slots 同口径）：作答单位是「空」，
    // 题级空串会把整题的逐空账记成一笔（统计与错题清单错位）
    if (answerKindOf(q) === "slots") {
        ui.resultText = d.t("mobileSlotsDesktopOnly");
        return;
    }
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
    // R8：当前显示题即计时题——提交瞬间结算（R3），改答不动已结算值（R4）。
    // 取代原先硬编码的 `0`（移动端此前只有整轮墙钟，逐题 sec 恒缺）。
    const sec = d.questionTimer().freeze(q.id).sec;
    pushSessionAnswer(s, q.id, submitted, ok, sec, d.ui.elapsedSec, extra);
    void d.deps.history?.upsert(s);
    // 题库镜像：首答 attempts+1，重复提交只覆写 lastAnswer/right（不动 attempts）；
    // 即时模式判分即纳入，收卷模式交卷时才补记（batched 记账在 endRound）
    if (batch) {
        // ⚠️ **交卷先于 AI 返回的窗口**（复审必修）：收卷模式的镜像整体推迟
        // 到 endRound 的 flushBatchMirror，AI 判分完成时若该轮**已收卷**
        // （endedAt 已置 ⇒ flush 已跑过、占位 false 已入账），迟到的 verdict
        // 必须**覆写**题库——否则题库永远停在占位「错」，薄弱画像/错题本按错
        // 处理，且会话与题库互相矛盾（桌面 judgeBriefAnswer 判完即 recordAnswer，
        // 无此窗口）。走 mirrorRepeatAnswer（attempts 已由 flush 计过，不再 +1）。
        if (s.endedAt) mirrorRepeatAnswer(d.deps.bank, q.id, submitted, ok);
        return;
    }
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
