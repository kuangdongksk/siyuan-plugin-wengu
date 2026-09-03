import { describe, expect, it, vi } from "vitest";
import type { BankData, BankRecord, QuestionBank } from "../data/QuestionBank";
import { QuestionBank as Bank } from "../data/QuestionBank";
import {
    AGGREGATE_ID,
    allSetMaterials,
    allSetQuestions,
    ensureSets,
    orderedSetIds,
    qidHasBlock,
    readRecordSrcGroups,
    removeRecords,
    setDocsView,
    setQuestions,
    staleRecords,
} from "./BankSets";
import { renderUnit } from "../../convert/service/QuestionDraft";

import { questionHash } from "./BankParse";
import { KernelQuery } from "../../siyuan/query";

// node 测试环境无 window（vitest 不启 jsdom），markDirty 的防抖定时器
// 走 window.setTimeout——globalThis 顶上（同 BankRecording.test）
(globalThis as { window?: unknown }).window ??= globalThis;

/**
 * 题集段纯逻辑（20260903 题目内容收进题库）：推导/聚合/序读/指纹分组/
 * 删标。ensureSets 的标题查询用 vi.mock 喂假行（KernelQuery 真身要内核）。
 */

vi.mock("../../siyuan/query", () => ({
    KernelQuery: { rows: vi.fn(), rowsAll: vi.fn(), rowsMap: vi.fn(), rowsMapAll: vi.fn() },
}));
const rows = vi.mocked(KernelQuery.rows);

function newBank(seed?: Partial<BankData>): { bank: QuestionBank; read: () => BankData } {
    let cache: BankData | undefined;
    const bank = new Bank(
        async () =>
            cache ??
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
                ...seed,
            } as BankData),
        async (v) => {
            cache = v;
        }
    );
    return { bank, read: () => cache! };
}

const rec = (qid: string, setId: string, extra?: Partial<BankRecord>): BankRecord => ({
    qid,
    kramdown: renderUnit({ material: false, attrs: { type: "single" }, parts: [] }),
    type: "single",
    kpRefs: [],
    sourceDocId: setId,
    hash: `h-${qid}`,
    stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
    ...extra,
});

describe("ensureSets", () => {
    it("按 sourceDocId 分组补 sets 条目，qids=records 插入序", async () => {
        const { bank, read } = newBank({
            records: { q1: rec("q1", "d1"), q2: rec("q2", "d1"), q3: rec("q3", "d2") },
        });
        rows.mockResolvedValueOnce([{ content: "文档一" }]).mockResolvedValueOnce([{ content: "文档二" }]);
        const added = await ensureSets(bank);
        expect(added).toBe(2);
        expect(read().sets?.d1).toMatchObject({ id: "d1", title: "文档一", qids: ["q1", "q2"] });
        expect(read().sets?.d2).toMatchObject({ id: "d2", title: "文档二", qids: ["q3"] });
    });

    it("标题读不到（文档已删）留空，幂等重跑零新增", async () => {
        const { bank, read } = newBank({ records: { q1: rec("q1", "d1") } });
        rows.mockResolvedValueOnce([]);
        await ensureSets(bank);
        expect(read().sets?.d1.title).toBe("");
        rows.mockReset();
        expect(await ensureSets(bank)).toBe(0);
    });
});

describe("setDocsView", () => {
    it("total 按 set.qids、运行时数字按记录 stats、docStats 归并；缺 set 的分组按记录数兜底", async () => {
        const { bank } = newBank({
            records: {
                q1: rec("q1", "s1", { stats: { attempts: 2, wrongCount: 1, right: "1", updatedAt: 0 } }),
                q2: rec("q2", "s1"),
                q3: rec("q3", "d2"),
            },
            sets: { s1: { id: "s1", title: "源卷", qids: ["q1", "q2"], createdAt: 1 } },
            docStats: { s1: 90 },
        });
        const docs = await setDocsView(bank);
        const s1 = docs.find((d) => d.id === "s1")!;
        expect(s1).toMatchObject({ title: "源卷", total: 2, attempted: 1, rightCount: 1, totalTime: 90 });
        const d2 = docs.find((d) => d.id === "d2")!;
        expect(d2.total).toBe(1); // 虚拟分组（推导未落）
        expect(d2.title).toContain("d2"); // 短 id 兜底
    });
});

describe("setQuestions / readRecordSrcGroups / 删标", () => {
    it("按 set.qids 序解析并覆盖统计；指纹分组按 srcHash 归组；删/标同步清题单", async () => {
        const kd = renderUnit({
            material: false,
            attrs: { type: "single", knowledge: "极限" },
            parts: [
                { name: "stem", text: "题干" },
                { name: "option-0", text: "甲" },
                { name: "option-0", text: "乙" },
                { name: "answer", text: "A" },
                { name: "solution", text: "解析" },
            ],
        });
        const q2 = rec("q2", "s1", { kramdown: kd, hash: questionHash(kd), srcKey: "H:a/b", srcHash: "hh-1" });
        const { bank, read } = newBank({
            records: { q2, q1: rec("q1", "s1", { srcKey: "H:a", srcHash: "hh-1" }) },
            sets: { s1: { id: "s1", title: "卷", qids: ["q2", "q1"], createdAt: 1 } }, // 乱序检验 qids 权威
        });
        const list = await setQuestions(bank, "s1");
        expect(list.map((q) => q.id)).toEqual(["q2", "q1"]);
        expect(list[0]).toMatchObject({ type: "single", stemMd: "题干", rootId: "s1", knowledge: "极限" });
        expect(list[0].optionMd).toEqual(["- A. 甲", "- B. 乙"]); // 字母由渲染层自动编（optionDisplayMd 再剥）

        const groups = await readRecordSrcGroups(bank, "s1");
        expect(groups).toEqual([{ key: "H:a/b", hash: "hh-1", blocks: expect.arrayContaining(["q2", "q1"]) }]);

        await staleRecords(bank, ["q1"]);
        expect(read().records.q1.srcStale).toBe("1");
        await removeRecords(bank, ["q1"]);
        expect(read().records.q1).toBeUndefined();
        expect(read().sets?.s1.qids).toEqual(["q2"]);
        expect(read().hashed["h-q1"]).toBeUndefined();
    });
});

describe("qidHasBlock", () => {
    it("内核块 id 形态（时间戳-7位）才有可跳源块；gen- 前缀自分配无", () => {
        expect(qidHasBlock("20260821165017-6ivs5xm")).toBe(true);
        expect(qidHasBlock("gen-abc123-def456")).toBe(false);
        expect(qidHasBlock("")).toBe(false);
    });
});

describe("聚合视图（all：全部习题合刷）", () => {
    it("AGGREGATE_ID 是保留字（不落 collections、不与 set- 前缀 mint 冲突）", () => {
        expect(AGGREGATE_ID).toBe("all");
        expect(AGGREGATE_ID.startsWith("set-")).toBe(false);
    });

    it("orderedSetIds=sets 插入序；聚合题目按题集先后 × 集内 qids 序，两层都不重排", async () => {
        const { bank } = newBank({
            records: { q1: rec("q1", "s1"), q2: rec("q2", "s2"), q3: rec("q3", "s1") },
            sets: {
                s2: { id: "s2", title: "线代", qids: ["q2"], createdAt: 2 },
                s1: { id: "s1", title: "高数", qids: ["q1", "q3"], createdAt: 1 },
            },
        });
        await expect(orderedSetIds(bank)).resolves.toEqual(["s2", "s1"]); // 插入序优先，不按 createdAt
        const list = await allSetQuestions(bank);
        expect(list.map((q) => q.id)).toEqual(["q2", "q1", "q3"]);
        expect(list.map((q) => q.rootId)).toEqual(["s2", "s1", "s1"]); // rootId 归位来源题集
    });

    it("空题集与未入集记录零贡献；材料并集按题集序、孤儿材料不进", async () => {
        const { bank } = newBank({
            records: { q1: rec("q1", "s1"), q9: rec("q9", "s-orph") },
            sets: {
                s1: { id: "s1", title: "高数", qids: ["q1"], createdAt: 1 },
                s2: { id: "s2", title: "空卷", qids: [], createdAt: 2 },
            },
            materials: {
                m1: { id: "m1", setId: "s1", bodyMd: "材料一" },
                m2: { id: "m2", setId: "s-orph", bodyMd: "孤儿" },
            },
        });
        expect((await allSetQuestions(bank)).map((q) => q.id)).toEqual(["q1"]);
        expect((await allSetMaterials(bank)).map((m) => m.bodyMd)).toEqual(["材料一"]);
    });
});
