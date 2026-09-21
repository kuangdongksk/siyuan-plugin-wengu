import { describe, expect, it, vi } from "vitest";
import {
    GAP_SAME_MIN,
    applyJevSame,
    gapAskedKey,
    gapInputOf,
    gapJudgeState,
    gapKnownSame,
    gapVerdictOf,
    jevSameOf,
    makeGapVerdict,
    resetGapSameForTest,
    shouldReviewGap,
    type GapJudgeInput,
} from "./GapJudge";
import { judgeJev } from "../../ai/jev/client";
import { QuestionType, type WenguQuestion } from "../../types";
import type { JevHttpResponse } from "../../ai/jev/transport";

/**
 * 填空语义判等复核（Issue #187）：本单的验收面全在这里——阈值三档、
 * 触发闸（判对/非填空/无 key/已问过零调用）、失败与超时回落现状、
 * 判同入账（会话结果 + correct 计数）。
 * 全部走 mock transport（`makeGapVerdict` 的注入接缝），**不碰真网络**；
 * `judgeJev` 自身的行为已由 `ai/jev/client.test.ts` 钉死，这里只验本层。
 */

/** 造一个可注入的 mock transport：固定回一个 noul 概率，并记录请求次数。 */
function noulTransport(p: number, status = 200) {
    let calls = 0;
    const fn = async (): Promise<JevHttpResponse> => {
        calls++;
        return { status, body: JSON.stringify({ answers: { q0: { noul: p } } }) };
    };
    return { fn, calls: () => calls };
}

const fillQ = (over: Partial<WenguQuestion> = {}): WenguQuestion => ({
    id: "q1",
    type: QuestionType.Fill,
    answer: "光合作用(photosynthesis)",
    stemMd: "写出该过程的名称",
    attempts: 0,
    wrongCount: 0,
    ...over,
});

const on = { jevKey: "sk-test" };

describe("阈值三档（≥0.9 判同 / ≤0.2 与中间档维持判错）", () => {
    it("0.9 与以上判同；0.2 及以下、中间档、非数一律不判同", () => {
        expect(gapVerdictOf(0.9)).toBe("same");
        expect(gapVerdictOf(1)).toBe("same");
        expect(gapVerdictOf(0.89)).toBe("unsure");
        expect(gapVerdictOf(0.2)).toBe("no");
        expect(gapVerdictOf(0.5)).toBe("unsure");
        expect(gapVerdictOf(Number.NaN)).toBe("unsure");
        expect(gapVerdictOf(undefined)).toBe("unsure");
        expect(GAP_SAME_MIN).toBe(0.9);
    });

    it("概率缺失不可当成「明确不等价」（判定失败＝不确定，不是拒绝）", () => {
        expect(gapVerdictOf(undefined)).toBe("unsure");
        expect(gapVerdictOf(Number.NaN)).toBe("unsure");
    });
});

describe("触发闸：判对 / 非填空 / 无 key / 已问过一律零调用", () => {
    const input: GapJudgeInput = { stem: "s", answer: "a", submitted: "b", options: [] };

    it("判对不触发（字面命中零开销）", () => {
        expect(
            shouldReviewGap({ ok: true, type: QuestionType.Fill, key: "k", input, verdict: async () => false })
        ).toBe(false);
    });

    it("题型闸只放填空（选择/判断的精确匹配即规格本身）", () => {
        const verdict = async (): Promise<boolean> => true;
        expect(shouldReviewGap({ ok: false, type: QuestionType.Single, key: "k", input, verdict })).toBe(false);
        expect(shouldReviewGap({ ok: false, type: QuestionType.Judge, key: "k", input, verdict })).toBe(false);
        expect(shouldReviewGap({ ok: false, type: QuestionType.Fill, key: "k", input, verdict })).toBe(true);
    });

    it("无 key（总闸关）不触发", () => {
        expect(shouldReviewGap({ ok: false, type: QuestionType.Fill, key: "k", input })).toBe(false);
    });

    it("已问过的键不重问（去重表只存已判同）", () => {
        const verdict = async (): Promise<boolean> => true;
        expect(
            shouldReviewGap({ ok: false, type: QuestionType.Fill, key: "k", input, verdict, asked: () => true })
        ).toBe(false);
        expect(
            shouldReviewGap({ ok: false, type: QuestionType.Fill, key: "k", input, verdict, asked: () => false })
        ).toBe(true);
    });

    it("无 key 时**缓存也不参与**（gapKnownSame 为 false）—— 验收 1 的守门人", () => {
        // 没配 key 时不该有任何改分机会，连「旧判同缓存回放」都不行：
        // 用户清掉 key 后，历史缓存绝不能继续把字面失配翻成对。
        expect(gapKnownSame({ ok: false, type: QuestionType.Fill, key: "k", input, asked: () => true })).toBe(false);
        const verdict = async (): Promise<boolean> => true;
        expect(gapKnownSame({ ok: false, type: QuestionType.Fill, key: "k", input, verdict, asked: () => true })).toBe(
            true
        );
        // 判对 / 非填空：同样不算「已知判同」
        expect(gapKnownSame({ ok: true, type: QuestionType.Fill, key: "k", input, verdict, asked: () => true })).toBe(
            false
        );
        expect(
            gapKnownSame({ ok: false, type: QuestionType.Single, key: "k", input, verdict, asked: () => true })
        ).toBe(false);
    });
});

describe("判定函数（makeGapVerdict）：mock judgeJev，不碰真网络", () => {
    it("无 key / 开关关 ⇒ undefined（链上零调用，接线层据此短路）", () => {
        expect(makeGapVerdict(undefined)).toBeUndefined();
        expect(makeGapVerdict({})).toBeUndefined();
        expect(makeGapVerdict({ jevKey: "  " })).toBeUndefined();
        expect(makeGapVerdict({ jevKey: "sk-1", jevEnabled: false })).toBeUndefined();
        expect(typeof makeGapVerdict(on)).toBe("function");
    });

    it("≥0.9 ⇒ 判同；≤0.2 与中间档 ⇒ 维持判错", async () => {
        const q = fillQ();
        const input = gapInputOf(q, "光合作用");
        for (const [p, want] of [
            [0.95, true],
            [0.9, true],
            [0.5, false],
            [0.2, false],
            [0.05, false],
        ] as const) {
            const t = noulTransport(p);
            const v = makeGapVerdict(on, { transport: t.fn });
            expect(await v!(input)).toBe(want);
            expect(t.calls()).toBe(1);
        }
    });

    it("请求失败/超时/鉴权错/协议错一律回落 false（不抛、不打断作答）", async () => {
        const cases: { status: number; body: string }[] = [
            { status: 0, body: "" }, // 网络层没拿到响应
            { status: 401, body: "unauthorized" }, // key 无效
            { status: 500, body: "boom" }, // 上游错
            { status: 200, body: "not json" }, // 协议错
        ];
        for (const c of cases) {
            let calls = 0;
            const v = makeGapVerdict(on, {
                transport: async (): Promise<JevHttpResponse> => {
                    calls++;
                    return c;
                },
                sleep: async (): Promise<void> => undefined,
            });
            expect(await v!(gapInputOf(fillQ(), "光合作用"))).toBe(false);
            expect(calls).toBeGreaterThan(0);
        }
    });

    it("抛异常（如传输层抛出）也被吞成 false", async () => {
        const v = makeGapVerdict(on, {
            transport: async (): Promise<JevHttpResponse> => {
                throw new Error("boom");
            },
        });
        expect(await v!(gapInputOf(fillQ(), "光合作用"))).toBe(false);
    });

    it("429 → 退避重试一次（用注入的 sleep，不真睡）；重试仍 429 回落 false", async () => {
        const { fn, calls } = noulTransport(0.95, 429);
        const sleep = vi.fn(async (): Promise<void> => undefined);
        const v = makeGapVerdict(on, { transport: fn, sleep });
        expect(await v!(gapInputOf(fillQ(), "光合作用"))).toBe(false);
        expect(calls()).toBe(2);
        expect(sleep).toHaveBeenCalledTimes(1);
    });
});

describe("复核输入与判定材料", () => {
    it("取材四处齐备：题干/标准答案/用户作答/选项", () => {
        const q = fillQ({ optionMd: ["光合作用", "呼吸作用"] });
        const input = gapInputOf(q, "  光合作用  ");
        expect(input.stem).toBe("写出该过程的名称");
        expect(input.answer).toBe("光合作用(photosynthesis)");
        expect(input.submitted).toBe("光合作用"); // 去首尾空白
        expect(input.options).toEqual(["光合作用", "呼吸作用"]);
    });

    it("判断题/多选题的选项为空数组（不进材料，不误报）", () => {
        expect(gapInputOf(fillQ(), "x").options).toEqual([]);
    });

    it("判定材料含题干/答案/作答三要素，多答案写法带说明", () => {
        const s = gapJudgeState({
            stem: "题干文本",
            answer: "1|2",
            submitted: "1.0",
            options: ["甲"],
        });
        expect(s).toContain("题干文本");
        expect(s).toContain("1|2");
        expect(s).toContain("1.0");
        expect(s).toContain("|");
        expect(s).toContain("可选项");
    });

    it("题干/选项超长截断（取材层，判定材料不让题干吃掉全部预算）", () => {
        const q = fillQ({ stemMd: "题".repeat(5000), optionMd: ["甲".repeat(3000)] });
        const input = gapInputOf(q, "x");
        expect(input.stem.length).toBeLessThanOrEqual(1201); // 1200 + 省略号
        expect(input.stem.endsWith("…")).toBe(true);
        expect(input.options[0].endsWith("…")).toBe(true);
        expect(gapJudgeState(input).length).toBeLessThan(3000); // 1200 题干 + 1200 选项 + 骨架
    });
});

describe("判同入账（只动本轮会话结果，不新增持久化字段）", () => {
    const session = () => ({
        correct: 1,
        results: [
            { qid: "q1", submitted: "错答", ok: false } as {
                qid: string;
                submitted: string;
                ok: boolean;
                jevSame?: boolean;
            },
            { qid: "q2", submitted: "对答", ok: true } as {
                qid: string;
                submitted: string;
                ok: boolean;
                jevSame?: boolean;
            },
        ],
    });

    it("判错 → 翻对 + 挂 jevSame 标记 + correct +1", () => {
        const s = session();
        expect(applyJevSame(s, "q1", "光合作用")).toBe(true);
        expect(s.results[0]).toEqual({ qid: "q1", submitted: "光合作用", ok: true, jevSame: true });
        expect(s.correct).toBe(2);
    });

    it("已是对：**仍要挂标记**（界面靠它出「Jev 判同」），但不重复涨计数", () => {
        // 20260921 复核修正：调用方是「先 recordAnswer 再落标记」，走到这里
        // 时 ok 多半已是 true——早先的实现在这个分支直接 return，标记永远
        // 不落，界面上永无「Jev 判同」（真机静默失效）。
        const s = session();
        expect(applyJevSame(s, "q2", "对答")).toBe(true);
        expect(s.correct).toBe(1); // 记账早已 +1，不许重复涨
        expect(s.results[1].jevSame).toBe(true);
    });

    it("题不在本轮（会话已换）⇒ false，静默不改", () => {
        expect(applyJevSame(session(), "nope", "x")).toBe(false);
        expect(applyJevSame(undefined, "q1", "x")).toBe(false);
    });

    it("jevSameOf：本轮该题的判同标记（恢复态结果行读它）", () => {
        const s = session();
        expect(jevSameOf(s.results, "q1")).toBe(false);
        applyJevSame(s, "q1", "光合作用");
        expect(jevSameOf(s.results, "q1")).toBe(true);
        expect(jevSameOf(undefined, "q1")).toBe(false);
    });
});

describe("去重键与判同表", () => {
    it("同题同答（空白/大小写差异）同键；不同答不同键", () => {
        expect(gapAskedKey("q1", " A B ")).toBe(gapAskedKey("q1", "ab"));
        expect(gapAskedKey("q1", "a")).not.toBe(gapAskedKey("q2", "a"));
        expect(gapAskedKey("q1", "a")).not.toBe(gapAskedKey("q1", "b"));
    });
});

describe("端到端：失配 → 判同（mock 传输）", () => {
    it("走 judgeJev 真链路（只 mock 传输层）：0.93 ⇒ 判同", async () => {
        const { fn, calls } = noulTransport(0.93);
        const v = makeGapVerdict(on, { transport: fn });
        const same = await v!(gapInputOf(fillQ(), "光合作用"));
        expect(same).toBe(true);
        expect(calls()).toBe(1);
        resetGapSameForTest();
    });

    it("judgeJev 被真调用（材料与问题各就各位，问题只一句判词）", async () => {
        const spy = vi.spyOn(await import("../../ai/jev/client"), "judgeJev");
        spy.mockResolvedValue([{ kind: "noul", noul: 0.95 }]);
        const v = makeGapVerdict(on);
        expect(await v!(gapInputOf(fillQ(), "光合作用"))).toBe(true);
        expect(spy).toHaveBeenCalledTimes(1);
        const arg = spy.mock.calls[0][0];
        expect(arg.questions).toHaveLength(1);
        expect(arg.state).toContain("光合作用");
        expect(arg.apiKey).toBe("sk-test");
        spy.mockRestore();
        expect(typeof judgeJev).toBe("function");
    });
});
