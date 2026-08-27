import { describe, expect, it } from "vitest";
import { assembleQuestion, rowToQuestion, type AttrsRow, type ChildBlock } from "./QuestionService";
import { Attr } from "../../siyuan/attrs";
import { QuestionType } from "../../types";
import type { WenguQuestion } from "../../types";

/**
 * 文档模式装载的两块纯装配：属性行 → 题对象（rowToQuestion）、
 * 子块 × part → 题目字段（assembleQuestion，与题库侧 BankParse 语义
 * 一一对应，两路并存防漂移）。
 */

describe("rowToQuestion", () => {
    it("属性 JSON → 结构化题对象（type/difficulty/steps/运行时计数）", () => {
        const attrs = {
            [Attr.type]: "single",
            [Attr.difficulty]: "4",
            [Attr.attempts]: "7",
            [Attr.wrongCount]: "2",
            [Attr.steps]: "method|result",
            [Attr.lastAnswer]: "B",
        };
        const q = rowToQuestion({ block_id: "b1", root_id: "r1", attrs: JSON.stringify(attrs) } as AttrsRow);
        expect(q.type).toBe(QuestionType.Single);
        expect(q.difficulty).toBe(4);
        expect(q.attempts).toBe(7);
        expect(q.wrongCount).toBe(2);
        expect(q.lastAnswer).toBe("B");
        expect(q.steps?.map((s) => s.kind)).toEqual(["method", "result"]);
    });
    it("坏 JSON 容错为空属性，仅保留块定位", () => {
        const q = rowToQuestion({ block_id: "b1", root_id: "r1", attrs: "{oops" } as AttrsRow);
        expect(q.id).toBe("b1");
        expect(q.attempts).toBe(0);
        expect(q.type).toBeUndefined();
    });
});

describe("assembleQuestion", () => {
    it("stem/option/answer/solution 装配；多选项列表块拆分；题干标签产生回写对", () => {
        const q: WenguQuestion = { id: "q1", attempts: 0, wrongCount: 0 };
        const blocks: ChildBlock[] = [
            { id: "s1", markdown: "题干A：实际题干" },
            { id: "o1", markdown: "- A. 甲\n- B. 乙" },
            { id: "a1", markdown: "> B" },
            { id: "so1", markdown: "解析正文" },
        ];
        const partById = new Map([
            ["s1", "stem"],
            ["o1", "option-0"],
            ["a1", "answer"],
            ["so1", "solution"],
        ]);
        const rewrites = assembleQuestion(q, blocks, partById);
        expect(q.stemMd).toBe("实际题干");
        expect(q.optionMd).toEqual(["- A. 甲", "- B. 乙"]);
        expect(q.answer).toBe("B");
        expect(q.solutionMd).toBe("解析正文");
        // 「题干A：」残留要回写块本体
        expect(rewrites).toEqual([{ id: "s1", md: "实际题干" }]);
    });
    it("steps 子块按步聚合（kind 缺省 result 容错）", () => {
        const q: WenguQuestion = { id: "q2", attempts: 0, wrongCount: 0, type: QuestionType.Steps };
        const blocks: ChildBlock[] = [
            { id: "t0", markdown: "第 1 步" },
            { id: "t0o", markdown: "- 洛必达" },
            { id: "t0a", markdown: "> AB" },
            { id: "t1a", markdown: "> 0" },
        ];
        const partById = new Map([
            ["t0", "step-0-stem"],
            ["t0o", "step-0-option-0"],
            ["t0a", "step-0-answer"],
            ["t1a", "step-1-answer"],
        ]);
        assembleQuestion(q, blocks, partById);
        expect(q.steps).toHaveLength(2);
        expect(q.steps?.[0]).toMatchObject({ kind: "result", stemMd: "第 1 步", answer: "AB" });
        expect(q.steps?.[1]?.answer).toBe("0");
    });
    it("match 题无 slot 子块时按题级答案字母序列建槽（候选池=option 块）", () => {
        const q: WenguQuestion = { id: "q3", attempts: 0, wrongCount: 0, type: QuestionType.Match };
        const blocks: ChildBlock[] = [
            { id: "p1", markdown: "- 甲\n- 乙\n- 丙\n- 丁" },
            { id: "a1", markdown: "> D|A|G" },
        ];
        const partById = new Map([
            ["p1", "option-0"],
            ["a1", "answer"],
        ]);
        assembleQuestion(q, blocks, partById);
        expect(q.optionMd).toHaveLength(4);
        expect(q.slots?.map((s) => s.answer)).toEqual(["D", "A", "G"]);
        expect(q.slots?.every((s) => s.optionMd.length === 0)).toBe(true);
    });
    it("cloze 的 slot-k-* 子块按空聚合", () => {
        const q: WenguQuestion = { id: "q4", attempts: 0, wrongCount: 0, type: QuestionType.Cloze };
        const blocks: ChildBlock[] = [
            { id: "k0o", markdown: "- 甲\n- 乙" },
            { id: "k0a", markdown: "> B" },
        ];
        const partById = new Map([
            ["k0o", "slot-0-option-0"],
            ["k0a", "slot-0-answer"],
        ]);
        assembleQuestion(q, blocks, partById);
        expect(q.slots).toHaveLength(1);
        expect(q.slots?.[0].optionMd).toEqual(["- 甲", "- 乙"]);
        expect(q.slots?.[0].answer).toBe("B");
    });
});
