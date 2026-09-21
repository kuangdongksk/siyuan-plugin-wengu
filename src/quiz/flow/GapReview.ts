import type { AnswerHost } from "./AnswerFlow";
import {
    applyJevSame,
    gapAskedKey,
    gapInputOf,
    gapSameKeys,
    makeGapVerdict,
    shouldReviewGap,
    type GapJudgeFn,
    type JevSameSink,
} from "../service/GapJudge";
import type { JevSettingsLike } from "../../ai/jev/enabled";
import { esc } from "../../ui/shared";
import type { CardCtl } from "../render/CardCtl";
import { markNum } from "../render/FlowDom";
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

/** 判同一个键（题 + 答案位）后要不要**在途提示**：逐空没有作答位可提示。 */
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
}

/** 逐空判分（cloze/match）也有复核，但**题型闸换成填空**：空本身没有题型，
 *  判定语义与填空题同款（内容答案 vs 用户输入）。 */
function typeOf(c: GapReviewSite): WenguQuestion["type"] {
    return c.slot ? ("fill" as WenguQuestion["type"]) : c.q.type;
}

/** 复核输入取材：逐空用该空的答案与选项（与整题同形状）。 */
function inputOf(c: GapReviewSite) {
    return gapInputOf(c.slot ? { ...c.q, answer: c.slot.answer, optionMd: c.slot.optionMd } : c.q, c.submitted);
}

/** 复核键：逐空按「题#该空的标准答案」定身份（同空不重问），整题按题 id。 */
function keyOf(c: GapReviewSite): string {
    return gapAskedKey(c.slot ? `${c.q.id}#${c.slot.answer}` : c.q.id, c.submitted);
}

/** 复核三件的取用口：视图经 `gate`（AnswerGate 摊牌），测试/预览壳可直给。 */
function bindingsOf(host: AnswerHost): GapReviewBindings | undefined {
    return host.gate?.gapReview ?? host.gapReview;
}

/** 该题是否走复核（题型/判对/无 key 三闸 + 去重，全在 service 侧）。 */
function shouldReview(host: AnswerHost, c: GapReviewSite): GapJudgeFn | undefined {
    const bindings = bindingsOf(host);
    const verdict = bindings?.jevGapVerdict();
    const asked = bindings ? (key: string): boolean => bindings.jevGapAsked(key) : undefined;
    return shouldReviewGap({ ok: c.ok, type: typeOf(c), asked, key: keyOf(c), input: inputOf(c), verdict })
        ? verdict
        : undefined;
}

/** 判定链：返回该题**最终**对错（失配且判同 ⇒ true）。
 *
 *  在途可见态：即时模式先把结果行换成「Jev 复核中…」（**必须清**——
 *  不复核出结果就退回空态，让既有揭示路径按判错正常重画）；收卷模式不动
 *  结果行（收卷前不泄判分口风）。判定抛错一律吞成「维持判错」。 */
export async function reviewGap(c: GapReviewSite): Promise<boolean> {
    const verdict = shouldReview(c.host, c);
    if (!verdict) return c.ok;
    const inFlight = c.ctl && c.host.currentRevealMode() !== "after";
    if (inFlight) c.ctl!.setResult(esc(c.host.t("jevReviewing")), "warn");
    let same: boolean;
    try {
        same = await verdict(inputOf(c));
    } catch (_) {
        same = false; // 复核不许拖垮作答链（判定函数自身也已吞错，双保险）
    }
    if (!same) {
        if (inFlight) c.ctl!.setResult("", ""); // 复位在途态，交回既有揭示路径
        return c.ok;
    }
    // 入账 + 去重登记同键（判同表只存肯定结论，见 service/GapJudge）
    bindingsOf(c.host)?.jevGapMark(c.q.id, c.submitted, c.slot ? `${c.q.id}#${c.slot.answer}` : undefined);
    if (c.ctl) {
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
    /** 设置面（jevKey + 总开关）：本片据此组装判定函数（无 key ⇒ undefined）。 */
    settings: JevSettingsLike | undefined;
    /** 当前会话（判同入账的落点）。 */
    session: () => JevSameSink | undefined;
    /** 会话变更落库（`QuizView.persist`）。 */
    persist: () => void;
}

/** AnswerHost 三件的形状（成员名与接口逐字一致，`AnswerGate` 侧按它取）。 */
export interface GapReviewBindings {
    jevGapVerdict: () => GapJudgeFn | undefined;
    jevGapAsked: (key: string) => boolean;
    jevGapMark: (qid: string, submitted: string, slotKey?: string) => boolean;
}

/** 组装 AnswerHost 三件（成员名与接口逐字一致）。 */
export function gapReviewFor(w: GapReviewWiring): GapReviewBindings {
    const verdict = makeGapVerdict(w.settings);
    return {
        jevGapVerdict: () => verdict,
        jevGapAsked: (key) => gapSameKeys().has(key),
        jevGapMark: (qid, submitted, slotKey) => {
            const ok = applyJevSame(w.session(), qid, submitted);
            if (ok) {
                gapSameKeys().add(gapAskedKey(slotKey ?? qid, submitted));
                w.persist();
            }
            return ok;
        },
    };
}
