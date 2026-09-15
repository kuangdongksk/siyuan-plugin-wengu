import { errText } from "./../../ui/shared";
import { judgeBrief } from "../service/AiJudge";
import { toggleLetters } from "../../types";
import { isObjective } from "../render/CardHtml";
import { stepsSnapshotOf, settleSteps } from "../render/CardSteps";
import type { WenguSession } from "../service/HistoryStore";
import type { TimerController } from "../service/TimerController";
import { focusQuestion, syncGroupReveal } from "./MaterialFlow";
import { gradeQuestion, verdictLabelKey, verdictStatus } from "../service/QuestionGrading";
import { markNum } from "../render/FlowDom";
import { markNumRailAnswered } from "../render/NumRail";
import { allCards, allCardsGraded } from "../render/CardRegistry";
import type { CardCtl } from "../render/CardCtl";
import type { WenguQuestion } from "../../types";
import type { ClueAnchor } from "../service/MaterialDecorate";
import { hasSteps, isBriefLike, QuestionType } from "../../types";
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
    /** after 模式答满（全部 graded 但尚未收卷）：提示一次「可检查修改」
     *  （视图侧做一次性去重，见 QuizView 实现）。可选。 */
    onAllAnswered?(): void;
    /** 线索高亮后处理（Issue #28）：材料填充后 / 题干挂载后 / 会话恢复后
     *  三处时机由题卡与组单元组件直调，实现收口在 ClueFlow
     *  （ClueHost 适配，禁复制第二份）。可选——测试/预览壳不实现即跳过。 */
    refreshClueMarks?(q: WenguQuestion): void;
    /** 该题的装饰锚点（材料面板一次施工时连线索一起铺；见 ClueFlow.clueAnchorsFor）。
     *  AnswerHost 与 ClueHost 同源结构，见 ClueFlow 的宿主能力清单。 */
    clueAnchorsOf?(q: WenguQuestion): ClueAnchor[];
}

/** 字母 chip 点选：单选互斥（重选保持选中），多选可增删（序保持升序）。
 *  守卫是「揭示/锁定」而非 graded——after 模式提交后仍可改（Issue #12）。 */
export function pickLetter(ctl: CardCtl, letter: string): void {
    if (answeredFrozen(ctl)) return;
    ctl.ui.letters = toggleLetters(ctl.ui.letters, letter, ctl.q.type === QuestionType.Single);
}

/** 判断题 √/× 点选（互斥即覆盖）。 */
export function pickJudge(ctl: CardCtl, judge: string): void {
    if (!answeredFrozen(ctl)) ctl.ui.judge = judge;
}

/** 作答位冻结判据（Issue #12 B2③）：只认**揭示或锁定**，不认 graded
 *  ——after 模式（收卷后揭示）提交只置 graded，答案必须还能改。 */
function answeredFrozen(ctl: CardCtl): boolean {
    return ctl.ui.revealed || ctl.ui.locked;
}

/** AI 判分在途的卡（Issue #12）：after 模式提交后不锁卡，brief 判分又
 *  是异步的——用户连点提交会并发跑两次 judgeBrief（重复烧调用、评语
 *  交叉覆写）。判分期间挂单飞闸，判完释放；重复提交在**判分完成后**
 *  仍照走（Issue #12 明文允许「after 重复提交＝再走一次 AI 判分」）。 */
const judging = new WeakSet<CardCtl>();

export async function submitQuestion(host: AnswerHost, q: WenguQuestion, ctl: CardCtl): Promise<void> {
    if (answeredFrozen(ctl) || judging.has(ctl)) return;
    const objective = isObjective(q);
    const submitted = ctl.submitted();
    if (objective && !submitted) {
        ctl.setResult(esc(host.t("noAnswer")), "warn");
        return;
    }
    const batch = host.currentRevealMode() === "after";
    // instant 判分即锁；after 只置 graded（记账已入、收卷前可反悔）
    if (batch) ctl.setPending();
    else ctl.setGraded();
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
    judging.add(ctl);
    try {
        // 「思路」折叠区若填了内容，一并交给 AI（判 partial 的重要素材）
        const thought = ctl.ui.thought.trim();
        const v = await judgeBrief(q, submitted, host.aiModelId(), thought);
        ctl.ui.aiJudged = true;
        ctl.setAi(v.verdict, v.comment);
        host.recordAnswer(q.id, submitted, v.ok, { verdict: v.verdict, comment: v.comment, cause: v.cause });
        if (batch) {
            // 统一展示：只说「已作答、可继续改」（评语进 aiComment 行，
            // 对错留到收卷）——否则 after 的 brief 提交后毫无可见反馈
            ctl.setResult(esc(host.t("answeredPending")), "warn");
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
    } finally {
        judging.delete(ctl); // 判完释放单飞闸（重复提交照常可再走一次）
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

/** 跳过本题（Issue #12 A）：**不记作答、不锁卡、不揭示**，只滚到下一题
 *  （题号栏也不标已答）。末题零动作——没有「下一题」可去，也没有
 *  「已跳过」需要记账（跳过＝当作没来过，用户随时能回来答）。
 *  导航走 host.onActiveQ + focusQuestion，与题号栏点击逐字同源
 *  （材料组自动切显、滚动追赶都在里头）。
 *  入口由普通卡与 steps 多步题共用（Issue #21）——本函数对题型无感
 *  （纯按下标导航），steps 卡渲染同款钮即接入，零语义新增；
 *  slots 逐空题维持现状不提供。 */
export function skipQuestion(host: AnswerHost, q: WenguQuestion): void {
    const list = host.questions();
    const idx = list.indexOf(q);
    if (idx < 0 || idx >= list.length - 1) return;
    const next = idx + 1;
    host.onActiveQ?.(next);
    focusQuestion(host.container(), next);
}

/** 「不会」（Issue #12 A）：记一次 ok=false 的作答（会话 submitted 存空串
 *  ——恢复路径吃空串无副作用，行文案单独标「已记为不会」）。
 *  - objective 题：不走 gradeQuestion（空串必然判错），直接记错；
 *  - brief 类：**跳过 AI 判分**直接判错（不烧一次 AI 调用）；
 *  - instant 模式：揭示答案/解析并锁卡（与答错同款体验）；
 *  - after 模式：只记「已作答」不揭示不锁死，可反悔改成正常作答
 *    （重复提交走 upsert 覆写，见 HistoryStore.pushSessionAnswer）。
 *  普通卡与 steps 多步题共用题级记账收口（dunnoCard），差异只在揭示
 *  形态（Issue #21）；slots 逐空题维持现状不提供（作答单位是空）。 */
export async function dunnoQuestion(host: AnswerHost, q: WenguQuestion, ctl: CardCtl): Promise<void> {
    dunnoCard(host, q, ctl, (batch) => {
        if (batch) {
            ctl.setResult(esc(host.t("dunnoMarked")), "warn");
            return;
        }
        // 先走常规揭示（chip 描色 + 答案/解析），再把结果行文案换成「已记为
        // 不会」并**保留答案**——「不会」不比「答错」多给一分，但文案要说清
        // 是主动认输，同时不能把答案行整条吃掉（客观题答案只在结果行展示）
        revealCard(host, ctl, q, { submitted: "", ok: false });
        const answerTail = isObjective(q) ? `${esc(host.t("answerLabel"))}${esc(q.answer ?? "")}` : "";
        ctl.setResult(`${esc(host.t("dunnoMarked"))}${answerTail}`, "wrong");
        showQTime(host, ctl, q.id);
    });
}

/** 多步题「不会」（Issue #21）：**题级语义**，与 dunnoQuestion 同构——
 *  题级空串记一错（步骤一条都没答，逐步账不出空串条目：会话与题库的
 *  逐步统计都按「答过的步」算，「不会」是整题认输不是每步都答错），
 *  instant 全步一次揭示 + 卡锁 + 题号标错 + dunnoMarked 文案（有题级
 *  答案时附答案），after 只记「已作答」可反悔改成正常作答。 */
export async function dunnoSteps(host: AnswerHost, q: WenguQuestion, ctl: CardCtl): Promise<void> {
    dunnoCard(host, q, ctl, (batch) => {
        if (batch) {
            ctl.setResult(esc(host.t("dunnoMarked")), "warn");
            return;
        }
        revealStepsCard(host, q, ctl, "", false); // 全步一次揭示（现成收口，见下）
        const answer = (q.answer ?? "").trim();
        const answerTail = answer ? `${esc(host.t("answerLabel"))}${esc(answer)}` : "";
        ctl.setResult(`${esc(host.t("dunnoMarked"))}${answerTail}`, "wrong");
        showQTime(host, ctl, q.id);
    });
}

/** 「不会」的题级记账收口（普通卡与 steps 共用，Issue #21）：守卫 →
 *  模式分流（instant 三态一起置 / after 只置 graded）→ 题级空串记一错
 *  → 形态各自的揭示（reveal 回调）+ 收口。after 的「已作答」结果行也
 *  交回调按形态给——守卫/记账/收口只此一份，两形态不逐卡重写。 */
function dunnoCard(host: AnswerHost, q: WenguQuestion, ctl: CardCtl, reveal: (batch: boolean) => void): void {
    if (answeredFrozen(ctl) || judging.has(ctl)) return;
    const batch = host.currentRevealMode() === "after";
    if (batch) ctl.setPending();
    else ctl.setGraded();
    host.flushTime();
    host.recordAnswer(q.id, "", false);
    reveal(batch);
    if (batch) markNumAnswered(host, q);
    checkAllDone(host);
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
    // steps 卡揭示走自己的收口（答完出整题结果行、预览态不覆盖；
    // Issue #21 起 dunnoSteps 也过它）；此处只做揭示 + 题号描色
    if (hasSteps(q)) {
        revealStepsCard(host, q, ctl, r.submitted, r.ok);
        return;
    }
    // 揭示态统一在此置位（Issue #12）：本函数是**全部**卡片形态的揭示
    // 入口（即时判分、收卷统一揭示、恢复兜底三路都过它），显隐闸改挂
    // `.wengu-revealed` 后必须无条件置——否则 brief 卡收卷后答案与解析
    // 仍不可见（它的 revealed 原先只由客观题的这段分支置）。submitted
    // 快照只被 choice 的 chipMarkOf 读，其余题型写入无害。
    ctl.reveal(r.submitted);
    if (isObjective(q)) {
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

/** steps 卡全步揭示收口（Issue #21）：三态一起置（graded + locked +
 *  revealed——解析区只认 .wengu-revealed）+ 逐格答案/描色落格。逐格落格
 *  走 settleSteps（卡内按钮的 disabled 闸），本函数是全形态**兜底揭示**
 *  唯一入口：`revealCard` 的 steps 转调、`revealAll` 收卷统一揭示、
 *  `dunnoSteps`「不会」三路共用，禁复制第二份。
 *
 *  **逐格快照按来路补**（Issue #21 复审修复，两条都是真机级）：
 *  - 还没落格的卡（收卷统一揭示 / 恢复兜底）→ 用 `stepsSnapshotOf` 的
 *    会话真值落格，缺答的步才补答案；
 *  - 已落格的卡（当场收口 `StepsFlow.finishCard` 自己按真快照落过格、
 *    或恢复卡已完成）→ **一格都不碰**，只补三态与未落格的步；
 *  - `stepOks` 一律按 ui.steps 的**实际逐格态**回写，不再写「全错」占位：
 *    占位会覆盖 finishCard 刚写的真快照，真机表现为「多步题答完答案行
 *    全变错、申诉翻对基线被清成 0000」。 */
export function revealStepsCard(
    host: AnswerHost,
    q: WenguQuestion,
    ctl: CardCtl,
    submitted: string,
    ok: boolean
): void {
    markNum(host, q, ok);
    ctl.reveal(submitted); // 置 revealed + 作答快照
    ctl.ui.graded = true;
    ctl.ui.locked = true;
    const settled = (ctl.ui.steps ?? []).some((su) => su.graded);
    const snap = stepsSnapshotOf(host.currentSession()?.results ?? [], q.id, q.steps?.length ?? 0);
    const known = !settled && snap.letters.some((l) => l !== "");
    settleSteps(q, ctl.ui, known ? { t: host.t, letters: snap.letters, oks: snap.oks } : { t: host.t });
    ctl.ui.stepOks = (ctl.ui.steps ?? []).map((s) => (s.graded && s.ok ? "1" : "0")).join("");
}

/** 全部作答后收口：instant 模式直接给总结报告；**after 模式不自动
 *  收卷**（Issue #12 B3）——答案要等「结束本次做题」（endRound →
 *  manualFinishRound → revealAll 链路）才统一揭示，若在末题提交的
 *  瞬间 revealAll，刚打开的可修改窗口立刻被关死，用户没机会回看。
 *  改为：答满只提示一次（题卡内 answeredPending 行 + 浮层提示），
 *  编辑窗口保持到用户显式收卷。
 *  StepsFlow 完成多步卡后也走这里（steps 逐卡自判分，需靠它凑齐
 *  「全部 graded」这一收口信号，故本函数不能整个拿掉）。 */
export function checkAllDone(host: AnswerHost): void {
    if (!allCardsGraded()) return;
    if (host.currentRevealMode() === "after") {
        if (host.onAllAnswered) host.onAllAnswered();
        return;
    }
    host.roundComplete();
}

/** after 模式：已作答但尚未揭示的题，题号只标「已答」不透对错
 *  （写进题号栏组件响应态）。 */
function markNumAnswered(host: AnswerHost, q: WenguQuestion): void {
    markNumRailAnswered(host.questions().indexOf(q) + 1);
}

/** brief 三态的结果行文案（判词→键收口在 verdictLabelKey，esc 留调用侧）。 */
function briefResultText(host: AnswerHost, verdict: string): string {
    return esc(host.t(verdictLabelKey(verdict)));
}
