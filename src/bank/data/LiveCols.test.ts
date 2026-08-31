import { describe, expect, it } from "vitest";
import { QuestionBank, type BankData, type BankRecord } from "./QuestionBank";
import { ensureLiveCollection, liveColIdOf, refreshLiveCollections, subKeysOf } from "./LiveCols";

/** node 测试环境无 window（vitest 不启 jsdom），markDirty 的防抖定时器
 *  走 window.setTimeout——挂 globalThis 兜底（DriftWatch/BankRecording 同款）。 */
(globalThis as { window?: unknown }).window ??= globalThis;

function bankWith(records: BankRecord[]): QuestionBank {
    const data: BankData = {
        version: 1,
        records: Object.fromEntries(records.map((r) => [r.qid, r])),
        collections: [],
        migratedDocs: [],
        hashed: {},
        knowRoots: [],
        folders: [],
        knowHidden: [],
        docStats: {},
    };
    return new QuestionBank(
        async () => data,
        async () => undefined
    );
}

function rec(qid: string, kpIds: string[]): BankRecord {
    return {
        qid,
        kramdown: "",
        type: "single",
        kpRefs: kpIds.map((id) => ({ id, title: id })),
        sourceDocId: "doc1",
        hash: qid,
        stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
    };
}

describe("subKeysOf 子树键并集", () => {
    it("先序遍历：首键=节点自身，后代全部收入", () => {
        const keys = subKeysOf({
            id: "h1",
            children: [
                { id: "h1a", children: [{ id: "h1a1", children: [] }] },
                { id: "h1b", children: [] },
            ],
        });
        expect(keys).toEqual(["kp:h1", "kp:h1a", "kp:h1a1", "kp:h1b"]);
    });
});

describe("ensureLiveCollection 活视图专题（□3）", () => {
    it("确定性 id（col-kp-{块id}）+ 子树并集题单 + nodeKey/subKeys 落档", async () => {
        const bank = bankWith([rec("q1", ["h1"]), rec("q2", ["h1a"]), rec("q3", ["h2"])]);
        const row = await ensureLiveCollection(bank, { id: "h1", title: "洛必达法则" }, ["kp:h1", "kp:h1a"]);
        expect(row.id).toBe("col-kp-h1");
        expect(liveColIdOf("h1")).toBe(row.id);
        expect(row.count).toBe(2); // q1(自身) + q2(子树)，h2 不进
        const col = (await bank.all()).collections.find((c) => c.id === row.id);
        expect(col?.nodeKey).toBe("kp:h1");
        expect(col?.subKeys).toEqual(["kp:h1", "kp:h1a"]);
        expect(col?.qids.sort()).toEqual(["q1", "q2"]);
    });

    it("再点=重绑（标题跟随节点），不建重复专题", async () => {
        const bank = bankWith([rec("q1", ["h1"])]);
        await ensureLiveCollection(bank, { id: "h1", title: "洛必达" }, ["kp:h1"]);
        await ensureLiveCollection(bank, { id: "h1", title: "洛必达法则" }, ["kp:h1"]);
        const cols = (await bank.all()).collections;
        expect(cols).toHaveLength(1);
        expect(cols[0].title).toBe("洛必达法则");
    });

    it("questionsOf 读取时实时回流：对账后新挂引用的题自动进题单", async () => {
        const data: BankData = {
            version: 1,
            records: { q1: rec("q1", ["h1"]) },
            collections: [],
            migratedDocs: [],
            hashed: {},
            knowRoots: [],
            folders: [],
            knowHidden: [],
            docStats: {},
        };
        const bank = new QuestionBank(
            async () => data,
            async () => undefined
        );
        const row = await ensureLiveCollection(bank, { id: "h1", title: "极限" }, ["kp:h1"]);
        expect((await bank.all()).collections[0].qids).toEqual(["q1"]);
        // 题库后续变化：补题生成的新题挂同一节点引用
        data.records["gen-1"] = rec("gen-1", ["h1"]);
        expect((await bank.all()).collections[0].qids).toEqual(["q1"]); // 未读取不刷新
        await bank.questionsOf(row.id);
        expect((await bank.all()).collections[0].qids.sort()).toEqual(["gen-1", "q1"]);
    });

    it("refreshLiveCollections 只动活专题：手动快照 qids 原样", async () => {
        const data: BankData = {
            version: 1,
            records: { q1: rec("q1", ["h1"]), q2: rec("q2", ["h1"]) },
            collections: [],
            migratedDocs: [],
            hashed: {},
            knowRoots: [],
            folders: [],
            knowHidden: [],
            docStats: {},
        };
        const bank = new QuestionBank(
            async () => data,
            async () => undefined
        );
        await bank.createCollection("手动专题", ["q1"], "manual");
        await ensureLiveCollection(bank, { id: "h1", title: "极限" }, ["kp:h1"]);
        data.collections[0].qids = ["q1"]; // 手动快照被外部改窄（模拟移题）
        data.records["q3"] = rec("q3", ["h1"]);
        await refreshLiveCollections(bank);
        const cols = data.collections;
        expect(cols.find((c) => c.id.startsWith("col-kp-"))?.qids.sort()).toEqual(["q1", "q2", "q3"]);
        expect(cols.find((c) => c.title === "手动专题")?.qids).toEqual(["q1"]); // 快照不动
    });
});
