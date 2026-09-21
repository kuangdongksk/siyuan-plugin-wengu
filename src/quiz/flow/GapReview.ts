import type { AnswerHost } from "./AnswerFlow";
import {
    applyJevSame,
    gapAskedKey,
    gapInputOf,
    gapKnownSame,
    gapSameKeys,
    makeGapVerdict,
    shouldReviewGap,
    type GapJudgeCtx,
    type GapJudgeFn,
    type JevSameSink,
} from "../service/GapJudge";
import type { JevSettingsLike } from "../../ai/jev/enabled";
import { esc } from "../../ui/shared";
import type { CardCtl } from "../render/CardCtl";
import { markNum } from "../render/FlowDom";
import { QuestionType } from "../../types";
import type { WenguQuestion } from "../../types";

/**
 * 填空语义判等的**作答链接线**（Issue #187）：卡内提交（即时/收卷两模式）
 * 与 slots 逐空提交共用这一份判定链——失配才问、只说同才翻对、失败/不确定
 * 维持判错（判定函数自身已吞错，见 `service/GapJudge.makeGapVerdict`）。
 *
 * 与 `service/GapJudge` 的分工：那边是纯逻辑（阈值/取材/提示词/判定函数/
 * 判同记账），这边是**需要宿主与卡面**的那一层（在途结果行、题号描色）。
 * 拆开的目的有二：`AnswerFlow`/`SlotFlow` 不各自重写一遍判定顺序，
 * 且两个 flow 文件都不必为这层掏行数（§11.1 单文件 ≤500 行）。
 */

/** 一次复核的现场（判定取材 + 落账身份 + 卡面出口）。 */
export interface GapReviewSite {
    host: AnswerHost;
    q: WenguQuestion;
    /** 有卡面就写在途结果行；slots 逐空不传。 */
    ctl?: CardCtl;
    /** 该空的答案位（slots 用；普通填空不传）。 */
    slot?: { optionMd: string[]; answer: string };
    submitted: string;
    /** 本地判分结论。 */
    ok: boolean;
    /** **会话记录身份**（`recordAnswer` 用的那个 qid）：整题 = `q.id`，
     *  逐空 = `slotQid(q.id, k)`。
     *  ⚠️ 判同标记与去重键都必须用它，不能用 `c.q.id`（20260921 复核修正：
     *  逐空的会话记录是 `qid#k`，拿整题 id 去查永远查不到 ⇒ 判同静默丢失）。 */
    recordQid: string;
}

/** 逐空判分（cloze/match）也有复核，但**题型闸换成填空**：空本身没有题型，
 *  判定语义与填空题同款（内容答案 vs 用户输入）。 */
function typeOf(c: GapReviewSite): WenguQuestion["type"] {
    return c.slot ? QuestionType.Fill : c.q.type;
}

/** 复核输入取材：逐空用该空的答案与选项（与整题同形状）。 */
function inputOf(c: GapReviewSite) {
    return gapInputOf(c.slot ? { ...c.q, answer: c.slot.answer, optionMd: c.slot.optionMd } : c.q, c.submitted);
}

/** 复核键：会话记录身份 + 归一化作答（与落账身份同源，读侧同式比较）。 */
function keyOf(c: GapReviewSite): string {
    return gapAskedKey(c.recordQid, c.submitted);
}

/** 复核三件的取用口：视图经 `gate`（AnswerGate 摊牌），测试/预览壳可直给。 */
function bindingsOf(host: AnswerHost): GapReviewBindings | undefined {
    return host.gate?.gapReview ?? host.gapReview;
}

/** 把现场翻译成 `service/GapJudge` 的判据形状（两个谓词共用一份）。 */
function ctxOf(host: AnswerHost, c: GapReviewSite): { ctx: GapJudgeCtx; verdict: GapJudgeFn | undefined } {
    const bindings = bindingsOf(host);
    const verdict = bindings?.jevGapVerdict();
    const asked = bindings ? (key: string): boolean => bindings.jevGapAsked(key) : undefined;
    return { ctx: { ok: c.ok, type: typeOf(c), asked, key: keyOf(c), input: inputOf(c), verdict }, verdict };
}

/** 复核结论：`ok` = 该题最终对错（判同 ⇒ true）；`same` = 是否判同。 */
export interface GapOutcome {
    ok: boolean;
    same: boolean;
}

/** **判定段**（只问不改账）：返回复核结论，判同**不**在此落账。
 *
 *  ⚠️ **必须与落账分成两段**（20260921 复核修正）：调用方是「先判定 →
 *  `recordAnswer` 建记录 → 再落判同标记」，而 `applyJevSame` 是按 qid
 *  在会话里**找已存在的记录**改。判定段里顺手落账时记录还没建出来
 *  ⇒ 标记永远无处可挂（`o.ok` 已是判同后的 true，界面上却永无「Jev 判同」）。
 *
 *  在途可见态：即时模式先把结果行换成「Jev 复核中…」（**必须清**——
 *  不复核出结果就退回空态，让既有揭示路径按判错正常重画）；收卷模式不动
 *  结果行（收卷前不泄判分口风）。判定抛错一律吞成「维持判错」。 */
export async function reviewGap(c: GapReviewSite): Promise<GapOutcome> {
    const { ctx, verdict } = ctxOf(c.host, c);
    // 命中判同缓存：零请求回放「对」（缓存是「结论」不是「免问一次」，
    // 见 `service/GapJudge.gapKnownSame` 头注）。无 key 时该谓词亦为 false。
    if (gapKnownSame(ctx)) return { ok: true, same: true };
    if (!shouldReviewGap(ctx)) return { ok: c.ok, same: false };
    const inFlight = !!c.ctl && !c.slot && c.host.currentRevealMode() !== "after";
    if (inFlight) c.ctl!.setResult(esc(c.host.t("jevReviewing")), "warn");
    let same: boolean;
    try {
        same = await verdict(inputOf(c));
    } catch (_) {
        same = false; // 复核不许拖垮作答链（判定函数自身也已吞错，双保险）
    }
    // 在途提示**一律清掉**（判同也清）：终态由 applyGapSame / 既有揭示路径重画。
    // 不清的话「复核中…」会永久留在卡上（尤其会话里没记录、落账不成立时）。
    if (inFlight) c.ctl!.setResult("", "");
    return same ? { ok: true, same: true } : { ok: c.ok, same: false };
}

/** **落账段**（调用方必须在 `recordAnswer` **之后**调）：把判同写进会话
 *  （`recordQid` = 刚落的记录）、登记去重键，并按环境补画卡面。
 *
 *  ⚠️ **收卷模式（after）不碰卡面**：收卷前不泄任何判分口风——题号栏与结果行
 *  都留「已作答」档，标记由 `revealAll`/`revealCard` 按会话里的 `jevSame`
 *  在收卷时补回（`jevSameOf`）。逐空（`c.slot`）也不动结果行：卡面由
 *  `SlotFlow` 自己按 marks 重画。 */
export function applyGapSame(c: GapReviewSite, o: GapOutcome): boolean {
    if (!o.same) return false;
    const bindings = bindingsOf(c.host);
    const wrote = bindings?.jevGapMark(c.recordQid, c.submitted, keyOf(c)) ?? false;
    // 会话里没这条记录（会话已换/未开轮）⇒ 不画卡面，避免界面与账本不一致
    if (!wrote) return false;
    if (c.ctl && !c.slot && c.host.currentRevealMode() !== "after") {
        markNum(c.host, c.q, true);
        c.ctl.setResult(`${esc(c.host.t("correct"))}${esc(c.host.t("jevSameMark"))}`, "right");
    }
    return true;
}

/**
 * 视图侧的复核三件组装（`AnswerHost.jevGapVerdict` / `jevGapAsked` /
 * `jevGapMark`）：视图只需把「判定函数 + 当前会话 + 落库回调」三样递进来，
 * 去重表与判同入账的细节留在本片（视图 `index.ts` 的行长额度＝上限，
 * 见 AGENTS.md §quiz）。
 */
export interface GapReviewWiring {
    /** 设置面的**惰性读取口**（jevKey + 总开关）：本片据此组装判定函数
     *  （无 key ⇒ undefined）。⚠️ 不许改成传值——见 `gapReviewFor` 头注，
     *  `AnswerGate` 的构造时机早于视图拿到 settings。 */
    settingsOf: () => JevSettingsLike | undefined;
    /** 当前会话（判同入账的落点）。 */
    session: () => JevSameSink | undefined;
    /** 会话变更落库（`QuizView.persist`）。 */
    persist: () => void;
}

/** AnswerHost 三件的形状（成员名与接口逐字一致，`AnswerGate` 侧按它取）。 */
export interface GapReviewBindings {
    jevGapVerdict: () => GapJudgeFn | undefined;
    jevGapAsked: (key: string) => boolean;
    jevGapMark: (qid: string, submitted: string, askedKey: string) => boolean;
}

/** 组装 AnswerHost 三件（成员名与接口逐字一致）。
 *
 *  ⚠️ **判定函数必须惰性组装**（20260921 复核修正）：`AnswerGate` 在
 *  `QuizView` 的**字段初始化期**构造，而 `this.settings` 是构造体里才赋值的
 *  ——构造期读 `v.settings` 永远拿到 `undefined`，用户配了 key 也永远
 *  `undefined` ⇒ 复核链全程零调用（功能静默失效，且无报错）。另：设置页
 *  就地改写的是同一个 settings 对象，惰性读取才能让开关立即生效。 */
export function gapReviewFor(w: GapReviewWiring): GapReviewBindings {
    return {
        jevGapVerdict: () => makeGapVerdict(w.settingsOf()),
        jevGapAsked: (key) => gapSameKeys().has(key),
        jevGapMark: (qid, submitted, askedKey) => {
            const wrote = applyJevSame(w.session(), qid, submitted);
            if (wrote) {
                gapSameKeys().add(askedKey);
                w.persist();
            }
            return wrote;
        },
    };
}
