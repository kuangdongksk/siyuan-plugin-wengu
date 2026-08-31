import { beforeEach, describe, expect, it, vi } from "vitest";
import { KnowHashStore, sectionHashesOfDoc, type SecBlock } from "./KnowHash";
import { KernelQuery } from "../../siyuan/query";

/**
 * 知识小节内容哈希（自托管三期）：包含式切段纯函数 + 基线/漂移语义
 * （diff 后基线自推进=一次性提示）。KernelQuery 用 vi.mock 喂假块行。
 */

vi.mock("../../siyuan/query", () => ({
    KernelQuery: {
        rowsMapAll: vi.fn(async (): Promise<Map<string, string>[]> => []),
    },
}));

const rowsMapAll = vi.mocked(KernelQuery.rowsMapAll);

function h(id: string, level: number, content: string): SecBlock {
    return { id, type: "h", subtype: `h${level}`, content };
}
function p(id: string, content: string): SecBlock {
    return { id, type: "p", content };
}

const doc = [
    h("h1a", 1, "第一章"),
    h("h2a", 2, "第一节"),
    p("p1", "内容一"),
    h("h2b", 2, "第二节"),
    h("h3a", 3, "子节"),
    p("p2", "内容二"),
    p("p3", "内容三"),
];

describe("sectionHashesOfDoc · 包含式切段", () => {
    it("每块归属全部祖先标题段；标题自身进自己的段", () => {
        const m = sectionHashesOfDoc(doc);
        expect([...m.keys()].sort()).toEqual(["h1a", "h2a", "h2b", "h3a"]);
        // h2b 段含标题+子节标题+两段内容（子节归第二节）；h3a 段只含子节自身内容
        const sub = sectionHashesOfDoc([h("h3a", 3, "子节"), p("p2", "内容二"), p("p3", "内容三")]);
        expect(m.get("h3a")).toBe(sub.get("h3a"));
        const mid = sectionHashesOfDoc([
            h("h2b", 2, "第二节"),
            h("h3a", 3, "子节"),
            p("p2", "内容二"),
            p("p3", "内容三"),
        ]);
        expect(m.get("h2b")).toBe(mid.get("h2b"));
    });
    it("同级新标题顶替旧的、更深级清空（树语义同 buildSectionTree）", () => {
        const m = sectionHashesOfDoc([h("a", 2, "A"), h("b", 2, "B"), p("x", "X")]);
        expect(m.has("a")).toBe(true); // 段存在（含自身标题），X 不属于它
        const aOnly = sectionHashesOfDoc([h("a", 2, "A")]);
        expect(m.get("a")).toBe(aOnly.get("a"));
    });
    it("无标题文档/空内容返回空表", () => {
        expect(sectionHashesOfDoc([p("p1", "孤儿内容")]).size).toBe(0);
        expect(sectionHashesOfDoc([]).size).toBe(0);
    });
    it("内容变化改变指纹；空白变化不改变（questionHash 归一口径）", () => {
        const base = sectionHashesOfDoc([h("a", 1, "T"), p("p", "正文")]);
        const changed = sectionHashesOfDoc([h("a", 1, "T"), p("p", "正文改")]);
        expect(base.get("a")).not.toBe(changed.get("a"));
        const spaced = sectionHashesOfDoc([h("a", 1, "T"), p("p", "正文  ")]);
        expect(base.get("a")).toBe(spaced.get("a"));
    });
});

/** 假文档块行（rowsMapAll 按 root_id 匹配返回）。 */
function fakeDoc(blocksByDoc: Record<string, SecBlock[]>): void {
    rowsMapAll.mockImplementation(async (sql: string) => {
        const m = /root_id = '([^']+)'/.exec(sql);
        const blocks = m ? blocksByDoc[m[1]] : [];
        return blocks.map((b) => {
            const row = new Map<string, string>();
            row.set("id", b.id);
            if (b.type) row.set("type", b.type);
            if (b.subtype) row.set("subtype", b.subtype);
            if (b.content) row.set("content", b.content);
            return row;
        });
    });
}

function store(): KnowHashStore {
    return new KnowHashStore(
        async () => undefined,
        async () => undefined
    );
}

describe("KnowHashStore · 基线与漂移", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("导入写基线（含 docRoots 登记）；内容变更 diff 出 stale 且基线自推进", async () => {
        const s = store();
        fakeDoc({ d1: doc });
        await s.baselineDocs("root1", ["d1"]);
        expect((await s.diffDocs(["d1"])).size).toBe(0); // 未变

        const edited = doc.slice();
        edited[3] = p("p1", "内容一（改）");
        fakeDoc({ d1: edited });
        const stale = await s.diffDocs(["d1"]);
        // h2a 段变了；h1a 祖先段也变（包含式）——h2b/h3a 不受影响
        expect([...stale].sort()).toEqual(["h1a", "h2a"]);
        expect(await s.diffDocs(["d1"])).toEqual(new Set()); // 基线已推进，重开不报
    });

    it("新小节自身无基线不算 stale（祖先段内容确变会报，包含式语义）；refreshDoc 未登记文档零成本跳过", async () => {
        const s = store();
        fakeDoc({ d1: doc });
        await s.baselineDocs("root1", ["d1"]);
        const withNew = [...doc.slice(0, 3), h("h2c", 2, "新节"), ...doc.slice(3)];
        fakeDoc({ d1: withNew });
        // 新增子节改变了 h1a 祖先段（包含式切段的事实），但 h2c 自身
        // 无关联历史不报，兄弟节 h2a/h2b/h3a 不受牵连
        expect(await s.diffDocs(["d1"])).toEqual(new Set(["h1a"]));
        await s.refreshDoc("未登记文档"); // 不抛错不动表
        fakeDoc({ d1: withNew });
        await s.refreshDoc("d1");
        fakeDoc({ d1: withNew });
        expect((await s.diffDocs(["d1"])).size).toBe(0);
    });

    it("读存储异常归空表重建（基线可丢，不炸检测链）", async () => {
        const broken = new KnowHashStore(
            async () => {
                throw new Error("io");
            },
            async () => undefined
        );
        fakeDoc({ d1: doc });
        await broken.baselineDocs("root1", ["d1"]);
        fakeDoc({ d1: doc });
        expect((await broken.diffDocs(["d1"])).size).toBe(0);
    });
});
