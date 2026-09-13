import { describe, expect, it } from "vitest";
import { relatedAnalysisPrompt, RELATED_LIST_MAX, RELATED_SECTION_CHARS } from "./related";
import type { RelatedRow } from "../../bank/data/RelatedData";

const row = (qid: string, attempts: number, wrongCount = 0): RelatedRow => ({
    qid,
    stem: `题干 ${qid}`,
    attempts,
    wrongCount,
    kpIds: [],
    weakKeys: [],
});

describe("relatedAnalysisPrompt（Issue #44 验收 6：三路材料齐 + 零作答如实说明）", () => {
    it("零作答数据：明确要求如实说明，禁止编造错题/错因/掌握度", () => {
        const p = relatedAnalysisPrompt({
            docTitle: "高等数学",
            section: "洛必达法则：0/0 型先求导再取极限。",
            rows: [row("q1", 0), row("q2", 0)],
            weak: [],
            hasData: false,
        });
        expect(p).toContain("尚无作答数据");
        expect(p).toContain("严禁编造");
        expect(p).toContain("1. 题干 q1（从未作答）");
    });

    it("有作答数据：不出现「尚无作答数据」警示，逐题带统计", () => {
        const p = relatedAnalysisPrompt({
            docTitle: "线代",
            section: "",
            rows: [row("q1", 3, 2), row("q2", 0)],
            weak: [{ title: "洛必达法则", wrong: 2, total: 3, topCause: "concept", aiNote: "概念混淆" }],
            hasData: true,
        });
        expect(p).not.toContain("严禁编造");
        expect(p).toContain("做过 3 次、错 2 次");
        expect(p).toContain("从未作答");
        expect(p).toContain("洛必达法则（错 2 / 做 3；主要错因：concept；批注：概念混淆）");
    });

    it("三段材料齐：文档名 + 题清单 + 小节正文 + 薄弱段", () => {
        const p = relatedAnalysisPrompt({
            docTitle: "极限",
            section: "夹逼定理的用法。",
            rows: [row("q1", 1)],
            weak: [{ title: "夹逼", wrong: 1, total: 1 }],
            hasData: true,
        });
        expect(p).toContain("【知识文档】极限");
        expect(p).toContain("【相关题清单（共 1 题）】");
        expect(p).toContain("【考点内容与解题方法】");
        expect(p).toContain("【薄弱点（来自历史作答沉淀）】");
    });

    it("薄弱段整段省略（零命中）——不出现空标题", () => {
        const p = relatedAnalysisPrompt({ docTitle: "d", section: "", rows: [row("q1", 0)], weak: [], hasData: false });
        expect(p).not.toContain("【薄弱点");
        expect(p).not.toContain("【考点内容与解题方法】");
    });

    it("零相关题：明说「暂无相关题」，不虚构题目", () => {
        const p = relatedAnalysisPrompt({ docTitle: "d", section: "s", rows: [], weak: [], hasData: false });
        expect(p).toContain("该文档**暂无相关题**");
        expect(p).toContain("（该文档暂无相关题）");
        expect(p).toContain("共 0 题");
        expect(p).not.toContain("尚无作答数据"); // 两条警示互斥（没题不谈作答）
    });

    it("题清单与小节正文都按预算截断", () => {
        const many = Array.from({ length: RELATED_LIST_MAX + 5 }, (_, i) => row(`q${i}`, 1));
        const p = relatedAnalysisPrompt({
            docTitle: "d",
            section: "x".repeat(RELATED_SECTION_CHARS + 500),
            rows: many,
            weak: [],
            hasData: true,
        });
        expect(p).toContain(`共 ${many.length} 题`);
        expect(p).toContain("1. 题干 q0");
        expect(p).toContain(`${RELATED_LIST_MAX}. 题干 q${RELATED_LIST_MAX - 1}`);
        expect(p).not.toContain(`${RELATED_LIST_MAX + 1}. 题干`);
        expect(p.includes("x".repeat(RELATED_SECTION_CHARS + 1))).toBe(false);
    });
});
