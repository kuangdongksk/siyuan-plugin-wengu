import { describe, expect, it } from "vitest";
import { buildSectionTree, classifyMatchFail, routeKnowledgeDiag, type KnowledgeIndex } from "./KnowledgeLink";
import { injectKnowledgeRefs, stripKnowledgeRefs } from "./KnowRef";

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

/** 造 N 章索引：path=「章i」，sections 各挂两小节（路由两级都用得到）。 */
function makeIndex(n: number): KnowledgeIndex {
    const chapters = [];
    for (let i = 1; i <= n; i++) {
        chapters.push({
            docId: `doc${i}`,
            title: `章${i}`,
            path: `章${i}`,
            sections: [
                { id: `s${i}a`, title: `节${i}甲`, path: `章${i}/节${i}甲` },
                { id: `s${i}b`, title: `节${i}乙`, path: `章${i}/节${i}乙` },
            ],
        });
    }
    return { chapters };
}

describe("routeKnowledgeDiag 编号解析（20260831 修复：多位编号不再被拆散）", () => {
    it("JSON 章选择：编号 ≥10 按整体取值，不拆成单个数字", async () => {
        // 12 章索引下 AI 选 12 号章；旧实现 matchAll(/\d+/) 会拆成 1、2 选错章
        const index = makeIndex(12);
        const seen: string[] = [];
        const out = await routeKnowledgeDiag("题目原文", index, {
            call: async (msg) => {
                seen.push(msg);
                if (msg.includes("章节清单")) return '{"chapters":[12]}';
                return '{"sections":[1]}';
            },
        });
        // 第二级收到的小节清单必须来自第 12 章（path 含「章12」）
        expect(seen[1]).toContain("章12/节12甲");
        expect(seen[1]).not.toContain("章1/节1甲");
        expect([...out.values()].map((s) => s.id)).toEqual(["s12a"]);
    });

    it("JSON 带解释文字/越界编号：只收数组内的合法编号", async () => {
        const index = makeIndex(3);
        const out = await routeKnowledgeDiag("题目原文", index, {
            call: async (msg) => {
                if (msg.includes("章节清单")) return '分析后认为 {"chapters":[2, 99]} 完毕';
                return '{"sections":[2]}';
            },
        });
        // 99 越界丢弃；第二级只在第 2 章小节里选
        expect([...out.values()].map((s) => s.id)).toEqual(["s2b"]);
    });

    it("裸数字兜底（AI 没按约定输出 JSON）：完整数字仍可取", async () => {
        const index = makeIndex(5);
        const out = await routeKnowledgeDiag("题目原文", index, {
            call: async (msg) => {
                if (msg.includes("章节清单")) return "3";
                return "2";
            },
        });
        expect([...out.values()].map((s) => s.id)).toEqual(["s3b"]);
    });

    it("空选择：chapters 为空 → 不调第二级，返回空映射", async () => {
        const index = makeIndex(4);
        let calls = 0;
        const out = await routeKnowledgeDiag("题目原文", index, {
            call: async () => {
                calls++;
                return '{"chapters":[]}';
            },
        });
        expect(calls).toBe(1);
        expect(out.size).toBe(0);
    });

    it("单章索引跳过第一级：直接进小节选择", async () => {
        const index = makeIndex(1);
        const seen: string[] = [];
        const out = await routeKnowledgeDiag("题目原文", index, {
            call: async (msg) => {
                seen.push(msg);
                return '{"sections":[2]}';
            },
        });
        expect(seen).toHaveLength(1);
        expect(seen[0]).toContain("知识点小节清单");
        expect([...out.values()].map((s) => s.id)).toEqual(["s1b"]);
    });
});
