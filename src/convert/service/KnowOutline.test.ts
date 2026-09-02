import { describe, expect, it } from "vitest";
import { parseOutlineNodes } from "./KnowOutline";
import { buildOutlinePrompt, chapterTextOf, extractOutlineMd } from "./KnowOutline";

describe("buildOutlinePrompt", () => {
    it("带层级约定与章节内容", () => {
        const p = buildOutlinePrompt("求极限的内容");
        expect(p).toContain("# 知识大类");
        expect(p).toContain("## 具体方法或解法");
        expect(p).toContain("求极限的内容");
    });
});

describe("extractOutlineMd", () => {
    it("剥代码围栏与首尾白话", () => {
        const reply = "好的，以下是大纲：\n```markdown\n# 求极限\n## 洛必达法则\n说明行\n```\n希望有帮助";
        expect(extractOutlineMd(reply)).toBe("# 求极限\n## 洛必达法则\n说明行");
    });
    it("无标题行抛错", () => {
        expect(() => extractOutlineMd("抱歉，我无法处理")).toThrow();
    });
    it("保留最后一个标题之后的说明行（同段）但剥尾后白话", () => {
        const md = extractOutlineMd("# 求极限\n## 夹逼准则\n条件说明\n\n以上就是大纲。");
        expect(md).toBe("# 求极限\n## 夹逼准则\n条件说明");
    });
});

describe("chapterTextOf", () => {
    it("预算内全量保留标题级别前缀", () => {
        const text = chapterTextOf(
            [
                { type: "h", subtype: "h2", content: "洛必达" },
                { type: "p", content: "条件" },
            ],
            1000
        );
        expect(text).toBe("## 洛必达\n\n条件");
    });

    it("超预算按标题段压缩且总长受控", () => {
        const rows: { type: string; subtype?: string; content: string }[] = [];
        for (let i = 0; i < 300; i++) {
            if (i % 3 === 0) rows.push({ type: "h", subtype: `h${(i % 6) + 1}`, content: `标题${i}` });
            else rows.push({ type: "p", content: `正文${i}，`.repeat(100) });
        }
        const text = chapterTextOf(rows, 6000);
        expect(text.length).toBeLessThan(7000);
        expect(text).toContain("…");
        expect(text).toContain("仅取前");
    });

    it("段数超上限截断并注明", () => {
        const many: { type: string; subtype?: string; content: string }[] = [];
        for (let i = 0; i < 200; i++) many.push({ type: "h", subtype: "h2", content: `节${i}` });
        const text = chapterTextOf(many, 1000);
        expect(text).toContain("仅取前");
    });

    it("整篇无标题按总长截断", () => {
        const text = chapterTextOf(
            [
                { type: "p", content: "长".repeat(3000) },
                { type: "p", content: "尾".repeat(100) },
            ],
            1000
        );
        expect(text.length).toBeLessThanOrEqual(1100);
        expect(text.startsWith("长")).toBe(true);
    });
});

describe("parseOutlineNodes", () => {
    it("标题层级+紧跟说明行成节点，非标题后续行并入上一节点说明（只收首个）", () => {
        const md = "# 求极限\n大类说明\n## 洛必达法则\n0/0 型适用\n### 适用条件\n## 夹逼准则";
        expect(parseOutlineNodes(md)).toEqual([
            { id: "", title: "求极限", level: 1, note: "大类说明" },
            { id: "", title: "洛必达法则", level: 2, note: "0/0 型适用" },
            { id: "", title: "适用条件", level: 3 },
            { id: "", title: "夹逼准则", level: 2 },
        ]);
    });

    it("超三级标题不入表；空标题滤除；无标题返回空", () => {
        expect(parseOutlineNodes("#### 太深\n# 一级").map((n) => n.title)).toEqual(["一级"]);
        expect(parseOutlineNodes("纯正文没有标题")).toEqual([]);
    });
});
