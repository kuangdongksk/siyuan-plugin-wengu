import { beforeEach, describe, expect, it, vi } from "vitest";
import { KnowIndexStore, initKnowIndex, type KnowIndexRoot } from "../../../bank/data/KnowIndex";
import { buildKnowledgeIndex, expandKnowDocs } from "../knowledge/KnowledgeLink";
import type { KnowTreesMap } from "../../../bank/data/KnowTrees";

/**
 * 消费面切换（Issue #39 验收 1/2）：快照命中时 expandKnowDocs /
 * buildKnowledgeIndex 装载路径**零内核调用**；缺根时懒捕获并落库、
 * 嵌套形态与就近挂靠口径一致；快照节点 id = 源文档真实标题块 id、
 * doc 树序保持。
 *
 * 内核查询替身**带计数**：任何一次调用都让断言失败——这才叫「零内核」。
 */

const hp = vi.hoisted(() => ({
    rootRow: undefined as Map<string, string> | undefined,
    childRows: [] as Map<string, string>[],
    headRows: [] as Map<string, string>[],
    calls: 0,
}));

vi.mock("../../../siyuan/query", () => ({
    KernelQuery: {
        rowsMap: vi.fn(async () => {
            hp.calls++;
            return hp.rootRow ? [hp.rootRow] : [];
        }),
        rowsMapAll: vi.fn(async (sql: string) => {
            hp.calls++;
            return sql.includes("type = 'h'") ? hp.headRows : hp.childRows;
        }),
    },
}));

vi.mock("../../../siyuan/block", () => ({
    KernelBlock: { docOrder: vi.fn(async () => new Map<string, number>()) },
    byDocOrder: (rows: unknown[]) => rows,
}));

const row = (o: Record<string, string>): Map<string, string> => new Map(Object.entries(o));

/** 已捕获好的快照（模拟「存量登记根已有快照」）。 */
const ROOT_ID = "shelf";
const SNAPSHOT: KnowIndexRoot = {
    capturedAt: 1,
    docs: [
        {
            docId: "shelf",
            title: "概率论",
            hPath: "/概率论",
            children: [{ id: "h-shelf", title: "目录", children: [] }],
        },
        {
            docId: "ch1",
            title: "第一章 随机事件",
            hPath: "/概率论/第一章 随机事件",
            children: [
                {
                    id: "h-1",
                    title: "随机事件",
                    children: [{ id: "h-1-1", title: "样本空间", children: [] }],
                },
            ],
        },
        {
            docId: "ch2",
            title: "第二章 随机变量",
            hPath: "/概率论/第二章 随机变量",
            children: [{ id: "h-2", title: "分布函数", children: [] }],
        },
    ],
};

function initStore(roots: Record<string, KnowIndexRoot>): void {
    initKnowIndex({
        load: async () => ({ version: 1, roots: JSON.parse(JSON.stringify(roots)) }),
        save: async () => undefined,
    });
}

beforeEach(() => {
    hp.rootRow = undefined;
    hp.childRows = [];
    hp.headRows = [];
    hp.calls = 0;
});

describe("快照命中：装载零内核调用（验收 1）", () => {
    it("expandKnowDocs 只读快照，不碰 KernelQuery", async () => {
        initStore({ [ROOT_ID]: SNAPSHOT });
        const docs = await expandKnowDocs(ROOT_ID);
        expect(hp.calls).toBe(0);
        expect(docs.map((d) => d.docId)).toEqual(["shelf", "ch1", "ch2"]); // doc 树序保持（验收 2）
        expect(docs[1].hPath).toBe("/概率论/第一章 随机事件");
        expect(docs[1].sectionTree.map((n) => n.id)).toEqual(["h-1"]); // 节点 id=真块 id
        expect(docs[1].sectionTree[0].children[0].id).toBe("h-1-1");
        expect(docs[1].sections.map((s) => s.id)).toEqual(["h-1", "h-1-1"]);
    });

    it("buildKnowledgeIndex 只读快照，叶子文档进章集合", async () => {
        initStore({ [ROOT_ID]: SNAPSHOT });
        const index = await buildKnowledgeIndex([ROOT_ID]);
        expect(hp.calls).toBe(0);
        expect(index.chapters.map((c) => c.docId)).toEqual(["ch1", "ch2"]);
        expect(index.chapters[0].path).toBe("/概率论/第一章 随机事件");
        expect(index.chapters[0].sections.map((s) => s.path)).toEqual([
            "/概率论/第一章 随机事件/随机事件",
            "/概率论/第一章 随机事件/随机事件/样本空间",
        ]);
    });
});

describe("缺根：懒捕获并落库（验收 1）", () => {
    it("首次装载现场捕获、落盘，二次装载零内核", async () => {
        hp.rootRow = row({ id: ROOT_ID, box: "nb", path: "/卷/概率论.sy", content: "概率论", hpath: "/概率论" });
        hp.childRows = [row({ id: "ch1", path: "/卷/概率论/第一章.sy", content: "第一章", hpath: "/概率论/第一章" })];
        hp.headRows = [row({ root_id: "ch1", id: "h-1", content: "随机事件", subtype: "h1" })];
        let cache: unknown;
        const store = new KnowIndexStore(
            async () => cache,
            async (v) => {
                cache = JSON.parse(JSON.stringify(v));
            }
        );
        initKnowIndex({
            load: async () => cache,
            save: async (v) => {
                cache = v;
            },
        });
        const first = await expandKnowDocs(ROOT_ID);
        expect(hp.calls).toBeGreaterThan(0);
        expect(first.map((d) => d.docId)).toEqual([ROOT_ID, "ch1"]);
        expect((cache as { roots: Record<string, KnowIndexRoot> }).roots[ROOT_ID].docs).toHaveLength(2);
        const calls = hp.calls;
        await expandKnowDocs(ROOT_ID);
        expect(hp.calls).toBe(calls); // 已落库，二次零内核
        void store;
    });

    it("根查无 → 空数组（调用方按标题兜底），不误写空快照", async () => {
        initStore({});
        expect(await expandKnowDocs("missing")).toEqual([]);
        expect((await buildKnowledgeIndex(["missing"])).chapters).toEqual([]);
    });
});

describe("AI 树命中：整体替换快照小节（存量行为不变）", () => {
    it("trees[docId] 存在时该文档小节走树节点，其余仍走快照", async () => {
        initStore({ [ROOT_ID]: SNAPSHOT });
        const trees: KnowTreesMap = {
            ch1: {
                srcId: "ch1",
                outlineMd: "# 事件\n## 运算",
                nodes: [
                    { id: "20260901000000-aaaaaaa", title: "事件", level: 1 },
                    { id: "20260901000000-bbbbbbb", title: "运算", level: 2 },
                ],
                srcHash: "h",
                createdAt: 1,
            },
        };
        const docs = await expandKnowDocs(ROOT_ID, trees);
        expect(hp.calls).toBe(0);
        expect(docs[1].sectionTree.map((n) => n.id)).toEqual(["20260901000000-aaaaaaa"]);
        expect(docs[1].sectionTree[0].children.map((n) => n.id)).toEqual(["20260901000000-bbbbbbb"]);
        expect(docs[2].sectionTree.map((n) => n.id)).toEqual(["h-2"]); // 未命中树 → 快照
    });
});

describe("快照节点 id = 源文档真实标题块 id（验收 2）", () => {
    it("id 原样透传，不做任何改造（四条外键链兼容的前提）", async () => {
        initStore({ [ROOT_ID]: SNAPSHOT });
        const index = await buildKnowledgeIndex([ROOT_ID]);
        const ids = index.chapters.flatMap((c) => c.sections.map((s) => s.id));
        expect(ids).toEqual(["h-1", "h-1-1", "h-2"]);
    });
});
