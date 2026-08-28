import { describe, expect, it } from "vitest";
import { injectKnowledgeRefs, stripKnowledgeRefs } from "./KnowledgeLink";

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
