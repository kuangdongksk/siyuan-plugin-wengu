import { describe, expect, it } from "vitest";
import {
    gradeQuestion,
    gradeSlot,
    gradeStep,
    optionIsRight,
    slotOptionIsRight,
    stepOptionIsRight,
} from "./QuestionGrading";
import type { WenguQuestion } from "../../types";
import { QuestionType } from "../../types";

/**
 * 判分矩阵回归：刷题对错的唯一事实源，任何容错规则改动都应先过这里。
 * 字母答案按字母比；内容答案比选项内容（大小写/空白/$ 定界不敏感）；
 * fill 允许多答案分隔与「输字母=输选项内容」；judge 归一 √/× 两极。
 */

const q = (over: Partial<WenguQuestion>): WenguQuestion => ({
    id: "t",
    attempts: 0,
    wrongCount: 0,
    ...over,
});

describe("gradeQuestion · single", () => {
    const letterQ = q({ type: QuestionType.Single, answer: "B", optionMd: ["甲", "乙", "丙"] });
    it("字母答案大小写与空白不敏感", () => {
        expect(gradeQuestion(letterQ, "B")).toBe(true);
        expect(gradeQuestion(letterQ, "b")).toBe(true);
        expect(gradeQuestion(letterQ, " B ")).toBe(true);
        expect(gradeQuestion(letterQ, "C")).toBe(false);
        expect(gradeQuestion(letterQ, "")).toBe(false);
    });
    const contentQ = q({ type: QuestionType.Single, answer: "$e^2$", optionMd: ["$e^x$", "$e^2$", "$e^3$"] });
    it("内容答案：输字母按选项内容代入比对", () => {
        expect(gradeQuestion(contentQ, "B")).toBe(true);
        expect(gradeQuestion(contentQ, "A")).toBe(false);
    });
    it("内容答案：手输原文与 $ 定界等价", () => {
        expect(gradeQuestion(contentQ, "$e^2$")).toBe(true);
        expect(gradeQuestion(contentQ, "e2")).toBe(false);
    });
});

describe("gradeQuestion · multiple", () => {
    const letterQ = q({ type: QuestionType.Multiple, answer: "AB", optionMd: ["甲", "乙", "丙"] });
    it("字母答案：规范化后全等比对", () => {
        expect(gradeQuestion(letterQ, "AB")).toBe(true);
        expect(gradeQuestion(letterQ, "ab")).toBe(true);
        expect(gradeQuestion(letterQ, "A")).toBe(false);
        expect(gradeQuestion(letterQ, "ABC")).toBe(false);
    });
    const contentQ = q({ type: QuestionType.Multiple, answer: "$a$、$b$", optionMd: ["$a$", "$b$", "$c$"] });
    it("内容答案：所选项内容集合与答案集合比对（顺序无关）", () => {
        expect(gradeQuestion(contentQ, "BA")).toBe(true);
        expect(gradeQuestion(contentQ, "AB")).toBe(true);
        expect(gradeQuestion(contentQ, "AC")).toBe(false);
    });
});

describe("gradeQuestion · judge", () => {
    const rightQ = q({ type: QuestionType.Judge, answer: "√" });
    const wrongQ = q({ type: QuestionType.Judge, answer: "×" });
    it("√/对/T/TRUE 同义归一", () => {
        for (const s of ["√", "对", "T", "TRUE", "true"]) expect(gradeQuestion(rightQ, s)).toBe(true);
        for (const s of ["×", "错", "F", "FALSE", "false", "X"]) expect(gradeQuestion(rightQ, s)).toBe(false);
    });
    it("×/错/F/FALSE 同义归一", () => {
        for (const s of ["×", "x", "错", "F", "FALSE"]) expect(gradeQuestion(wrongQ, s)).toBe(true);
        expect(gradeQuestion(wrongQ, "√")).toBe(false);
    });
});

describe("gradeQuestion · fill", () => {
    const multiQ = q({ type: QuestionType.Fill, answer: "1|2" });
    it("多答案任一命中即对", () => {
        expect(gradeQuestion(multiQ, "2")).toBe(true);
        expect(gradeQuestion(multiQ, " 1 ")).toBe(true);
        expect(gradeQuestion(multiQ, "3")).toBe(false);
    });
    const optQ = q({ type: QuestionType.Fill, answer: "2", optionMd: ["$\\pi$", "2"] });
    it("带选项的填空：输字母等价于输选项内容", () => {
        expect(gradeQuestion(optQ, "B")).toBe(true);
        expect(gradeQuestion(optQ, "A")).toBe(false);
    });
    it("未知题型一律判错", () => {
        expect(gradeQuestion(q({ type: undefined, answer: "A" }), "A")).toBe(false);
    });
});

describe("gradeStep · 多步判分", () => {
    it("method 步：可行集合任一命中即对", () => {
        const step = {
            kind: "method" as const,
            stemMd: "",
            optionMd: ["洛必达", "等价", "泰勒", "夹逼"],
            answer: "ABD",
        };
        expect(gradeStep(step, "D")).toBe(true);
        expect(gradeStep(step, "C")).toBe(false);
    });
    it("result 步：字母全等；内容答案代选项内容", () => {
        const letter = { kind: "result" as const, stemMd: "", optionMd: ["1", "0"], answer: "B" };
        expect(gradeStep(letter, "B")).toBe(true);
        expect(gradeStep(letter, "A")).toBe(false);
        const content = { kind: "result" as const, stemMd: "", optionMd: ["$\\frac{1}{2}$", "0.5"], answer: "0.5" };
        expect(gradeStep(content, "B")).toBe(true);
        expect(gradeStep(content, "A")).toBe(false);
    });
    it("stepOptionIsRight：字母集合命中即正确项", () => {
        const step = { kind: "method" as const, stemMd: "", optionMd: ["a", "b", "c"], answer: "AC" };
        expect(stepOptionIsRight(step, 0)).toBe(true);
        expect(stepOptionIsRight(step, 1)).toBe(false);
        expect(stepOptionIsRight(step, 2)).toBe(true);
    });
});

describe("gradeSlot · 逐空判分", () => {
    it("字母与内容两种口径", () => {
        const letter = { optionMd: ["甲", "乙"], answer: "B" };
        expect(gradeSlot(letter, "B")).toBe(true);
        expect(gradeSlot(letter, "A")).toBe(false);
        const content = { optionMd: ["$\\frac{1}{2}$", "0.5"], answer: "0.5" };
        expect(gradeSlot(content, "B")).toBe(true);
    });
    it("slotOptionIsRight：字母/内容两模式", () => {
        const letter = { optionMd: ["甲", "乙"], answer: "B" };
        expect(slotOptionIsRight(letter, 1)).toBe(true);
        expect(slotOptionIsRight(letter, 0)).toBe(false);
        const content = { optionMd: ["$e^x$", "$e^2$"], answer: "$e^2$" };
        expect(slotOptionIsRight(content, 1)).toBe(true);
        expect(slotOptionIsRight(content, 0)).toBe(false);
    });
});

describe("optionIsRight · 描色判断", () => {
    it("字母答案模式", () => {
        const qq = q({ type: QuestionType.Multiple, answer: "AC", optionMd: ["甲", "乙", "丙"] });
        expect(optionIsRight(qq, 0)).toBe(true);
        expect(optionIsRight(qq, 1)).toBe(false);
        expect(optionIsRight(qq, 2)).toBe(true);
    });
    it("内容答案模式（含 $ 定界）", () => {
        const qq = q({ type: QuestionType.Single, answer: "$e^2$", optionMd: ["$e^x$", "$e^2$"] });
        expect(optionIsRight(qq, 1)).toBe(true);
        expect(optionIsRight(qq, 0)).toBe(false);
    });
});
