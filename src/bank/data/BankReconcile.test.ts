import { beforeEach, describe, expect, it, vi } from "vitest";

// node 测试环境无 window：QuestionBank.markDirty 的防抖定时器走
// window.setTimeout——globalThis 顶上（同 BankHealth/BankSets 口径）
(globalThis as { window?: unknown }).window ??= globalThis;

/**
 * 知识引用对账（Issue #115）：BankHealth/BankRepair/BankRecording 都有
 * 测试，独缺 reconcileKnowledgeRefs 这条**写**路径——它按标题唯一命中
 * 重挂悬空 kpRef，挂错一次就是全库题目挂到不相干知识点上，且清不掉。
 *
 * 内核 SQL 走 KernelQuery.rowsMap 打桩（内核 IO 不进单测），题库给内存实现
 * 真实例（读写语义与生产一致）；weakness 给最小替身（只需 remapKey）。
 * 锁四条：零引用短路、命中数≠1 不重挂、唯一命中重挂+计数+落盘、查库失败静默归零。
 */

/** SQL 替身：按语句特征回放预设结果（对账只发两种查询）。 */
const sql = {
    blocks: new Map<string, string>(), // id → root_id（存在性判定）
    headings: new Map<string, string[]>(), // content 标题 → 块 id 列表（唯一性判定）
    fail: false,
    calls: [] as string[],
};

vi.mock("../../siyuan/query", () => ({
    KernelQuery: {
        rowsMap: vi.fn(async (q: string): Promise<Map<string, string>[]> => {
            sql.calls.push(q);
            if (sql.fail) throw new Error("kernel down");
            if (q.includes("FROM blocks WHERE id IN")) {
                const ids = [...q.matchAll(/'([^']+)'/g)].map((m) => m[1]);
                return ids.filter((id) => sql.blocks.has(id)).map((id) => row({ id, root_id: sql.blocks.get(id)! }));
            }
            if (q.includes("type = 'h'")) {
                const m = /content = '((?:[^']|'')*)'/.exec(q);
                const title = (m?.[1] ?? "").replace(/''/g, "'");
                return (sql.headings.get(title) ?? []).map((id) => row({ id }));
            }
            return [];
        }),
        rows: vi.fn(async (): Promise<Map<string, string>[]> => []),
        rowsAll: vi.fn(async (): Promise<Map<string, string>[]> => []),
    },
}));

/** rowsMap 的返回件（KernelQuery.rowsMap 真实现给的也是这个形状）。 */
function row(fields: Record<string, string>): Map<string, string> {
    return new Map(Object.entries(fields));
}

import { reconcileKnowledgeRefs } from "./BankReconcile";
import { QuestionBank } from "./QuestionBank";
import type { BankData, BankRecord } from "./QuestionBank";
import type { WeaknessStore } from "./WeaknessStore";

function rec(qid: string, kpRefs: { id: string; title: string }[]): BankRecord {
    return {
        qid,
        kramdown: "kd",
        type: "single",
        kpRefs,
        sourceDocId: "",
        hash: `h-${qid}`,
        stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
    };
}

function newBank(records: BankRecord[]): {
    bank: QuestionBank;
    read: () => BankData;
    flushes: () => number;
} {
    let cache: BankData = {
        version: 1,
        records: Object.fromEntries(records.map((r) => [r.qid, r])),
        collections: [],
        migratedDocs: [],
        hashed: {},
        knowRoots: [],
        folders: [],
        docStats: {},
        sets: {},
        materials: {},
        knowTrees: {},
    } as unknown as BankData;
    let flushes = 0;
    return {
        bank: new QuestionBank(
            async () => cache,
            async (v) => {
                cache = v;
                flushes++;
            }
        ),
        read: () => cache,
        flushes: () => flushes,
    };
}

/** 薄弱画像替身：只落在对账真正调的那一个方法上。 */
function weaknessOf(): WeaknessStore & { remaps: [string, string, string][] } {
    const remaps: [string, string, string][] = [];
    return {
        remaps,
        remapKey: async (from: string, to: string, title: string): Promise<void> => void remaps.push([from, to, title]),
    } as unknown as WeaknessStore & { remaps: [string, string, string][] };
}

beforeEach(() => {
    sql.blocks = new Map();
    sql.headings = new Map();
    sql.fail = false;
    sql.calls = [];
});

describe("reconcileKnowledgeRefs · 重挂语义", () => {
    it("毫无引用时零查询零重挂（短路）", async () => {
        const { bank } = newBank([rec("q1", [])]);
        const w = weaknessOf();
        expect(await reconcileKnowledgeRefs(bank, w)).toBe(0);
        expect(sql.calls).toEqual([]);
        expect(w.remaps).toEqual([]);
    });

    it("引用全部存活时零重挂（不该白跑一轮 flush）", async () => {
        sql.blocks.set("kp-1", "doc-1");
        const { bank, flushes } = newBank([rec("q1", [{ id: "kp-1", title: "极限" }])]);
        expect(await reconcileKnowledgeRefs(bank, weaknessOf())).toBe(0);
        expect(flushes()).toBe(0);
    });

    it("悬空 + 同库按标题唯一命中 → 重挂（记录换 id、薄弱键跟着搬、落盘）", async () => {
        sql.headings.set("极限", ["kp-new"]);
        const { bank, read, flushes } = newBank([
            rec("q1", [{ id: "kp-old", title: "极限" }]),
            rec("q2", [{ id: "kp-old", title: "极限" }]),
            rec("q3", [{ id: "kp-other", title: "导数" }]),
        ]);
        sql.blocks.set("kp-other", "doc-3");
        const w = weaknessOf();
        expect(await reconcileKnowledgeRefs(bank, w)).toBe(2); // 两条记录被重挂
        const data = read();
        expect(data.records.q1.kpRefs).toEqual([{ id: "kp-new", title: "极限" }]);
        expect(data.records.q2.kpRefs).toEqual([{ id: "kp-new", title: "极限" }]);
        expect(data.records.q3.kpRefs).toEqual([{ id: "kp-other", title: "导数" }]); // 无引用者不动
        expect(w.remaps).toEqual([["kp:kp-old", "kp:kp-new", "极限"]]); // 薄弱画像同键搬移
        expect(flushes()).toBeGreaterThan(0);
    });

    it("同标题多命中 → 不重挂（保留悬空，宁缺勿错）", async () => {
        sql.headings.set("极限", ["kp-a", "kp-b"]);
        const { bank, read, flushes } = newBank([rec("q1", [{ id: "kp-old", title: "极限" }])]);
        expect(await reconcileKnowledgeRefs(bank, weaknessOf())).toBe(0);
        expect(read().records.q1.kpRefs).toEqual([{ id: "kp-old", title: "极限" }]);
        expect(flushes()).toBe(0);
    });

    it("零命中（标题也改了）→ 不重挂", async () => {
        const { bank, read } = newBank([rec("q1", [{ id: "kp-old", title: "极限" }])]);
        expect(await reconcileKnowledgeRefs(bank, weaknessOf())).toBe(0);
        expect(read().records.q1.kpRefs).toEqual([{ id: "kp-old", title: "极限" }]);
    });

    it("唯一命中就是自身 id → 不重挂（编辑不变，不该算悬空）", async () => {
        // 块存在性查询「查不到」但标题查询命中原 id：极端不一致下也不动
        sql.headings.set("极限", ["kp-old"]);
        const { bank, read } = newBank([rec("q1", [{ id: "kp-old", title: "极限" }])]);
        expect(await reconcileKnowledgeRefs(bank, weaknessOf())).toBe(0);
        expect(read().records.q1.kpRefs).toEqual([{ id: "kp-old", title: "极限" }]);
    });

    it("标题为空的悬空引用跳过（无从重挂）", async () => {
        const { bank } = newBank([rec("q1", [{ id: "kp-old", title: "" }])]);
        expect(await reconcileKnowledgeRefs(bank, weaknessOf())).toBe(0);
        expect(sql.calls.filter((q) => q.includes("type = 'h'"))).toEqual([]);
    });

    it("标题含单引号走 SQL 转义（注入面不破句）", async () => {
        sql.headings.set("it's a test", ["kp-new"]);
        const { bank } = newBank([rec("q1", [{ id: "kp-old", title: "it's a test" }])]);
        expect(await reconcileKnowledgeRefs(bank, weaknessOf())).toBe(1);
        expect(sql.calls.some((q) => q.includes("content = 'it''s a test'"))).toBe(true);
    });

    it("块存在性查询失败 → 静默归零（不把全库误判成悬空）", async () => {
        sql.blocks.set("kp-1", "doc-1");
        sql.headings.set("极限", ["kp-new"]);
        const { bank, read } = newBank([rec("q1", [{ id: "kp-1", title: "极限" }])]);
        sql.fail = true;
        expect(await reconcileKnowledgeRefs(bank, weaknessOf())).toBe(0);
        sql.fail = false;
        expect(read().records.q1.kpRefs).toEqual([{ id: "kp-1", title: "极限" }]); // 原样保留
    });
});
