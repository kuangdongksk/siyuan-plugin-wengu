import { describe, expect, it } from "vitest";
import { assignHitsToNodes } from "./GlossDom";
import { planGlossLinks } from "../../convert/service/gloss/GlossEntry";

/**
 * 词形联动的**落格映射**（Issue #30 渲染侧）：偏移口径是「全部文本节点
 * 原文的拼接」，映射回「节点下标 + 节点内区间」。这段是纯函数（DOM 手术
 * 在 applyGloss 里）——同一节点内的多处命中必须全部落格，正向施工会把
 * 后一处推出已被截短的节点，故映射必须一次性算好再倒序施工。
 */

describe("assignHitsToNodes：拼接偏移 → 节点内区间", () => {
    it("同一节点内多处命中各自映射到正确区间", () => {
        const texts = ["Funding is crucial here."];
        const starts = [0];
        const hits = planGlossLinks(texts[0], [
            { word: "funding", phonetic: "", meaning: "" },
            { word: "crucial", phonetic: "", meaning: "" },
        ]);
        const slots = assignHitsToNodes(texts, starts, hits);
        expect(slots).toEqual([
            { node: 0, from: 0, to: 7 },
            { node: 0, from: 11, to: 18 },
        ]);
        // 倒序施工时，先切后段不影响前段偏移（区间互不重叠）
        expect(slots[0].to).toBeLessThanOrEqual(slots[1].from);
    });

    it("多节点：命中跨节点则放弃（node=-1），不越界硬切", () => {
        const texts = ["Funding ", "is crucial."];
        const starts = [0, 8];
        const hits = planGlossLinks(texts.join(""), [
            { word: "funding", phonetic: "", meaning: "" },
            { word: "crucial", phonetic: "", meaning: "" },
        ]);
        expect(assignHitsToNodes(texts, starts, hits)).toEqual([
            { node: 0, from: 0, to: 7 },
            { node: 1, from: 3, to: 10 },
        ]);
    });

    it("拼接文本里跨节点的命中（词被拆到两个节点）→ 放弃", () => {
        const texts = ["fund", "ing is key"];
        const starts = [0, 4];
        const hits = [{ start: 0, end: 7, order: 1, text: "funding" }];
        expect(assignHitsToNodes(texts, starts, hits)).toEqual([{ node: -1, from: 0, to: 0 }]);
    });

    it("空命中零动作", () => {
        expect(assignHitsToNodes(["a"], [0], [])).toEqual([]);
    });
});
