import { describe, expect, it } from "vitest";
import { answerGateFor } from "./AnswerGate";
import { TimerController } from "./TimerController";
import { QTimingOwner } from "./QTimingOwner";
import { gapAskedKey } from "./GapJudge";

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
        },
        timer,
        new QTimingOwner()
    );

    it("有 key：判定函数存在（无 key 的宿主不会走到这里）", () => {
        expect(typeof gate.gapReview.jevGapVerdict()).toBe("function");
        expect(gate.gapReview.jevGapAsked("nope")).toBe(false);
    });

    it("判同入账：翻 ok + 挂标记 + 去重登记", () => {
        expect(gate.gapReview.jevGapMark("f1", "光合作用", gapAskedKey("f1", "光合作用"))).toBe(true);
        expect(session.results[0].ok).toBe(true);
        expect(session.results[0].jevSame).toBe(true);
        expect(session.correct).toBe(1);
        expect(gate.gapReview.jevGapAsked(gapAskedKey("f1", "光合作用"))).toBe(true);
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

describe("AnswerGate 接线：设置面惰性读取（真视图形态）", () => {
    it("构造后才写入 settings 也生效（QuizView 字段初始化早于构造体赋值）", () => {
        const timer = new TimerController(() => undefined);
        const view = {
            settings: undefined as { jevKey?: string; jevEnabled?: boolean } | undefined,
            questions: (): [] => [],
            currentSession: (): undefined => undefined,
            historyStore: (): undefined => undefined,
            bankStore: (): undefined => undefined,
            takeSec: (): number => 0,
            elapsedSec: (): number => 0,
            notifyAnswer: (): void => undefined,
        };
        const gate = answerGateFor(view as never, timer, new QTimingOwner());
        // 构造期确实没 key
        expect(gate.gapReview.jevGapVerdict()).toBeUndefined();
        // 之后才配上（QuizView 的 settings 是构造体里赋的值）
        view.settings = { jevKey: "sk-late" };
        expect(typeof gate.gapReview.jevGapVerdict()).toBe("function");
        // 关掉总开关也要立刻反映（同一个设置对象被设置页就地改写）
        view.settings = { jevKey: "sk-late", jevEnabled: false };
        expect(gate.gapReview.jevGapVerdict()).toBeUndefined();
        view.settings = undefined;
        expect(gate.gapReview.jevGapVerdict()).toBeUndefined();
    });
});
