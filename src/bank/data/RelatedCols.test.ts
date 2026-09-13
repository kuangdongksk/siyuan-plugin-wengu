import { describe, expect, it } from "vitest";
import { QuestionBank, type BankData, type BankRecord } from "./QuestionBank";
import {
    ensureRelatedCollection,
    refreshLiveCollections,
    relatedColIdOf,
    relatedColTitle,
    relatedDocIdFromColId,
    relatedNodeKey,
} from "./LiveCols";

/** node 环境无 window（vitest 不启 jsdom）：markDirty 防抖定时器走
 *  globalThis 兜底（LiveCols.test 同款）。 */
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

function rec(qid: string, opts: Partial<BankRecord> = {}): BankRecord {
    return {
        qid,
        kramdown: "",
        type: "single",
        kpRefs: [],
        sourceDocId: "",
        hash: qid,
        stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
        ...opts,
    };
}

describe("related 活视图绑定（Issue #44）", () => {
    it("确定性 id + nodeKey（不得复用 col-kp-）", async () => {
        const bank = bankWith([rec("q1", { sourceDocId: "docA" })]);
        const row = await ensureRelatedCollection(bank, "docA", "高等数学");
        expect(row.id).toBe("col-related-docA");
        expect(row.id).toBe(relatedColIdOf("docA"));
        expect(row.id.startsWith("col-kp-")).toBe(false);
        const col = (await bank.all()).collections[0];
        expect(col.nodeKey).toBe(relatedNodeKey("docA"));
        expect(col.subKeys).toBeUndefined(); // related 腿不用 kp 键收集
        expect(col.title).toBe("相关题·高等数学");
    });

    it("题单与 related 收集口径同源：「sourceDocId 命中但无 kpRefs」的题也进", async () => {
        const bank = bankWith([
            rec("q-noKp", { sourceDocId: "docA" }), // 关键用例：无 kpRefs
            rec("q-other", { sourceDocId: "set-2", kpRefs: [{ id: "h1", title: "h1" }] }),
            rec("q-none", { sourceDocId: "set-9" }),
        ]);
        const row = await ensureRelatedCollection(bank, "docA", "高数");
        // kpRootMap 是 SQL 依赖（内核 IO 不进单测）：h1 无映射 → q-other 不计；
        // q-noKp 靠 sourceDocId 命中，证明该腿没被 kp 键收集吞掉
        expect(row.count).toBe(1);
        expect((await bank.all()).collections[0].qids).toEqual(["q-noKp"]);
    });

    it("再点=对账题单 + 标题跟随来源（不建重复专题）", async () => {
        const data: BankData = {
            version: 1,
            records: { q1: rec("q1", { sourceDocId: "docA" }) },
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
        await ensureRelatedCollection(bank, "docA", "高数");
        data.records["q2"] = rec("q2", { sourceDocId: "docA" }); // 题库后续变化
        const row = await ensureRelatedCollection(bank, "docA", "高等数学");
        expect(data.collections).toHaveLength(1);
        expect(row.title).toBe("相关题·高等数学");
        expect(row.count).toBe(2); // 读取时自动回流
    });

    it("空标题不覆盖现值（文档已删/查不到时保住用户已有标题）", async () => {
        const bank = bankWith([rec("q1", { sourceDocId: "docA" })]);
        await ensureRelatedCollection(bank, "docA", "高数");
        const row = await ensureRelatedCollection(bank, "docA", "");
        expect(row.title).toBe("相关题·高数");
    });

    it("refreshLiveCollections 对账 related 腿（手动快照仍不动）", async () => {
        const data: BankData = {
            version: 1,
            records: { q1: rec("q1", { sourceDocId: "docA" }) },
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
        await bank.createCollection("手动", ["q1"], "manual");
        await ensureRelatedCollection(bank, "docA", "高数");
        data.records["q2"] = rec("q2", { sourceDocId: "docA" });
        data.collections.find((c) => c.title === "手动")!.qids = [];
        await refreshLiveCollections(bank);
        expect(data.collections.find((c) => c.id.startsWith("col-related-"))?.qids.sort()).toEqual(["q1", "q2"]);
        expect(data.collections.find((c) => c.title === "手动")?.qids).toEqual([]); // 快照不动
    });

    it("relatedDocIdFromColId 反解来源文档（删除后重开弹窗重建用）", () => {
        expect(relatedDocIdFromColId("col-related-docA")).toBe("docA");
        expect(relatedDocIdFromColId("col-kp-h1")).toBe("");
        expect(relatedColTitle("", "")).toBe("");
    });
});
