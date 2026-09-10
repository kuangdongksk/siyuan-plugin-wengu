import { describe, expect, it } from "vitest";
import { cutCandidates, headingLines, planShards } from "../source/ShardPlan";

/** 有标题结构的样本（3 个 h1 + 若干 h2）。 */
const DOC = [
    "# 第一章",
    "甲".repeat(200),
    "## 1.1 极限",
    "乙".repeat(200),
    "## 1.2 导数",
    "丙".repeat(200),
    "# 第二章",
    "丁".repeat(200),
    "## 2.1 积分",
    "戊".repeat(200),
    "# 第三章",
    "己".repeat(200),
].join("\n\n");

/** 无任何标题的整卷（分片必须退化，不能切题）。 */
const NO_HEAD = "甲乙丙丁".repeat(200);

/** 旧版落文档产物形态：无 markdown 标题，题以超级块行开头。 */
const SUPER_DOC = Array.from({ length: 12 }, (_, i) =>
    ["{{{row", `第 ${i + 1} 题题干 ${"甲".repeat(300)}`, "", "- A. 选项", "", "> 答案", ""].join("\n")
).join("\n");

/** 纯文本 / OCR 稿形态：无标题无超级块，只有题号行。 */
const PLAIN_DOC = Array.from({ length: 12 }, (_, i) =>
    [`${i + 1}. 第 ${i + 1} 题 ${"乙".repeat(300)}`, "答案：略", ""].join("\n")
).join("\n");

describe("planShards（分片规划）", () => {
    it("切点只落在标题行上", () => {
        const heads = new Set(headingLines(DOC).map((h) => h.offset));
        const shards = planShards(DOC, 3);
        expect(shards.length).toBe(3);
        for (const s of shards.slice(1)) expect(heads.has(s.start)).toBe(true);
    });

    it("片间连续覆盖全文（无重叠无缝隙）", () => {
        const shards = planShards(DOC, 4);
        expect(shards[0].start).toBe(0);
        expect(shards[shards.length - 1].end).toBe(DOC.length);
        for (let i = 1; i < shards.length; i++) expect(shards[i].start).toBe(shards[i - 1].end);
        for (const s of shards) expect(s.end).toBeGreaterThan(s.start);
    });

    it("片长尽量均分（不吞超长区段）", () => {
        const shards = planShards(DOC, 3);
        const lens = shards.map((s) => s.end - s.start);
        const min = Math.min(...lens);
        const max = Math.max(...lens);
        expect(max - min).toBeLessThan(DOC.length * 0.35);
    });

    it("无标题文档退化为单片（= 串行，零风险）", () => {
        expect(planShards(NO_HEAD, 8)).toEqual([{ start: 0, end: NO_HEAD.length, title: "", kind: "start" }]);
    });

    it("标题不足时自动减少片数（不硬切）", () => {
        const few = ["# 只有一章", "内容".repeat(300)].join("\n\n");
        expect(planShards(few, 8).length).toBe(1);
    });

    it("target=1 时单片（并发度 1 = 改造前行为）", () => {
        expect(planShards(DOC, 1).length).toBe(1);
    });

    it("片首标题取自片首位置的最近祖先标题", () => {
        const shards = planShards(DOC, 3);
        expect(shards[0].title).toBe("第一章");
        expect(shards[1].title.length).toBeGreaterThan(0);
    });

    it("from（续跑）：只规划剩余部分，第一片自 from 起", () => {
        const at = DOC.indexOf("## 2.1 积分");
        const shards = planShards(DOC, 3, at);
        expect(shards[0].start).toBe(at);
        expect(shards[shards.length - 1].end).toBe(DOC.length);
        for (let i = 1; i < shards.length; i++) expect(shards[i].start).toBe(shards[i - 1].end);
    });

    it("from 已在末尾时返回空（无处可分）", () => {
        expect(planShards(DOC, 3, DOC.length)).toEqual([]);
    });
});

describe("切点分级（应对千奇百怪的源格式）", () => {
    it("无标题的旧版产物：切在超级块行上（题起点，不切错）", () => {
        const shards = planShards(SUPER_DOC, 4);
        expect(shards.length).toBeGreaterThan(1);
        for (const s of shards.slice(1)) expect(SUPER_DOC.slice(s.start, s.start + 5)).toBe("{{{ro");
        expect(shards.slice(1).every((s) => s.kind === "marker")).toBe(true);
    });

    it("纯文本稿：切在题号行上", () => {
        const shards = planShards(PLAIN_DOC, 4);
        expect(shards.length).toBeGreaterThan(1);
        // 片 0 的 kind 恒为 "start"（文档/续跑起点），从片 1 起才是切点种类
        expect(shards.slice(1).every((s) => s.kind === "qnum")).toBe(true);
        for (const s of shards.slice(1)) expect(PLAIN_DOC.slice(s.start).split("\n")[0]).toMatch(/^\d+\. /);
    });

    it("有标题时不退而用更低级切点（质量优先于距离）", () => {
        const mixed = `${DOC}\n\n1. 正文里的编号行\n\n${"丙".repeat(200)}`;
        const heads = new Set(headingLines(mixed).map((h) => h.offset));
        for (const s of planShards(mixed, 2).slice(1)) expect(heads.has(s.start)).toBe(true);
    });

    it("HTML 标题行也算 heading（粘贴网页的常见形态）", () => {
        const html = Array.from({ length: 6 }, (_, i) => `<h2>第 ${i + 1} 节</h2>\n${"丁".repeat(300)}`).join("\n");
        const shards = planShards(html, 3);
        expect(shards.length).toBeGreaterThan(1);
        expect(shards.slice(1).every((s) => s.kind === "heading")).toBe(true);
    });

    it("只有弱边界（空行/段落）时不分片——切在题中间会漏题", () => {
        const para = `${"戊".repeat(300)}\n\n`.repeat(20);
        expect(planShards(para, 4)).toEqual([{ start: 0, end: para.length, title: "", kind: "start" }]);
    });

    it("cutCandidates 每行只归最高级别（标题不会被同时算成题号行）", () => {
        const md = "# 1. 第一章\n\n1. 题号行\n\n---\n\n{{{row\n";
        const kinds = cutCandidates(md).map((c) => c.kind);
        expect(kinds[0]).toBe("heading");
        expect(kinds).toContain("qnum");
        expect(kinds).toContain("marker");
    });

    it("cutCandidates 不产出弱边界（空行/任意行首不出现在候选里）", () => {
        const md = "正文一段\n\n正文二段\n\n正文三段\n";
        expect(cutCandidates(md)).toEqual([]);
    });
});
