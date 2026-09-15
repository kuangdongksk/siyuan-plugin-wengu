import { describe, expect, it } from "vitest";
import { QuestionType, type WenguQuestion } from "../../types";
import { isShufflable, shuffleForDisplay, shuffleListForDisplay } from "./CardDisplayShuffle";
import { gradeQuestion, optionIsRight } from "../service/QuestionGrading";

/**
 * 展示层洗牌的核心不变量（Issue #131 验收 3）：**洗后答案字母指向同一
 * 选项文本**——展示序变了、字母与选项的对应关系随之变，判分（按字母比）
 * 与描色（按 idx 找答案）仍然自洽。位置敏感组原样不洗；steps 各步独立洗
 * 且各步答案各自重写；cloze/match 不洗。
 */

const q = (over: Partial<WenguQuestion>): WenguQuestion => ({
    id: "q1",
    type: QuestionType.Single,
    attempts: 0,
    wrongCount: 0,
    ...over,
});

/** 确定性 RNG：给定一串 [0,1) 序列循环喂（复现排列）。 */
const rng = (seq: number[]): (() => number) => {
    let i = 0;
    return () => seq[i++ % seq.length];
};

/** 答案字母 → 该位置的选项文本（洗后自洽性的唯一判据）。 */
const answerText = (x: WenguQuestion): string => {
    const i = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf((x.answer ?? "").toUpperCase());
    return x.optionMd?.[i] ?? "";
};

describe("shuffleForDisplay · single/multiple", () => {
    it("洗后答案字母指向同一选项文本（判分与描色自洽）", () => {
        const base = q({ optionMd: ["甲", "乙", "丙", "丁"], answer: "B" });
        for (let seed = 0; seed < 40; seed++) {
            const x = shuffleForDisplay(base, rng([(seed % 7) / 7, (seed % 5) / 5, (seed % 3) / 3]));
            expect(x).not.toBe(base);
            expect(answerText(x)).toBe("乙"); // 文本不变
            expect([...(x.optionMd ?? [])].sort()).toEqual(["丁", "丙", "乙", "甲"].sort()); // 集合不变
            // 判分/描色：用户选中答案字母 ⇒ 判对，且该 idx 被认作正确项
            expect(gradeQuestion(x, (x.answer ?? "").toUpperCase())).toBe(true);
            const idx = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf((x.answer ?? "").toUpperCase());
            expect(optionIsRight(x, idx)).toBe(true);
        }
    });

    it("multiple：正确集合的文本集合不变（字母随映射重写）", () => {
        const base = q({ type: QuestionType.Multiple, optionMd: ["甲", "乙", "丙", "丁"], answer: "AD" });
        const x = shuffleForDisplay(base, rng([0.9, 0.2, 0.7]));
        const texts = [...(x.optionMd ?? [])];
        const want = [...(x.answer ?? "")].map((ch) => texts["ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(ch)]);
        expect(want.sort()).toEqual(["甲", "丁"].sort());
    });

    it("位置敏感措辞组不洗（引用原对象）", () => {
        const base = q({ optionMd: ["甲", "乙", "以上都对"], answer: "A" });
        expect(shuffleForDisplay(base, rng([0.9, 0.1, 0.5]))).toBe(base);
    });

    it("选项不足 2 个 / 非选择题型：原样返回", () => {
        expect(shuffleForDisplay(q({ optionMd: ["甲"], answer: "A" }))).toEqual(q({ optionMd: ["甲"], answer: "A" }));
        const judge = q({ type: QuestionType.Judge, answer: "√" });
        expect(shuffleForDisplay(judge)).toBe(judge);
    });

    it("cloze/match 不洗（逐空答案与候选池顺序强耦合）", () => {
        const cloze = q({ type: QuestionType.Cloze, optionMd: ["甲", "乙"], answer: "A" });
        expect(shuffleForDisplay(cloze)).toBe(cloze);
    });
});

describe("shuffleForDisplay · steps 各步独立", () => {
    it("每步各自洗、各自重写 step-ans（原位不串）", () => {
        const base = q({
            type: QuestionType.Steps,
            steps: [
                { kind: "method", stemMd: "第一步", optionMd: ["甲", "乙"], answer: "A" },
                { kind: "result", stemMd: "第二步", optionMd: ["丙", "丁"], answer: "B" },
            ],
        });
        // 0.1 < 0.5 ⇒ 两步都取「交换」（n=2 时 j=0）
        const x = shuffleForDisplay(base, rng([0.1, 0.1]));
        expect(x).not.toBe(base);
        expect(x.steps![0]).not.toBe(base.steps![0]);
        expect(x.steps![1]).not.toBe(base.steps![1]);
        expect(x.steps).toHaveLength(2);
        const stepTexts = (k: number): string[] => x.steps![k].optionMd;
        const at = (k: number): string =>
            stepTexts(k)["ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(x.steps![k].answer.toUpperCase())];
        expect(at(0)).toBe("甲"); // 第一步答案仍指向「甲」
        expect(at(1)).toBe("丁"); // 第二步答案仍指向「丁」
        expect([...stepTexts(0)].sort()).toEqual(["乙", "甲"].sort());
        expect([...stepTexts(1)].sort()).toEqual(["丁", "丙"].sort());
    });

    it("某步位置敏感：该步不洗，另一步照洗", () => {
        const base = q({
            type: QuestionType.Steps,
            steps: [
                { kind: "method", stemMd: "第一步", optionMd: ["甲", "以上都对"], answer: "A" },
                { kind: "result", stemMd: "第二步", optionMd: ["丙", "丁"], answer: "B" },
            ],
        });
        const x = shuffleForDisplay(base, rng([0.1]));
        expect(x.steps![0]).toBe(base.steps![0]); // 位置敏感 ⇒ 原引用
        expect(x.steps![1]).not.toBe(base.steps![1]);
    });
});

describe("shuffleListForDisplay · 卷内顺序不变", () => {
    it("逐题换对象、id 顺序与数量逐字不变", () => {
        const list = [
            q({ id: "a", optionMd: ["甲", "乙"], answer: "A" }),
            q({ id: "b", type: QuestionType.Judge, answer: "√" }),
            q({ id: "c", optionMd: ["丙", "丁"], answer: "B" }),
        ];
        const out = shuffleListForDisplay(list, rng([0.9, 0.1]));
        expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
        expect(out[1]).toBe(list[1]); // 不可洗的题零改动
        expect(list[0].optionMd).toEqual(["甲", "乙"]); // 原件未被污染
    });
});

describe("isShufflable", () => {
    it("只有多选项的选择/多步题可洗", () => {
        expect(isShufflable(q({ optionMd: ["甲", "乙"] }))).toBe(true);
        expect(isShufflable(q({ optionMd: ["甲"] }))).toBe(false);
        expect(isShufflable(q({ type: QuestionType.Cloze, optionMd: ["甲", "乙"] }))).toBe(false);
        expect(
            isShufflable(
                q({
                    type: QuestionType.Steps,
                    steps: [{ kind: "result", stemMd: "s", optionMd: ["甲", "乙"], answer: "A" }],
                })
            )
        ).toBe(true);
    });
});
