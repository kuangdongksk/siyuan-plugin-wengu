import { describe, expect, it } from "vitest";
import { buildSectionTree, classifyMatchFail, injectKnowledgeRefs, stripKnowledgeRefs } from "./KnowledgeLink";

/** 带解析引述块的最小题目 kramdown（契约 §一：容器 + part IAL 行）。 */
const KD = `{{{row
{: custom-plugin-wengu-part="stem"}
题干内容

{: custom-plugin-wengu-part="answer"}
B

> 解析：因为如此。
> 相关知识点：((20260823120000-abc1234 "极限")) ((20260823120000-def5678 "洛必达"))
{: custom-plugin-wengu-part="solution"}
}}}
{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="choice"}`;

const REFS = [
    { id: "20260823120000-abc1234", title: "极限" },
    { id: "20260823120000-xyz9999", title: "泰勒展开" },
];

describe("stripKnowledgeRefs", () => {
    it("剥掉相关知识点行，保留解析与其余结构", () => {
        const out = stripKnowledgeRefs(KD);
        expect(out).not.toContain("相关知识点");
        expect(out).toContain("> 解析：因为如此。");
        expect(out).toContain('part="solution"');
        expect(out).toContain("}}}");
    });

    it("无知识点行的原文原样返回（幂等）", () => {
        const bare = stripKnowledgeRefs(KD);
        expect(stripKnowledgeRefs(bare)).toBe(bare);
    });
});

describe("strip + inject 配对（事后匹配的替换语义）", () => {
    it("剥旧注新：新引用集落进解析引述块尾", () => {
        const out = injectKnowledgeRefs(stripKnowledgeRefs(KD), REFS);
        expect(out).toContain('((20260823120000-abc1234 "极限"))');
        expect(out).toContain('((20260823120000-xyz9999 "泰勒展开"))');
        expect(out).not.toContain("洛必达"); // 旧引用被替换
        expect(out.indexOf("相关知识点")).toBeGreaterThan(out.indexOf("解析：因为如此"));
    });

    it("无注入点（无容器）原样返回不丢内容", () => {
        const raw = "普通文本没有容器";
        expect(injectKnowledgeRefs(raw, REFS)).toBe(raw);
    });
});

describe("strip + inject 幂等往返（20260828 审查：重跑匹配不得破坏结构）", () => {
    it("两次 strip+inject 输出逐字节相等——solution IAL 始终紧邻引述块", () => {
        const once = injectKnowledgeRefs(stripKnowledgeRefs(KD), REFS);
        const twice = injectKnowledgeRefs(stripKnowledgeRefs(once), REFS);
        expect(twice).toBe(once);
        // IAL 紧邻：引用行与 part="solution" 之间无空行
        const m = />\s*相关知识点：[^\n]*\n(?:\{:[^\n]*part="solution")/.exec(once);
        expect(m).not.toBeNull();
        // solution 块全卷唯一（旧 bug：strip 留空行→SOLUTION_RE 失配→
        // 兜底再补一个独立 solution 块，每次重跑叠一个）
        expect(once.match(/part="solution"/g)?.length).toBe(1);
    });

    it("已被旧 bug 污染（引用行与 IAL 间有空行）的记录重新匹配即自愈", () => {
        const dirty = KD.replace(/相关知识点：[^\n]*\n/, "相关知识点：旧引用\n\n");
        const healed = injectKnowledgeRefs(stripKnowledgeRefs(dirty), REFS);
        expect(healed.match(/part="solution"/g)?.length).toBe(1);
        expect(injectKnowledgeRefs(stripKnowledgeRefs(healed), REFS)).toBe(healed);
    });
});

describe("classifyMatchFail（20260829 匹配诊断：失败归类供状态栏提示）", () => {
    it("模型失效类（内核「请先参考用户指南」报文）归 model", () => {
        expect(classifyMatchFail("请先参考用户指南 [人工智能] 章节进行配置")).toBe("model");
        expect(classifyMatchFail("invalid model id")).toBe("model");
    });

    it("中断/超时类归 timeout", () => {
        expect(classifyMatchFail("AbortError: aborted")).toBe("timeout");
        expect(classifyMatchFail("request timeout")).toBe("timeout");
    });

    it("网络类归 network", () => {
        expect(classifyMatchFail("failed to fetch")).toBe("network");
        expect(classifyMatchFail("network error")).toBe("network");
    });

    it("其余归 other", () => {
        expect(classifyMatchFail("agent error")).toBe("other");
        expect(classifyMatchFail("")).toBe("other");
    });
});

describe("buildSectionTree（20260831 知识导入层级树）", () => {
    it("嵌套：低级标题挂到前方最近的高级标题下", () => {
        const tree = buildSectionTree([
            { id: "1", title: "极限", level: 1 },
            { id: "2", title: "极限计算", level: 2 },
            { id: "3", title: "0/0 与 ∞/∞", level: 3 },
            { id: "4", title: "洛必达法则", level: 4 },
        ]);
        expect(tree).toHaveLength(1);
        expect(tree[0].id).toBe("1");
        expect(tree[0].children[0].id).toBe("2");
        expect(tree[0].children[0].children[0].id).toBe("3");
        expect(tree[0].children[0].children[0].children[0].id).toBe("4");
    });

    it("同级并列：回到同级的标题开启新分支，不互相嵌套", () => {
        const tree = buildSectionTree([
            { id: "1", title: "极限", level: 1 },
            { id: "2", title: "极限计算", level: 2 },
            { id: "3", title: "洛必达", level: 3 },
            { id: "4", title: "泰勒展开", level: 3 },
            { id: "5", title: "导数", level: 1 },
        ]);
        expect(tree.map((n) => n.id)).toEqual(["1", "5"]);
        expect(tree[0].children[0].children.map((n) => n.id)).toEqual(["3", "4"]);
        expect(tree[1].children).toEqual([]);
    });

    it("跳级收编：h1 直下 h3 照常挂为子级（就近挂靠，与大纲一致）", () => {
        const tree = buildSectionTree([
            { id: "1", title: "极限", level: 1 },
            { id: "2", title: "洛必达", level: 3 },
        ]);
        expect(tree[0].children[0].id).toBe("2");
    });

    it("无更高级标题：h2 起头的文档平层挂根", () => {
        const tree = buildSectionTree([
            { id: "1", title: "绪论", level: 2 },
            { id: "2", title: "正文", level: 2 },
        ]);
        expect(tree.map((n) => n.id)).toEqual(["1", "2"]);
    });

    it("空文档 → 空树", () => {
        expect(buildSectionTree([])).toEqual([]);
    });
});
