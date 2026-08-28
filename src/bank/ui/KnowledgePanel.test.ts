import { describe, expect, it } from "vitest";
import { groupKnowByDoc, mergeKnowDocs, type KnowDocView } from "./KnowledgePanel";

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

describe("mergeKnowDocs", () => {
    const derived: KnowDocView[] = [
        {
            docId: "docMath",
            title: "数学讲义",
            sections: [
                { id: "kp1", title: "函数的单调性", count: 12 },
                { id: "kp2", title: "导数与切线", count: 7 },
            ],
            total: 19,
        },
    ];

    it("纯导入文档追加为 0 题行并沉底", () => {
        const out = mergeKnowDocs(
            derived,
            [{ docId: "docPhys", title: "物理手册", sections: [{ id: "s1", title: "力学" }] }],
            new Set(["docPhys"]),
            new Set(["docPhys"])
        );
        expect(out).toHaveLength(2);
        expect(out[0].docId).toBe("docMath");
        expect(out[1]).toMatchObject({ docId: "docPhys", total: 0, manual: true, registered: true });
        expect(out[1].sections[0]).toEqual({ id: "s1", title: "力学", count: 0 });
    });

    it("同文档合并：节并集去重、题数保留推导侧、manual 跟登记走", () => {
        const out = mergeKnowDocs(
            derived,
            [
                {
                    docId: "docMath",
                    title: "数学讲义",
                    sections: [
                        { id: "kp1", title: "函数的单调性" }, // 已有 → 去重
                        { id: "kp9", title: "中值定理" }, // 新节 → 0 题并入
                    ],
                },
            ],
            new Set(["docMath"]),
            new Set(["docMath"])
        );
        expect(out).toHaveLength(1);
        expect(out[0].manual).toBe(true);
        expect(out[0].total).toBe(19);
        expect(out[0].sections.map((s) => s.id)).toEqual(["kp1", "kp2", "kp9"]);
        expect(out[0].sections.find((s) => s.id === "kp1")?.count).toBe(12); // 推导题数不被 0 覆盖
        expect(out[0].sections.find((s) => s.id === "kp9")?.count).toBe(0);
    });

    it("未登记的推导行不带 manual 标记", () => {
        const out = mergeKnowDocs(derived, [], new Set(["docOther"]), new Set(["docOther"]));
        expect(out[0].manual).toBeUndefined();
    });

    it("递归展开：登记根的后代各自成行，manual 跟子树、registered 只跟根", () => {
        const out = mergeKnowDocs(
            derived,
            [
                { docId: "shelf", title: "书架", sections: [] },
                { docId: "bookA", title: "书A", sections: [{ id: "s1", title: "章一" }] },
                { docId: "bookB", title: "书B", sections: [] },
            ],
            new Set(["shelf", "bookA", "bookB"]),
            new Set(["shelf"])
        );
        expect(out).toHaveLength(4); // 1 推导 + 登记根 + 两个后代
        const byId = new Map(out.map((d) => [d.docId, d]));
        expect(byId.get("shelf")).toMatchObject({ manual: true, registered: true });
        expect(byId.get("bookA")).toMatchObject({ manual: true, registered: undefined });
        expect(byId.get("bookB")?.manual).toBe(true);
        expect(byId.get("bookA")?.sections[0]).toEqual({ id: "s1", title: "章一", count: 0 });
    });
});
