import { describe, expect, it } from "vitest";
import { matchIndices, questionMatches } from "./PreviewSearch";
import type { WenguQuestion, WenguSlot, WenguStep } from "../../types";

const q = (over: Partial<WenguQuestion>): WenguQuestion => ({ id: "x", attempts: 0, wrongCount: 0, ...over });

const step: WenguStep = { kind: "result", stemMd: "第一步求导", optionMd: ["正切", "余切"], answer: "A" };
const slot: WenguSlot = { optionMd: ["单调递增", "单调递减"], answer: "B" };

describe("questionMatches", () => {
    it("空词/纯空白全命中", () => {
        expect(questionMatches(q({}), "")).toBe(true);
        expect(questionMatches(q({}), "  ")).toBe(true);
    });

    it("题干/选项/答案/解析/知识点/章节都进搜索域", () => {
        const base = q({
            stemMd: "求极限",
            optionMd: ["洛必达法则", "泰勒展开"],
            answer: "A",
            solutionMd: "用洛必达",
            knowledge: "极限",
            chapter: "第一章 函数与极限",
        });
        expect(questionMatches(base, "洛必达")).toBe(true);
        expect(questionMatches(base, "泰勒")).toBe(true);
        expect(questionMatches(base, "用洛必达")).toBe(true);
        expect(questionMatches(base, "函数与极限")).toBe(true);
        expect(questionMatches(base, "微分中值")).toBe(false);
    });

    it("英文大小写不敏感", () => {
        expect(questionMatches(q({ stemMd: "Find the Limit of f(x)" }), "limit")).toBe(true);
        expect(questionMatches(q({ stemMd: "find the limit" }), "LIMIT")).toBe(true);
    });

    it("LaTeX 源码可搜（原始 markdown 口径）", () => {
        expect(questionMatches(q({ stemMd: "计算 $\\int_0^1 x^2 dx$" }), "\\int_0^1")).toBe(true);
    });

    it("多步与多空的子字段也进搜索域", () => {
        const multi = q({ steps: [step], slots: [slot] });
        expect(questionMatches(multi, "第一步")).toBe(true);
        expect(questionMatches(multi, "余切")).toBe(true);
        expect(questionMatches(multi, "单调递减")).toBe(true);
        expect(questionMatches(multi, "单调递增")).toBe(true);
    });
});

describe("matchIndices", () => {
    it("返回命中下标（与整卷题号对齐）", () => {
        const list = [q({ stemMd: "极限" }), q({ stemMd: "积分" }), q({ stemMd: "极限应用" })];
        expect(matchIndices(list, "极限")).toEqual([0, 2]);
        expect(matchIndices(list, "矩阵")).toEqual([]);
        expect(matchIndices(list, "")).toEqual([0, 1, 2]);
    });
});
