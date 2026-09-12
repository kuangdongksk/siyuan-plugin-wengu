import { afterEach, describe, expect, it, vi } from "vitest";
import {
    KnowIndexStore,
    emptyKnowIndex,
    leafDocsOf,
    nestHeads,
    captureRoot,
    type KnowIndexData,
    type KnowIndexRoot,
} from "./KnowIndex";
import { notifyError } from "../../ui/Notify";

/**
 * 知识索引快照店（Issue #39）：版本闩拒写、懒捕获单飞、嵌套形态、根级
 * 摊平与叶子判定。内核查询走替身（`KernelQuery` mock），捕获的确定性
 * 部分（nestHeads 就近挂靠）与 KnowledgeLink 的建树口径对齐。
 */

vi.mock("../../ui/Notify", () => ({ notifyError: vi.fn() }));

/** rowsMapAll 的替身返回值（按 SQL 关键词分派）。 */
const hp = vi.hoisted(() => ({
    rootRow: undefined as Map<string, string> | undefined,
    childRows: [] as Map<string, string>[],
    headRows: [] as Map<string, string>[],
    calls: 0,
}));

vi.mock("../../siyuan/query", () => ({
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

vi.mock("../../siyuan/block", () => ({
    KernelBlock: { docOrder: vi.fn(async () => new Map<string, number>()) },
    byDocOrder: (rows: unknown[]) => rows,
}));

const row = (o: Record<string, string>): Map<string, string> => new Map(Object.entries(o));

/** 内存存根店（loadRaw/saveRaw 收发同一份 JSON）。 */
function newStore(initial?: unknown): { store: KnowIndexStore; saved: () => unknown } {
    let cache: unknown = initial;
    const store = new KnowIndexStore(
        async () => cache,
        async (v) => {
            cache = JSON.parse(JSON.stringify(v)) as unknown;
        }
    );
    return { store, saved: () => cache };
}

const rootOf = (docs: { docId: string; title: string; hPath: string }[]): KnowIndexRoot => ({
    capturedAt: 1,
    docs: docs.map((d) => ({ ...d, children: [] as KnowIndexRoot["docs"][number]["children"] })),
});

describe("nestHeads（捕获建树：与 bankNodesToTree 同口径）", () => {
    it("就近挂靠 + 同级并列 + 跳级收编", () => {
        const tree = nestHeads([
            { id: "1", title: "极限", level: 1 },
            { id: "2", title: "极限计算", level: 2 },
            { id: "3", title: "洛必达", level: 3 },
            { id: "4", title: "泰勒", level: 3 },
            { id: "5", title: "导数", level: 2 },
            { id: "6", title: "跳级", level: 4 },
        ]);
        expect(tree.map((n) => n.id)).toEqual(["1"]);
        expect(tree[0].children.map((n) => n.id)).toEqual(["2", "5"]);
        expect(tree[0].children[0].children.map((n) => n.id)).toEqual(["3", "4"]);
        expect(tree[0].children[1].children[0].id).toBe("6"); // h2 直下 h4 收编为子级
    });

    it("空输入空树", () => {
        expect(nestHeads([])).toEqual([]);
    });
});

describe("leafDocsOf", () => {
    it("叶子文档=无后代文档；全为中间层时退首个文档", () => {
        const root = rootOf([
            { docId: "shelf", title: "书", hPath: "/书" },
            { docId: "ch1", title: "章一", hPath: "/书/章一" },
            { docId: "ch2", title: "章二", hPath: "/书/章二" },
        ]);
        expect(leafDocsOf(root).map((d) => d.docId)).toEqual(["ch1", "ch2"]);
        expect(leafDocsOf(rootOf([{ docId: "only", title: "单章", hPath: "/单章" }])).map((d) => d.docId)).toEqual([
            "only",
        ]);
    });
});

describe("版本闩（未来版本 → 内存空表 + 拒绝落盘）", () => {
    afterEach(() => vi.mocked(notifyError).mockClear());

    it("读到 version 2 时按空起步并通知", async () => {
        const { store } = newStore({ version: 2, roots: { r: rootOf([{ docId: "d", title: "t", hPath: "/t" }]) } });
        expect(await store.snapshot()).toEqual(emptyKnowIndex());
        expect(store.isForeign()).toBe(true);
        expect(vi.mocked(notifyError).mock.calls[0][0]).toEqual({
            key: "notifyStoreForeign",
            vars: { store: "know-index" },
        });
    });

    it("拒写：put 后不产生落盘", async () => {
        const { store, saved } = newStore({ version: 9, roots: {} });
        await store.put("r", rootOf([{ docId: "d", title: "t", hPath: "/t" }]));
        expect(saved()).toEqual({ version: 9, roots: {} }); // 盘上原样，未被覆写
    });

    it("读异常/形态不对归空表（纯派生可重建，不闩）", async () => {
        const { store } = newStore(null);
        expect(await store.snapshot()).toEqual(emptyKnowIndex());
        expect(store.isForeign()).toBe(false);
    });
});

describe("懒捕获与落库", () => {
    afterEach(() => {
        hp.rootRow = undefined;
        hp.childRows = [];
        hp.headRows = [];
        hp.calls = 0;
        vi.mocked(notifyError).mockClear();
    });

    it("缺根时现场捕获并落库，二次取走快照零内核调用", async () => {
        hp.rootRow = row({ id: "r", box: "nb", path: "/卷/书.sy", content: "书", hpath: "/卷/书" });
        hp.childRows = [row({ id: "d1", path: "/卷/书/章一.sy", content: "章一", hpath: "/卷/书/章一" })];
        hp.headRows = [
            row({ root_id: "r", id: "h-root", content: "卷标题", subtype: "h1" }),
            row({ root_id: "d1", id: "h1", content: "极限", subtype: "h1" }),
            row({ root_id: "d1", id: "h2", content: "洛必达", subtype: "h2" }),
        ];
        const { store, saved } = newStore();
        const first = await store.root("r");
        expect(first?.docs.map((d) => d.docId)).toEqual(["r", "d1"]);
        expect(first?.docs[1].children.map((n) => n.id)).toEqual(["h1"]);
        expect(first?.docs[1].children[0].children.map((n) => n.id)).toEqual(["h2"]); // 节点 id=真块 id
        const callsAfterCapture = hp.calls;
        expect(callsAfterCapture).toBeGreaterThan(0);
        // 二次取：命中快照，零内核调用
        const second = await store.root("r");
        expect(second).toEqual(first);
        expect(hp.calls).toBe(callsAfterCapture);
        expect((saved() as KnowIndexData).roots["r"].docs).toHaveLength(2);
    });

    it("并发取同一根只捕获一次（单飞）", async () => {
        hp.rootRow = row({ id: "r", box: "nb", path: "/卷/书.sy", content: "书", hpath: "/卷/书" });
        hp.childRows = [row({ id: "d1", path: "/卷/书/章一.sy", content: "章一", hpath: "/卷/书/章一" })];
        const { store, saved } = newStore();
        const [a, b] = await Promise.all([store.root("r"), store.root("r")]);
        expect(a).toEqual(b);
        expect(a?.docs.map((d) => d.docId)).toEqual(["r", "d1"]);
        // 单飞：只落了一次盘（两次并发捕获会各写一份，末位收尾语义不定）
        expect((saved() as KnowIndexData).roots["r"].docs.map((d) => d.docId)).toEqual(["r", "d1"]);
        const calls = hp.calls;
        await store.root("r"); // 命中内存，零内核
        expect(hp.calls).toBe(calls);
    });

    it("根查无 → null（不写空快照，调用方降级）", async () => {
        const { store, saved } = newStore();
        expect(await store.root("missing")).toBeNull();
        expect(saved()).toBeUndefined(); // 未落盘
        expect((await store.snapshot()).roots).toEqual({});
    });

    it("rescan 强制重捕获；drop 清账", async () => {
        hp.rootRow = row({ id: "r", box: "nb", path: "/卷/书.sy", content: "书", hpath: "/卷/书" });
        const { store } = newStore();
        await store.root("r");
        const before = hp.calls;
        await store.rescan("r");
        expect(hp.calls).toBeGreaterThan(before);
        await store.drop("r");
        expect((await store.snapshot()).roots).toEqual({});
    });

    it("findDoc 跨根找文档，未捕获的文档返回 null", async () => {
        hp.rootRow = row({ id: "r", box: "nb", path: "/卷/书.sy", content: "书", hpath: "/卷/书" });
        hp.childRows = [row({ id: "d1", path: "/卷/书/章一.sy", content: "章一", hpath: "/卷/书/章一" })];
        const { store } = newStore();
        expect(await store.findDoc("d1")).toBeNull(); // 尚未捕获
        await store.root("r");
        expect((await store.findDoc("d1"))?.docId).toBe("d1");
        const calls = hp.calls;
        await store.findDoc("d1"); // 命中内存，零内核
        expect(hp.calls).toBe(calls);
    });
});

describe("captureRoot 导出（捕获入口可独立调用）", () => {
    afterEach(() => {
        hp.rootRow = undefined;
        hp.childRows = [];
        hp.headRows = [];
    });

    it("根无效返回 null", async () => {
        expect(await captureRoot("nope")).toBeNull();
    });
});
