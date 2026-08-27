import { describe, expect, it } from "vitest";
import { groupKnowByDoc } from "./KnowledgePanel";

describe("groupKnowByDoc", () => {
    const refs = new Map([
        ["kp1", "函数的单调性"],
        ["kp2", "导数与切线"],
        ["kp3", "文言虚词"],
    ]);
    const roots = new Map([
        ["kp1", "docMath"],
        ["kp2", "docMath"],
        ["kp3", "docChinese"],
    ]);
    const kidx = [
        { key: "kp:kp1", title: "函数的单调性", count: 12 },
        { key: "kp:kp2", title: "导数与切线", count: 7 },
        { key: "kp:kp3", title: "文言虚词", count: 3 },
    ];

    it("按根文档分组，文档与小节都按题数降序", () => {
        const docs = groupKnowByDoc(
            refs,
            roots,
            kidx,
            new Map([
                ["docMath", "数学讲义"],
                ["docChinese", "语文读本"],
            ])
        );
        expect(docs.length).toBe(2);
        expect(docs[0].docId).toBe("docMath");
        expect(docs[0].title).toBe("数学讲义");
        expect(docs[0].total).toBe(19);
        expect(docs[0].sections[0].title).toBe("函数的单调性");
        expect(docs[0].sections[1].count).toBe(7);
        expect(docs[1].docId).toBe("docChinese");
        expect(docs[1].sections.length).toBe(1);
    });

    it("悬空引用不计入；缺索引的键按至少 1 题兜底；标题缺失用 id", () => {
        const noRoot = groupKnowByDoc(new Map([["kpx", "孤节"]]), new Map(), kidx, new Map());
        expect(noRoot.length).toBe(0); // 无根映射 → 不计入
        const bare = groupKnowByDoc(new Map([["kpz", "新节"]]), new Map([["kpz", "doc9"]]), [], new Map());
        expect(bare[0].docId).toBe("doc9");
        expect(bare[0].title).toBe("doc9"); // 标题缺失用 id 兜底
        expect(bare[0].sections[0].count).toBe(1); // 缺索引键兜底 1
    });

    it("空题库 → 空清单", () => {
        expect(groupKnowByDoc(new Map(), new Map(), [], new Map())).toEqual([]);
    });
});
