import { describe, expect, it } from "vitest";
import type { JevAnswer, JevQuestion } from "../../ai/jev/client";
import type { WordAiInput } from "./WordAi";
import {
    actOfOption,
    buildWordReviewQuestions,
    buildWordReviewState,
    gradeFromAnswers,
    JEV_ACT_CRITERIA,
    JEV_ACTS,
    judgeWordReview,
    type JudgeFn,
} from "./WordAiJev";

/**
 * Jev 判档单测（Issue #185 验收标准 2）：**全 mock，不碰真网络**。
 * 这里锁三件事——三档映射、低置信/坏答案跳过、手滑修正，
 * 以及「一批一次请求」的批量口径。
 */

/** 造一条词画像（只需判档用得到的字段）。 */
function input(w: string, extra: Partial<WordAiInput> = {}): WordAiInput {
    return { index: 0, key: w.toLowerCase(), w, m: `${w} 的中文释义`, count: 0, ...extra };
}

/** 造一条 choice 答案：入参是档位代号，选中项取「描述当选项」的下发原文。 */
function choice(act: string, confidence = 0.9): JevAnswer {
    const opt = JEV_ACT_CRITERIA[act as keyof typeof JEV_ACT_CRITERIA];
    return { kind: "choice", choice: opt, probabilities: { [opt]: confidence }, confidence };
}

/** 造一条 noul 答案。 */
function noul(p: number): JevAnswer {
    return { kind: "noul", noul: p };
}

describe("判档问题组装（一批一次请求）", () => {
    it("逐词两问（choice 选档 + noul 手滑），位序 2i / 2i+1 与输入一致", () => {
        const inputs = [input("alpha"), input("beta")];
        const qs = buildWordReviewQuestions(inputs);
        expect(qs.length).toBe(4);
        expect(qs[0].kind).toBe("choice");
        expect(qs[1].kind).toBe("noul");
        expect(qs[2].kind).toBe("choice");
        expect(qs[3].kind).toBe("noul");
        // 问题正文带词头，保证「第 N 个词」与材料行对得上
        expect(qs[0].question).toContain("alpha");
        expect(qs[2].question).toContain("beta");
    });

    it("choice 的选项是「档位描述原文」（情形写死，且 ≠ 内部代号）", () => {
        const qs = buildWordReviewQuestions([input("alpha")]);
        const opts = (qs[0] as { options: string[] }).options;
        expect(opts).toEqual([JEV_ACT_CRITERIA.up, JEV_ACT_CRITERIA.keep, JEV_ACT_CRITERIA.down]);
        expect(opts).not.toContain("up");
        // 每个选项都能反查回唯一档位（回取不依模型认代号）
        expect(opts.map(actOfOption)).toEqual([...JEV_ACTS]);
    });

    it("描述各档写死具体情形、互不重复", () => {
        const vals = JEV_ACTS.map((a) => JEV_ACT_CRITERIA[a]);
        expect(new Set(vals).size).toBe(3);
        for (const v of vals) expect(v.length).toBeGreaterThan(6);
        expect(actOfOption("某个不存在的选项")).toBeUndefined();
    });

    it("state 逐词一行且带齐判定信号（答对/答错、用时、自述、拼错）", () => {
        const s = buildWordReviewState([
            input("alpha", { correct: true, mode: "choiceZh", ms: 1200, count: 2 }),
            input("beta", { correct: false, mode: "spell", ms: 9000, over: 1, typed: "bat", confused: "蝙蝠" }),
        ]);
        const lines = s.split("\n");
        expect(lines[0]).toContain("背单词");
        expect(lines[1]).toContain("alpha");
        expect(lines[1]).toContain("答对");
        expect(lines[1]).toContain("累计答错 2 次");
        expect(lines[2]).toContain("beta");
        expect(lines[2]).toContain("答错");
        expect(lines[2]).toContain("超时");
        expect(lines[2]).toContain("bat");
        expect(lines[2]).toContain("蝙蝠");
    });

    it("批量口径：N 个词只发一次请求（不逐词发）", async () => {
        const calls: { state: string; questions: JevQuestion[] }[] = [];
        const judge: JudgeFn = async (o) => {
            calls.push({ state: o.state, questions: o.questions });
            return o.questions.map((q) => (q.kind === "choice" ? choice("keep") : noul(0.9)));
        };
        const items = await judgeWordReview([input("a"), input("b"), input("c")], "sk-test", judge);
        expect(calls.length).toBe(1);
        expect(calls[0].questions.length).toBe(6);
        expect(items.map((i) => i.key)).toEqual(["a", "b", "c"]);
    });

    it("空批不发请求（零调用、零条目）", async () => {
        let n = 0;
        const judge: JudgeFn = async () => {
            n++;
            return [];
        };
        expect(await judgeWordReview([], "sk", judge)).toEqual([]);
        expect(n).toBe(0);
    });
});

describe("三档映射（验收标准 2 第一条）", () => {
    it("choice 选中 up/keep/down 原样落到 applyAiReview 入参档位", () => {
        const inputs = [input("a"), input("b"), input("c")];
        const items = gradeFromAnswers(inputs, [
            choice("up"),
            noul(0.9),
            choice("keep"),
            noul(0.9),
            choice("down"),
            noul(0.9),
        ]);
        expect(items).toEqual([
            { key: "a", act: "up" },
            { key: "b", act: "keep" },
            { key: "c", act: "down" },
        ]);
    });

    it("keep 照产条目（applyAiReview 对 keep 是空动作，语义即「不动」）", () => {
        const items = gradeFromAnswers([input("a")], [choice("keep", 1), noul(0.5)]);
        expect(items).toEqual([{ key: "a", act: "keep" }]);
    });

    it("手滑修正：down + noul 明确「不是没记住」(≤0.2) → keep（不降档）", () => {
        const items = gradeFromAnswers([input("a")], [choice("down"), noul(0.1)]);
        expect(items).toEqual([{ key: "a", act: "keep" }]);
    });

    it("手滑修正只对 down 生效：noul 明确「否」不改 up（答对不因 noul 翻案）", () => {
        const items = gradeFromAnswers([input("a")], [choice("up"), noul(0.05)]);
        expect(items).toEqual([{ key: "a", act: "up" }]);
    });

    it("noul 不确定（0.2~0.8）→ 维持 choice 档位，不因一次拿不准改档", () => {
        const items = gradeFromAnswers([input("a")], [choice("down"), noul(0.5)]);
        expect(items).toEqual([{ key: "a", act: "down" }]);
    });

    it("noul 概率缺失（NaN）按不确定处置，仍维持 choice 档位", () => {
        const items = gradeFromAnswers([input("a")], [choice("down"), { kind: "noul", noul: Number.NaN }]);
        expect(items).toEqual([{ key: "a", act: "down" }]);
    });
});

describe("低置信与坏答案：跳过该词（需求 2：稳定度不动）", () => {
    it("choice 置信 <0.5 → 该词不给条目（维持原稳定度不动）", () => {
        const inputs = [input("a"), input("b")];
        const items = gradeFromAnswers(inputs, [
            choice("up", 0.49), // 低置信：跳过
            noul(0.9),
            choice("down", 0.95), // 正常
            noul(0.9),
        ]);
        expect(items).toEqual([{ key: "b", act: "down" }]);
    });

    it("置信度缺失（NaN→0）按低置信处置，不静默当明确", () => {
        const bad: JevAnswer = { kind: "choice", choice: "up", probabilities: {}, confidence: Number.NaN };
        expect(gradeFromAnswers([input("a")], [bad, noul(0.9)])).toEqual([]);
    });

    it("choice 恰好 0.5 视为可信（policy 边界口径一致）", () => {
        expect(gradeFromAnswers([input("a")], [choice("up", 0.5), noul(0.5)])).toEqual([{ key: "a", act: "up" }]);
    });

    it("选中项不在三档内（模型自造词/答非所问）→ 跳过，绝不当档位用", () => {
        const bogus: JevAnswer = { kind: "choice", choice: "maybe", probabilities: {}, confidence: 0.9 };
        expect(gradeFromAnswers([input("a")], [bogus, noul(0.9)])).toEqual([]);
    });

    it("答案缺失（数量对不上）→ 缺位跳过，不抛错、不误落档", () => {
        const items = gradeFromAnswers([input("a"), input("b")], [choice("up"), noul(0.9)]);
        expect(items).toEqual([{ key: "a", act: "up" }]);
    });

    it("answer 数量多于输入（多回）也只按位取，不越界", () => {
        const items = gradeFromAnswers([input("a")], [choice("down"), noul(0.9), choice("up"), noul(0.9)]);
        expect(items).toEqual([{ key: "a", act: "down" }]);
    });

    it("答案类型与问题错位（choice 位置拿到 noul）→ 跳过该词", () => {
        expect(gradeFromAnswers([input("a")], [noul(0.9), choice("up")])).toEqual([]);
    });
});

describe("问题词号与 state 材料行号逐一对齐（#185 审查回归）", () => {
    it("choice/noul 同一词问同号，且逐词递增（不是 1.5 / 2.5）", () => {
        const qs = buildWordReviewQuestions([input("a"), input("b"), input("c")]);
        const nums = qs.map((q) => q.question.match(/第 ([\d.]+) 个词/)?.[1]);
        expect(nums).toEqual(["1", "1", "2", "2", "3", "3"]);
    });

    it("每个词的 noul 问号与它自己的 choice 问号一致（不许出现非整数号）", () => {
        const qs = buildWordReviewQuestions([input("alpha"), input("beta")]);
        for (const q of qs) expect(q.question).not.toMatch(/第 \d+\.\d+ 个词/);
        expect(qs[0].question).toContain("「alpha」");
        expect(qs[1].question).toContain("「alpha」"); // 同词的两问都指 alpha
        expect(qs[2].question).toContain("「beta」");
        expect(qs[3].question).toContain("「beta」");
    });

    it("词号与 state 行号一致：第 N 问 ↔ 材料第 N 行（同一词头）", () => {
        const inputs = [input("alpha"), input("beta"), input("gamma")];
        const lines = buildWordReviewState(inputs).split("\n").slice(1); // 去掉表头
        const qs = buildWordReviewQuestions(inputs);
        inputs.forEach((e, i) => {
            expect(lines[i]).toContain(`${i + 1}. ${e.w}`);
            expect(qs[i * 2].question).toContain(`第 ${i + 1} 个词`);
        });
    });
});
