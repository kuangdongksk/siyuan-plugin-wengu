import { describe, expect, it } from "vitest";
import { buildOutlinePrompt } from "../../../ai/prompts/convert";
import { attachSrcIds, normHeadTitle, parseOutlineNodes } from "../knowledge/KnowOutline";
import { chapterTextOf, extractOutlineMd } from "../knowledge/KnowOutline";

describe("buildOutlinePrompt", () => {
    it("带层级约定与章节内容", () => {
        const p = buildOutlinePrompt("求极限的内容");
        expect(p).toContain("# 知识大类");
        expect(p).toContain("## 具体方法或解法");
        expect(p).toContain("求极限的内容");
    });
    it("锁判别规则：实质讲解门槛/名词罗列不立节点/禁宽泛学科名/做题价值", () => {
        const p = buildOutlinePrompt("x");
        expect(p).toContain("有实质讲解");
        expect(p).toContain("纯名词罗列");
        expect(p).toContain("至多合并成一个条目");
        expect(p).toContain("禁止起比本章更宽泛的学科名");
        expect(p).toContain("不出题的背景性、科普性内容不进树");
    });

    it("升级（Issue #39）：不收录题干/例题/空壳节 + 例题反哺切分（验收 3）", () => {
        const p = buildOutlinePrompt("x");
        // 不收录三类噪音
        expect(p).toContain("不收录的内容");
        expect(p).toContain("题号题干");
        expect(p).toContain("例题/示例/习题的标题");
        expect(p).toContain("空壳节");
        expect(p).toContain("综合题举例");
        expect(p).toContain("基础习题精练");
        // 例题反哺：读例题切得更细
        expect(p).toContain("例题反哺");
        expect(p).toContain("切得更细");
        // 层级约定与禁空标题的既有约束不因升级丢失
        expect(p).toContain("每个标题必须实义");
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

describe("attachSrcIds / normHeadTitle（Issue #39 节点源指针，验收 3）", () => {
    const heads = new Map<string, string>([
        [normHeadTitle("1.1 洛必达法则"), "h-lh"],
        [normHeadTitle("等价无穷小代换"), "h-dj"],
    ]);

    it("按归一标题挂上真实块 id；未命中留空（跳源降级）", () => {
        const nodes = parseOutlineNodes("# 洛必达法则\n## 夹逼准则\n### 等价无穷小代换");
        const hit = attachSrcIds(nodes, heads);
        expect(hit).toBe(2);
        expect(nodes[0].srcId).toBe("h-lh");
        expect(nodes[1].srcId).toBeUndefined();
        expect(nodes[2].srcId).toBe("h-dj");
    });

    it("归一剥编号/例题号/空白，大小写无关——AI 抄写走样也能认", () => {
        expect(normHeadTitle("1.1 洛必达法则")).toBe(normHeadTitle("洛必达法则"));
        expect(normHeadTitle("例 1.2 求极限")).toBe(normHeadTitle("求极限"));
        expect(normHeadTitle("第 2 章 极限")).toBe(normHeadTitle("极限"));
        expect(normHeadTitle("L'Hôpital")).toBe(normHeadTitle("l'hôpital"));
    });

    it("不挂任何指针时节点列表原样（缺省行为不变）", () => {
        const nodes = parseOutlineNodes("# 查无此项");
        expect(attachSrcIds(nodes, heads)).toBe(0);
        expect(nodes[0].srcId).toBeUndefined();
    });
});
