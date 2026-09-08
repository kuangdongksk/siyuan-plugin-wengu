import { describe, expect, it } from "vitest";
import type { BankData, QuestionBank } from "./QuestionBank";
import { QuestionBank as Bank } from "./QuestionBank";
import {
    internalRootMap,
    knowNodeText,
    knowTreeByNode,
    mintKnowNodeId,
    setKnowTree,
    stripChapterEcho,
    treePathsOf,
} from "./KnowTrees";
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

describe("stripChapterEcho 章节名回声剔除（20260908 真机：AI 常把章节名写成首个 h1）", () => {
    it("数字编号章节「1-行列式」的头部 h1「行列式」剔除，余下节点原样", () => {
        const nodes = [
            { id: "e", title: "行列式", level: 1 },
            { id: "n1", title: "行列式的概念与构造", level: 2 },
            { id: "n2", title: "三阶行列式与对角线法", level: 3 },
        ] as never[];
        const out = stripChapterEcho(nodes, "1-行列式");
        expect(out.map((n) => n.id)).toEqual(["n1", "n2"]);
    });

    it("中文数字编号「四、分块矩阵」与「第2章 极限」同样归一命中", () => {
        expect(stripChapterEcho([{ id: "e", title: "分块矩阵", level: 1 }] as never[], "四、分块矩阵")).toEqual([]);
        expect(stripChapterEcho([{ id: "e", title: "极限", level: 1 }] as never[], "第2章 极限")).toEqual([]);
    });

    it("「一维随机变量」类标题不被误剥（中文数字必须带分隔符）", () => {
        const nodes = [
            { id: "n1", title: "一维随机变量及其分布", level: 1 },
            { id: "n2", title: "分布函数", level: 2 },
        ] as never[];
        // 章节名就是它（AI 原样回声）→ 剔
        expect(stripChapterEcho(nodes, "2-一维随机变量及其分布").map((n) => n.id)).toEqual(["n2"]);
        // 章节名不同 → 首节点「一维…」的「一」不是编号，不剔
        expect(stripChapterEcho(nodes, "3-多维随机变量").map((n) => n.id)).toEqual(["n1", "n2"]);
    });

    it("无回声/回声不在头部 level-1/章节名空 → 原样返回", () => {
        const nodes = [
            { id: "n1", title: "行列式的概念与构造", level: 1 },
            { id: "n2", title: "行列式", level: 2 },
        ] as never[];
        expect(stripChapterEcho(nodes, "1-行列式")).toBe(nodes); // 头部非回声（标题不同）
        expect(stripChapterEcho(nodes, "")).toBe(nodes); // 无章节名=不剔
        const echoAt2 = [
            { id: "n1", title: "其他大类", level: 1 },
            { id: "e", title: "行列式", level: 2 },
        ] as never[];
        expect(stripChapterEcho(echoAt2, "1-行列式").map((n) => n.id)).toEqual(["n1", "e"]); // level-2 回声不剔
    });

    it("连续回声全剔（AI 重复输出章节名两次）", () => {
        const nodes = [
            { id: "e1", title: "行列式", level: 1 },
            { id: "e2", title: "1-行列式", level: 1 },
            { id: "n1", title: "基本性质", level: 2 },
        ] as never[];
        expect(stripChapterEcho(nodes, "1-行列式").map((n) => n.id)).toEqual(["n1"]);
    });

    it("重索引路径对齐：带回声旧树与剔后新树 treePathsOf 键一致（id 可复用）", () => {
        const oldNodes = [
            { id: "keep1", title: "行列式", level: 1 },
            { id: "keep2", title: "基本性质", level: 2 },
            { id: "keep3", title: "转置不变", level: 3 },
        ] as never[];
        const fresh = stripChapterEcho(
            [
                { id: "", title: "行列式", level: 1 },
                { id: "", title: "基本性质", level: 2 },
                { id: "", title: "转置不变", level: 3 },
            ] as never[],
            "1-行列式"
        );
        expect([...treePathsOf(stripChapterEcho(oldNodes, "1-行列式")).keys()]).toEqual([...treePathsOf(fresh).keys()]);
    });
});
