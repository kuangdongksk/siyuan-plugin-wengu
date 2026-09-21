import { describe, expect, it } from "vitest";
import { answerGateFor } from "./AnswerGate";
import { TimerController } from "./TimerController";
import { QTimingOwner } from "./QTimingOwner";

/**
 * 复核三件的**组装接线**（Issue #187）：`answerGateFor` 是视图与判定链之间
 * 的唯一接缝——有 key 时判定函数存在且判同入账落到当前会话；无 key/开关关时
 * 判定函数为 undefined（复核链零调用，即验收 1 的「零行为变化」）。
 * 判定与阈值本身在 `GapJudge.test.ts`，这里只看接线。
 */
describe("AnswerGate 接线（#187）", () => {
    const session = {
        correct: 0,
        results: [
            { qid: "f1", submitted: "光合作用", ok: false } as {
                qid: string;
                submitted: string;
                ok: boolean;
                jevSame?: boolean;
            },
        ],
    };
    const timer = new TimerController(() => undefined);
    const gate = answerGateFor(
        {
            settings: { jevKey: "sk-test" },
            questions: () => [],
            currentSession: () => session as never,
            historyStore: () => undefined,
            bankStore: () => undefined,
            persist: () => undefined,
        },
        timer,
        new QTimingOwner()
    );

    it("有 key：判定函数存在（无 key 的宿主不会走到这里）", () => {
        expect(typeof gate.gapReview.jevGapVerdict()).toBe("function");
        expect(gate.gapReview.jevGapAsked("nope")).toBe(false);
    });

    it("判同入账：翻 ok + 挂标记 + 去重登记", () => {
        expect(gate.gapReview.jevGapMark("f1", "光合作用")).toBe(true);
        expect(session.results[0].ok).toBe(true);
        expect(session.results[0].jevSame).toBe(true);
        expect(session.correct).toBe(1);
        expect(gate.gapReview.jevGapAsked("f1\u0000光合作用".normalize())).toBe(true);
    });
});

describe("AnswerGate 接线：无 key", () => {
    it("无 key / 开关关 ⇒ 判定函数 undefined（复核链零调用）", () => {
        const timer = new TimerController(() => undefined);
        const make = (
            settings: { jevKey?: string; jevEnabled?: boolean } | undefined
        ): ReturnType<typeof answerGateFor> =>
            answerGateFor(
                {
                    settings,
                    questions: () => [],
                    currentSession: () => undefined,
                    historyStore: () => undefined,
                    bankStore: () => undefined,
                    persist: () => undefined,
                },
                timer,
                new QTimingOwner()
            );
        expect(make(undefined).gapReview.jevGapVerdict()).toBeUndefined();
        expect(make({}).gapReview.jevGapVerdict()).toBeUndefined();
        expect(make({ jevKey: "sk-1", jevEnabled: false }).gapReview.jevGapVerdict()).toBeUndefined();
        expect(typeof make({ jevKey: "sk-1" }).gapReview.jevGapVerdict()).toBe("function");
    });
});
