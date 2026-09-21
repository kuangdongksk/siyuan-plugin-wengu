import { afterEach, describe, expect, it } from "vitest";
import type { AnswerHost } from "./AnswerFlow";
import { applyGapSame, reviewGap } from "./GapReview";
import { CardCtl } from "../render/CardCtl";
import { buildCardInit, type CardInitCtx } from "../render/CardState";
import { unregisterCard } from "../render/CardRegistry";
import { applyJevSame, gapAskedKey, resetGapSameForTest, type GapJudgeFn } from "../service/GapJudge";
import { pushSessionAnswer, type WenguSession } from "../service/HistoryStore";
import { QuestionType, type WenguQuestion } from "../../types";

/**
 * 填空复核的**接线层**（Issue #187）：谁被调用、在途结果行写什么、
 * 判同后卡面与题号怎么变。判定阈值本身在 `service/GapJudge.test.ts`，
 * 这里只验「链子接对没有」——用假 host + 真 CardCtl/真 buildCardInit
 * （与 SlotFlow.test.ts 同口径）。
 *
 * ⚠️ **两段式契约**（20260921 复核修正）：`reviewGap` 只判定，
 * `applyGapSame` 才落账，中间必须夹调用方的 `recordAnswer`——真链的
 * 记账会把记录建出来，`applyJevSame` 才找得到。下面的 `runGap` 就是按
 * 这个真实顺序跑的（对应 `AnswerFlow.submitQuestion` 的三步）。
 */

const t = (k: string): string => k;

const fillQ: WenguQuestion = {
    id: "f1",
    type: QuestionType.Fill,
    answer: "光合作用(photosynthesis)",
    stemMd: "写出该过程的名称",
    attempts: 0,
    wrongCount: 0,
};

interface Mark {
    qid: string;
    submitted: string;
    askedKey: string;
}

type Sink = {
    answered: number;
    correct: number;
    elapsedSec: number;
    results: { qid: string; submitted: string; ok: boolean; jevSame?: boolean }[];
};

/** 假宿主：只实现被测分支真的会碰的方法。 */
class FakeHost implements AnswerHost {
    list: WenguQuestion[] = [fillQ];
    marks: Mark[] = [];
    asked = new Set<string>();
    revealMode: "instant" | "after" = "instant";
    verdict: GapJudgeFn | undefined;
    /** 当前会话（`applyJevSame` 的落点）。 */
    session: Sink = { answered: 0, correct: 0, elapsedSec: 0, results: [] };
    /** false = 模拟「未开轮/会话已换」（落账无处可挂）。 */
    hasSession = true;
    t = t;
    container = (): HTMLElement => ({ querySelector: (): null => null }) as unknown as HTMLElement;
    questions = (): WenguQuestion[] => this.list;
    currentRevealMode = (): "instant" | "after" => this.revealMode;
    timerController = (): never =>
        ({ elapsed: (): number => 0, questionSec: (): number => 0, takeQuestionSec: (): number => 0 }) as never;
    currentSession = (): WenguSession => this.session as unknown as WenguSession;
    aiModelId = (): string => "";
    recordAnswer = (): void => undefined;
    flushTime = (): void => undefined;
    roundComplete = (): void => undefined;
    /** 与 `gapReviewFor` 逐字同构：落账走真 `applyJevSame`（否则测的
     *  是桩而不是产品代码）。`session` 为 undefined 时模拟「未开轮」。 */
    gapReview = {
        jevGapVerdict: (): GapJudgeFn | undefined => this.verdict,
        jevGapAsked: (key: string): boolean => this.asked.has(key),
        jevGapMark: (qid: string, submitted: string, askedKey: string): boolean => {
            if (!this.hasSession) return false;
            const wrote = applyJevSame(this.session, qid, submitted);
            if (wrote) {
                this.marks.push({ qid, submitted, askedKey });
                this.asked.add(askedKey);
            }
            return wrote;
        },
    };
}

function ctlOf(host: FakeHost, q: WenguQuestion = fillQ): CardCtl {
    const ctx: CardInitCtx = { t, interactive: true, locked: false };
    return new CardCtl(host, q, 0, buildCardInit(q, ctx), true);
}

/** 一次完整复核（判定 → 记账 → 落账），顺序与 `AnswerFlow.submitQuestion` 同。 */
async function runGap(
    host: FakeHost,
    site: {
        q: WenguQuestion;
        ctl?: CardCtl;
        slot?: { optionMd: string[]; answer: string };
        submitted: string;
        ok: boolean;
        recordQid: string;
    }
): Promise<{ ok: boolean; same: boolean }> {
    const out = await reviewGap({ host, ...site });
    // 记账：真链的这一跳是 `recordAnswer` → `pushSessionAnswer`，这里调真函数
    // （计数语义只有一份——手写 push 会把「correct 涨没涨」测成桩行为）
    if (host.hasSession) {
        pushSessionAnswer(host.session as never, site.recordQid, site.submitted, out.ok, 0, 0);
    }
    applyGapSame({ host, ...site }, out);
    return out;
}

afterEach(() => {
    resetGapSameForTest();
});

describe("reviewGap · 触发与短路", () => {
    it("本地判对：零调用（字面命中零开销）", async () => {
        const host = new FakeHost();
        let calls = 0;
        host.verdict = async (): Promise<boolean> => (calls++, true);
        expect((await runGap(host, { q: fillQ, submitted: "x", ok: true, recordQid: "f1" })).ok).toBe(true);
        expect(calls).toBe(0);
        expect(host.marks).toEqual([]);
    });

    it("非填空失败：零调用（只复核填空）", async () => {
        const host = new FakeHost();
        let calls = 0;
        host.verdict = async (): Promise<boolean> => (calls++, true);
        const single = { ...fillQ, type: QuestionType.Single, optionMd: ["甲", "乙"] };
        const out = await runGap(host, { q: single, submitted: "C", ok: false, recordQid: "f1" });
        expect(out.ok).toBe(false);
        expect(calls).toBe(0);
    });

    it("无 key（jevGapVerdict 为 undefined 的宿主）：零调用，维持判错", async () => {
        const host = new FakeHost();
        host.verdict = undefined;
        const out = await runGap(host, { q: fillQ, submitted: "光合作用", ok: false, recordQid: "f1" });
        expect(out).toEqual({ ok: false, same: false });
        expect(host.marks).toEqual([]);
    });

    it("已问过（去重表命中）：零调用，**回放判同**（不翻成错）", async () => {
        const host = new FakeHost();
        let calls = 0;
        host.verdict = async (): Promise<boolean> => (calls++, false);
        host.asked.add(gapAskedKey(fillQ.id, "光合作用"));
        const out = await runGap(host, { q: fillQ, submitted: "光合作用", ok: false, recordQid: "f1" });
        expect(calls).toBe(0);
        expect(out).toEqual({ ok: true, same: true });
        expect(host.session.results[0]).toEqual({
            qid: "f1",
            submitted: "光合作用",
            ok: true,
            jevSame: true,
        });
        expect(host.session.correct).toBe(1); // 记账涨 +1，落账不重复涨
    });
});

describe("reviewGap · 判同改判", () => {
    it("判同：翻对 + 结果行「回答正确（Jev 判同）」+ 判同入账 + 去重登记", async () => {
        const host = new FakeHost();
        host.verdict = async (): Promise<boolean> => true;
        const ctl = ctlOf(host);
        const out = await runGap(host, { q: fillQ, ctl, submitted: "光合作用", ok: false, recordQid: "f1" });
        try {
            expect(out).toEqual({ ok: true, same: true });
            expect(ctl.ui.resultStatus).toBe("right");
            expect(ctl.ui.resultHtml).toBe("correctjevSameMark");
            expect(host.marks).toEqual([{ qid: "f1", submitted: "光合作用", askedKey: gapAskedKey("f1", "光合作用") }]);
            expect(host.asked.has(gapAskedKey("f1", "光合作用"))).toBe(true);
            expect(host.session.results[0].jevSame).toBe(true);
            expect(host.session.correct).toBe(1);
        } finally {
            unregisterCard(ctl);
        }
    });

    it("判不同（≤0.2 / 中间档）：维持判错，结果行留给既有揭示路径", async () => {
        const host = new FakeHost();
        host.verdict = async (): Promise<boolean> => false;
        const ctl = ctlOf(host);
        const out = await runGap(host, { q: fillQ, ctl, submitted: "呼吸作用", ok: false, recordQid: "f1" });
        expect(out).toEqual({ ok: false, same: false });
        expect(host.marks).toEqual([]);
        expect(ctl.ui.resultStatus).toBe(""); // 复核层不越权改结果行
        expect(host.session.results[0].jevSame).toBeUndefined();
        unregisterCard(ctl);
    });

    it("在途提示：即时模式写「复核中」且**判后清空**（判同由落账段重画终态）", async () => {
        const seen: string[] = [];
        const host = new FakeHost();
        const ctl = ctlOf(host);
        host.verdict = async (): Promise<boolean> => {
            seen.push(ctl.ui.resultHtml);
            return false;
        };
        await runGap(host, { q: fillQ, ctl, submitted: "x1", ok: false, recordQid: "f1" });
        expect(seen).toEqual(["jevReviewing"]); // 复核中曾上屏
        expect(ctl.ui.resultHtml).toBe(""); // 判不同 ⇒ 复位，不留半句提示
        expect(ctl.ui.resultStatus).toBe("");
        unregisterCard(ctl);
    });

    it("收卷模式：不动结果行（收卷前不泄判分口风）", async () => {
        const host = new FakeHost();
        host.revealMode = "after";
        const ctl = ctlOf(host);
        const seen: string[] = [];
        host.verdict = async (): Promise<boolean> => {
            seen.push(ctl.ui.resultHtml);
            return false;
        };
        await runGap(host, { q: fillQ, ctl, submitted: "x", ok: false, recordQid: "f1" });
        expect(seen).toEqual([""]); // 复核期结果行保持原样（由 AnswerFlow 报「已作答」）
        unregisterCard(ctl);
    });

    it("收卷模式判同：不碰结果行/题号（标记靠会话，收卷时补回）", async () => {
        const host = new FakeHost();
        host.revealMode = "after";
        const ctl = ctlOf(host);
        host.verdict = async (): Promise<boolean> => true;
        const out = await runGap(host, { q: fillQ, ctl, submitted: "光合作用", ok: false, recordQid: "f1" });
        expect(out).toEqual({ ok: true, same: true });
        expect(ctl.ui.resultHtml).toBe(""); // 不泄口风
        expect(host.session.results[0].jevSame).toBe(true); // 但账已入，收卷可补
        unregisterCard(ctl);
    });

    it("判定抛错：被吞成判错（复核不许拖垮作答链）", async () => {
        const host = new FakeHost();
        host.verdict = async (): Promise<boolean> => {
            throw new Error("boom");
        };
        const out = await runGap(host, { q: fillQ, submitted: "y", ok: false, recordQid: "f1" });
        expect(out).toEqual({ ok: false, same: false });
    });
});

describe("reviewGap · slots 逐空（无作答位，不写结果行）", () => {
    const slotQ: WenguQuestion = {
        id: "s1",
        type: QuestionType.Cloze,
        answer: "",
        slots: [{ optionMd: ["甲", "乙"], answer: "0.5" }],
        attempts: 0,
        wrongCount: 0,
    };

    it("逐空取材用该空的答案与选项；判同按**会话记录身份 qid#k** 落账", async () => {
        const host = new FakeHost();
        host.list = [slotQ];
        let got = "";
        host.verdict = async (input): Promise<boolean> => {
            got = input.answer;
            return true;
        };
        const ctl = ctlOf(host, slotQ);
        const out = await runGap(host, {
            q: slotQ,
            ctl,
            slot: slotQ.slots![0],
            submitted: "1/2",
            ok: false,
            recordQid: "s1#0",
        });
        expect(out).toEqual({ ok: true, same: true });
        expect(got).toBe("0.5");
        // 落账身份＝会话记录身份（不是整题 id）
        expect(host.marks).toEqual([{ qid: "s1#0", submitted: "1/2", askedKey: gapAskedKey("s1#0", "1/2") }]);
        expect(host.session.results[0]).toEqual({
            qid: "s1#0",
            submitted: "1/2",
            ok: true,
            jevSame: true,
        });
        expect(host.session.correct).toBe(1);
        expect(ctl.ui.resultHtml).toBe(""); // 逐空不写结果行
        unregisterCard(ctl);
    });

    it("逐空判同**不改逐空账/白名单外的会话**：整题 id 上不落痕", async () => {
        const host = new FakeHost();
        host.list = [slotQ];
        host.verdict = async (): Promise<boolean> => true;
        await runGap(host, {
            q: slotQ,
            slot: slotQ.slots![0],
            submitted: "1/2",
            ok: false,
            recordQid: "s1#0",
        });
        expect(host.session.results.find((r) => r.qid === "s1")).toBeUndefined();
    });

    it("会话里查不到该记录（未开轮）：不落账、不画卡面（界面与账本不劈叉）", async () => {
        const host = new FakeHost();
        host.list = [slotQ];
        host.hasSession = false; // 模拟「没有会话」的宿主
        host.verdict = async (): Promise<boolean> => true;
        const ctl = ctlOf(host, slotQ);
        const key = gapAskedKey("s1#0", "1/2");
        const out = await reviewGap({
            host,
            q: slotQ,
            ctl,
            slot: slotQ.slots![0],
            submitted: "1/2",
            ok: false,
            recordQid: "s1#0",
        });
        expect(applyGapSame({ host, q: slotQ, ctl, submitted: "1/2", ok: false, recordQid: "s1#0" }, out)).toBe(false);
        expect(host.asked.has(key)).toBe(false);
        unregisterCard(ctl);
    });
});
