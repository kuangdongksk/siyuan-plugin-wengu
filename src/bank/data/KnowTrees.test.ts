import { describe, expect, it } from "vitest";
import type { BankData, QuestionBank } from "./QuestionBank";
import { QuestionBank as Bank } from "./QuestionBank";
import { internalRootMap, knowNodeText, knowTreeByNode, mintKnowNodeId, setKnowTree, treePathsOf } from "./KnowTrees";
import { parseKpRefs, parseQuestionKramdown } from "./BankParse";
import { renderUnit } from "../../convert/service/QuestionDraft";

/**
 * 内部知识树（20260903 起不落文档）：id 形态硬约束（kpRefs 经 kramdown
 * ((id "标题")) 往返）、路径复用、降级文本、反查映射。
 */

// node 测试环境无 window，markDirty 防抖定时器走 globalThis 顶上
(globalThis as { window?: unknown }).window ??= globalThis;

function newBank(): { bank: QuestionBank; data: () => BankData } {
    let cache: BankData | undefined;
    const bank = new Bank(
        async () =>
            (cache ??= {
                version: 1,
                records: {},
                collections: [],
                migratedDocs: [],
                hashed: {},
                knowRoots: [],
                folders: [],
                knowHidden: [],
                docStats: {},
                sets: {},
                materials: {},
                knowTrees: {},
            } as BankData),
        async (v) => {
            cache = v;
        }
    );
    return { bank, data: () => cache! };
}

describe("mintKnowNodeId", () => {
    it("内核块 id 形态（14 位时间戳-7 位）——parseKpRefs 正则可认", () => {
        const id = mintKnowNodeId();
        expect(id).toMatch(/^\d{14}-[a-z0-9]{7}$/);
        const line = `> 相关知识点：((20260827063055-fk64l1s "洛必达法则")) ((${id} "等价无穷小"))`;
        expect(parseKpRefs(line).map((k) => k.id)).toEqual(["20260827063055-fk64l1s", id]);
    });
    it("秒内连铸互异", () => {
        expect(mintKnowNodeId()).not.toBe(mintKnowNodeId());
    });
});

describe("treePathsOf / knowNodeText / internalRootMap", () => {
    const tree = {
        srcId: "src-doc-1",
        outlineMd: "",
        srcHash: "h1",
        createdAt: 1,
        nodes: [
            { id: "n1", title: "求极限", level: 1 as const },
            { id: "n2", title: "洛必达法则", level: 2 as const, note: "0/0 型适用" },
            { id: "n3", title: "适用条件", level: 3 as const },
            { id: "n4", title: "夹逼准则", level: 2 as const },
        ],
    };

    it("全路径按 level 栈式就近挂靠（与 buildSectionTree 口径一致）", () => {
        const paths = [...treePathsOf(tree.nodes).keys()];
        expect(paths).toEqual(["求极限", "求极限/洛必达法则", "求极限/洛必达法则/适用条件", "求极限/夹逼准则"]);
    });

    it("knowNodeText：说明行 + 子树标题（sectionKramdown 查空时的回落）", () => {
        const trees = { "src-doc-1": tree };
        expect(knowNodeText(trees, "n2")).toBe("0/0 型适用\n\n### 适用条件");
        expect(knowNodeText(trees, "n1")).toBe("## 洛必达法则\n\n### 适用条件\n\n## 夹逼准则");
        expect(knowNodeText(trees, "unknown")).toBe("");
    });

    it("knowTreeByNode / internalRootMap：节点 id 归到源文档", () => {
        const trees = { "src-doc-1": tree };
        expect(knowTreeByNode(trees, "n3")?.tree.srcId).toBe("src-doc-1");
        expect(internalRootMap(trees).get("n4")).toBe("src-doc-1");
    });
});

describe("setKnowTree", () => {
    it("写库（覆盖语义）并供 knowTreesOf 读回", async () => {
        const { bank, data } = newBank();
        await setKnowTree(bank, {
            srcId: "d1",
            outlineMd: "# A",
            nodes: [{ id: mintKnowNodeId(), title: "A", level: 1 }],
            srcHash: "hh",
            createdAt: 1,
        });
        expect(Object.keys(data().knowTrees ?? {})).toEqual(["d1"]);
    });
});

describe("树节点 kpRefs 的 kramdown 往返", () => {
    it("renderUnit 注入的节点引用可被完整收回（id 形态兼容 parseKpRefs）", () => {
        const id = mintKnowNodeId();
        const kd = renderUnit(
            {
                material: false,
                attrs: { type: "brief" },
                parts: [
                    { name: "stem", text: "题干" },
                    { name: "answer", text: "略" },
                    { name: "solution", text: "解析" },
                ],
                kpRefs: [{ id, title: "等价无穷小代换" }],
            },
            {}
        );
        const parsed = parseQuestionKramdown(kd, "q1", "s1");
        expect(parsed?.kpRefs).toEqual([{ id, title: "等价无穷小代换" }]);
    });
});

describe("treePathsOf · 同父同名兄弟消歧（20260903 审查 P2）", () => {
    it("同名兄弟按文档序 ~2/~3 消歧，先出节点不再被覆盖", () => {
        const nodes = [
            { id: "n1", level: 1, title: "章" },
            { id: "n2", level: 2, title: "小结" },
            { id: "n3", level: 2, title: "小结" },
            { id: "n4", level: 2, title: "小结" },
        ];
        const paths = treePathsOf(nodes as never[]);
        expect([...paths.keys()]).toEqual(["章", "章/小结", "章/小结~2", "章/小结~3"]);
        expect(paths.get("章/小结")?.id).toBe("n2");
        expect(paths.get("章/小结~2")?.id).toBe("n3");
        expect(paths.get("章/小结~3")?.id).toBe("n4");
    });
});
