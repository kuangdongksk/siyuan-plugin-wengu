import { describe, expect, it } from "vitest";
import {
    buildKnowTree,
    groupKnowByDoc,
    mergeKnowDocs,
    type KnowDocView,
    type KnowSectionTreeView,
} from "./KnowledgePanel";
import type { KnowSectionNode } from "../../convert/service/KnowledgeLink";

/** 题数扁平化（树 → "id:count" 清单，便于断言）。 */
function flatCounts(ns: KnowSectionTreeView[]): string[] {
    return ns.flatMap((n) => [`${n.id}:${n.count}`, ...flatCounts(n.children)]);
}

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

    it("按根文档分组，文档与顶层小节都按题数降序", () => {
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
        expect(docs[0].sectionTree[0].title).toBe("函数的单调性");
        expect(docs[0].sectionTree[1].count).toBe(7);
        expect(docs[1].docId).toBe("docChinese");
        expect(docs[1].sectionTree.length).toBe(1);
    });

    it("悬空引用不计入；缺索引的键按至少 1 题兜底；标题缺失用 id", () => {
        const noRoot = groupKnowByDoc(new Map([["kpx", "孤节"]]), new Map(), kidx, new Map());
        expect(noRoot.length).toBe(0); // 无根映射 → 不计入
        const bare = groupKnowByDoc(new Map([["kpz", "新节"]]), new Map([["kpz", "doc9"]]), [], new Map());
        expect(bare[0].docId).toBe("doc9");
        expect(bare[0].title).toBe("doc9"); // 标题缺失用 id 兜底
        expect(bare[0].sectionTree[0].count).toBe(1); // 缺索引键兜底 1
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
            sectionTree: [
                { id: "kp1", title: "函数的单调性", count: 12, children: [] },
                { id: "kp2", title: "导数与切线", count: 7, children: [] },
            ],
            total: 19,
        },
    ];

    it("纯导入文档追加为 0 题行并沉底（小节树原样保留嵌套）", () => {
        const tree: KnowSectionNode[] = [
            { id: "s1", title: "力学", children: [{ id: "s1a", title: "牛顿三定律", children: [] }] },
        ];
        const out = mergeKnowDocs(
            derived,
            [{ docId: "docPhys", title: "物理手册", sectionTree: tree }],
            new Set(["docPhys"]),
            new Set(["docPhys"])
        );
        expect(out).toHaveLength(2);
        expect(out[0].docId).toBe("docMath");
        expect(out[1]).toMatchObject({ docId: "docPhys", total: 0, manual: true, registered: true });
        expect(out[1].sectionTree[0].id).toBe("s1");
        expect(out[1].sectionTree[0].children[0].id).toBe("s1a");
        expect(out[1].sectionTree[0].count).toBe(0);
    });

    it("同文档合并：导入树为骨架，推导题数按 id 回填、树外推导节平层补尾", () => {
        const out = mergeKnowDocs(
            derived,
            [
                {
                    docId: "docMath",
                    title: "数学讲义",
                    sectionTree: [
                        {
                            id: "kp1",
                            title: "函数的单调性",
                            children: [{ id: "kp1a", title: "单调区间", children: [] }],
                        },
                        { id: "kp9", title: "中值定理", children: [] }, // 新节 → 0 题并入
                    ],
                },
            ],
            new Set(["docMath"]),
            new Set(["docMath"])
        );
        expect(out).toHaveLength(1);
        expect(out[0].manual).toBe(true);
        expect(out[0].total).toBe(19);
        // 骨架 = 导入层级树：kp1 带子节、kp9 平层；kp2 树外推导节补尾
        expect(flatCounts(out[0].sectionTree)).toEqual(["kp1:12", "kp1a:0", "kp9:0", "kp2:7"]);
    });

    it("未登记的推导行不带 manual 标记", () => {
        const out = mergeKnowDocs(derived, [], new Set(["docOther"]), new Set(["docOther"]));
        expect(out[0].manual).toBeUndefined();
    });

    it("递归展开：登记根的后代各自成行，manual 跟子树、registered 只跟根", () => {
        const out = mergeKnowDocs(
            derived,
            [
                { docId: "shelf", title: "书架", sectionTree: [] },
                {
                    docId: "bookA",
                    title: "书A",
                    sectionTree: [{ id: "s1", title: "章一", children: [] }],
                },
                { docId: "bookB", title: "书B", sectionTree: [] },
            ],
            new Set(["shelf", "bookA", "bookB"]),
            new Set(["shelf"])
        );
        expect(out).toHaveLength(4); // 1 推导 + 登记根 + 两个后代
        const byId = new Map(out.map((d) => [d.docId, d]));
        expect(byId.get("shelf")).toMatchObject({ manual: true, registered: true });
        expect(byId.get("bookA")).toMatchObject({ manual: true, registered: undefined });
        expect(byId.get("bookB")?.manual).toBe(true);
        expect(byId.get("bookA")?.sectionTree[0]).toEqual({ id: "s1", title: "章一", count: 0, children: [] });
    });
});

describe("buildKnowTree.subTotal", () => {
    /** 构造最小 KnowDocView（题数只关心 total）。 */
    const doc = (docId: string, title: string, total: number): KnowDocView => ({
        docId,
        title,
        sectionTree: [],
        total,
    });
    const findSub = (nodes: ReturnType<typeof buildKnowTree>, path: string): number | undefined =>
        nodes.find((n) => n.path === path)?.subTotal;

    it("父路径无文档、子文档有题：分支汇总子树题数", () => {
        // 「高数」自身无文档、无题；「高数/极限」有 5 题——父分支应显示 5
        const info = new Map([["docA", { title: "极限", hPath: "/高数/极限" }]]);
        const tree = buildKnowTree([doc("docA", "极限", 5)], info);
        expect(findSub(tree, "/高数")).toBe(5);
        expect(tree[0].children[0].subTotal).toBe(5); // 文档行自身
    });

    it("父文档自身有题且挂子文档：父文档行汇总自身+子树", () => {
        // 「高数」自己有 3 题，又是「高数/极限」(5 题) 的父路径——父文档行应显示 8
        const info = new Map([
            ["docP", { title: "高数", hPath: "/高数" }],
            ["docC", { title: "极限", hPath: "/高数/极限" }],
        ]);
        const tree = buildKnowTree([doc("docP", "高数", 3), doc("docC", "极限", 5)], info);
        const parent = tree.find((n) => n.path === "/高数")!;
        expect(parent.doc?.docId).toBe("docP");
        expect(parent.subTotal).toBe(8); // 自身 3 + 子 5
        expect(parent.children[0].subTotal).toBe(5);
    });

    it("多层嵌套自底向上累加：根=全部后代之和", () => {
        const info = new Map([
            ["a", { title: "a", hPath: "/书/章/节/a" }],
            ["b", { title: "b", hPath: "/书/章/b" }],
            ["c", { title: "c", hPath: "/书/c" }],
        ]);
        const tree = buildKnowTree([doc("a", "a", 1), doc("b", "b", 2), doc("c", "c", 4)], info);
        const book = tree.find((n) => n.path === "/书")!;
        expect(book.subTotal).toBe(7); // 1+2+4
        const chapter = book.children.find((n) => n.path === "/书/章")!;
        expect(chapter.subTotal).toBe(3); // 1+2
    });

    it("零题子树汇总为 0（trailing 据此不显示）", () => {
        const info = new Map([["x", { title: "x", hPath: "/父/x" }]]);
        const tree = buildKnowTree([doc("x", "x", 0)], info);
        expect(findSub(tree, "/父")).toBe(0);
    });
});
