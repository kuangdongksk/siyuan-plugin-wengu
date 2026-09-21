import { afterEach, describe, expect, it } from "vitest";
import type { AnswerHost } from "./AnswerFlow";
import { reviewGap } from "./GapReview";
import { CardCtl } from "../render/CardCtl";
import { buildCardInit, type CardInitCtx } from "../render/CardState";
import { unregisterCard } from "../render/CardRegistry";
import { gapAskedKey, resetGapSameForTest, type GapJudgeFn } from "../service/GapJudge";
import { QuestionType, type WenguQuestion } from "../../types";

/**
 * 填空复核的**接线层**（Issue #187）：谁被调用、在途结果行写什么、
 * 判同后卡面与题号怎么变。判定阈值本身在 `service/GapJudge.test.ts`，
 * 这里只验「链子接对没有」——用假 host + 真 CardCtl/真 buildCardInit
 * （与 SlotFlow.test.ts 同口径）。
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
    slotKey?: string;
}

/** 假宿主：只实现被测分支真的会碰的方法。 */
class FakeHost implements AnswerHost {
    list: WenguQuestion[] = [fillQ];
    marks: Mark[] = [];
    asked = new Set<string>();
    revealMode: "instant" | "after" = "instant";
    verdict: GapJudgeFn | undefined;
    t = t;
    container = (): HTMLElement => ({ querySelector: (): null => null }) as unknown as HTMLElement;
    questions = (): WenguQuestion[] => this.list;
    currentRevealMode = (): "instant" | "after" => this.revealMode;
    timerController = (): never =>
        ({ elapsed: (): number => 0, questionSec: (): number => 0, takeQuestionSec: (): number => 0 }) as never;
    currentSession = (): undefined => undefined;
    aiModelId = (): string => "";
    recordAnswer = (): void => undefined;
    flushTime = (): void => undefined;
    roundComplete = (): void => undefined;
    gapReview = {
        jevGapVerdict: (): GapJudgeFn | undefined => this.verdict,
        jevGapAsked: (key: string): boolean => this.asked.has(key),
        jevGapMark: (qid: string, submitted: string, slotKey?: string): boolean => {
            this.marks.push({ qid, submitted, slotKey });
            this.asked.add(gapAskedKey(slotKey ?? qid, submitted));
            return true;
        },
    };
}

function ctlOf(host: FakeHost, q: WenguQuestion = fillQ): CardCtl {
    const ctx: CardInitCtx = { t, interactive: true, locked: false };
    const ctl = new CardCtl(host, q, 0, buildCardInit(q, ctx), true);
    return ctl;
}

afterEach(() => {
    resetGapSameForTest();
});

describe("reviewGap · 触发与短路", () => {
    it("本地判对：零调用（字面命中零开销）", async () => {
        const host = new FakeHost();
        let calls = 0;
        host.verdict = async (): Promise<boolean> => (calls++, true);
        expect(await reviewGap({ host, q: fillQ, submitted: "x", ok: true })).toBe(true);
        expect(calls).toBe(0);
    });

    it("非填空失败：零调用（只复核填空）", async () => {
        const host = new FakeHost();
        let calls = 0;
        host.verdict = async (): Promise<boolean> => (calls++, true);
        const single = { ...fillQ, type: QuestionType.Single, optionMd: ["甲", "乙"] };
        expect(await reviewGap({ host, q: single, submitted: "C", ok: false })).toBe(false);
        expect(calls).toBe(0);
    });

    it("无 key（jevGapVerdict 为 undefined 的宿主）：零调用，维持判错", async () => {
        const host = new FakeHost();
        host.verdict = undefined;
        expect(await reviewGap({ host, q: fillQ, submitted: "光合作用", ok: false })).toBe(false);
        expect(host.marks).toEqual([]);
    });

    it("已问过（去重表命中）：零调用，维持判错", async () => {
        const host = new FakeHost();
        let calls = 0;
        host.verdict = async (): Promise<boolean> => (calls++, true);
        host.asked.add(gapAskedKey(fillQ.id, "光合作用"));
        expect(await reviewGap({ host, q: fillQ, submitted: "光合作用", ok: false })).toBe(false);
        expect(calls).toBe(0);
    });
});

describe("reviewGap · 判同改判", () => {
    it("判同：翻对 + 结果行「回答正确（Jev 判同）」+ 判同入账 + 去重登记", async () => {
        const host = new FakeHost();
        host.verdict = async (): Promise<boolean> => true;
        const ctl = ctlOf(host);
        const ok = await reviewGap({ host, q: fillQ, ctl, submitted: "光合作用", ok: false });
        try {
            expect(ok).toBe(true);
            expect(ctl.ui.resultStatus).toBe("right");
            expect(ctl.ui.resultHtml).toBe("correctjevSameMark");
            expect(host.marks).toEqual([{ qid: "f1", submitted: "光合作用", slotKey: undefined }]);
            expect(host.asked.has(gapAskedKey("f1", "光合作用"))).toBe(true);
        } finally {
            unregisterCard(ctl);
        }
    });

    it("判不同（≤0.2 / 中间档）：维持判错，结果行留给既有揭示路径", async () => {
        const host = new FakeHost();
        host.verdict = async (): Promise<boolean> => false;
        const ctl = ctlOf(host);
        expect(await reviewGap({ host, q: fillQ, ctl, submitted: "呼吸作用", ok: false })).toBe(false);
        expect(host.marks).toEqual([]);
        expect(ctl.ui.resultStatus).toBe(""); // 复核层不越权改结果行
        unregisterCard(ctl);
    });

    it("在途提示：即时模式写「复核中」且**不等价时清回空态**（交回揭示路径）", async () => {
        const seen: string[] = [];
        const host = new FakeHost();
        const ctl = ctlOf(host);
        host.verdict = async (): Promise<boolean> => {
            seen.push(ctl.ui.resultHtml);
            return false;
        };
        await reviewGap({ host, q: fillQ, ctl, submitted: "x1", ok: false });
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
        await reviewGap({ host, q: fillQ, ctl, submitted: "x", ok: false });
        expect(seen).toEqual([""]); // 复核期结果行保持原样（由 AnswerFlow 报「已作答」）
        unregisterCard(ctl);
    });

    it("判定抛错：被吞成判错（复核不许拖垮作答链）", async () => {
        const host = new FakeHost();
        host.verdict = async (): Promise<boolean> => {
            throw new Error("boom");
        };
        expect(await reviewGap({ host, q: fillQ, submitted: "y", ok: false })).toBe(false);
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

    it("逐空取材用该空的答案与选项；判同按空键去重", async () => {
        const host = new FakeHost();
        host.list = [slotQ];
        let got = "";
        host.verdict = async (input): Promise<boolean> => {
            got = input.answer;
            return true;
        };
        const ok = await reviewGap({ host, q: slotQ, slot: slotQ.slots![0], submitted: "1/2", ok: false });
        expect(ok).toBe(true);
        expect(got).toBe("0.5");
        expect(host.marks).toEqual([{ qid: "s1", submitted: "1/2", slotKey: "s1#0.5" }]);
    });
});
