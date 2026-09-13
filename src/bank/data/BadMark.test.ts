import { describe, expect, it, vi } from "vitest";
import { QuestionBank, type BankData, type BankRecord } from "./QuestionBank";
import { badMarkCount, badMarkedQids, isBadMarked, markBad, unmarkBad } from "./BadMark";
import { countBadMarked } from "../../quiz/service/BadMarkRegen";

vi.mock("../../ui/Notify", () => ({
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
    initNotify: (): void => undefined,
}));

/** node 环境无 window（markDirty 的防抖定时器要它）。 */
(globalThis as { window?: unknown }).window ??= globalThis;

function rec(qid: string, sourceDocId = "doc1", extra: Partial<BankRecord> = {}): BankRecord {
    return {
        qid,
        kramdown: "",
        type: "single",
        kpRefs: [],
        sourceDocId,
        hash: qid,
        stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
        ...extra,
    };
}

function newBank(records: BankRecord[], seed?: Partial<BankData>): { bank: QuestionBank; read: () => BankData } {
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
        ...seed,
    };
    return {
        bank: new QuestionBank(
            async () => data,
            async () => undefined
        ),
        read: () => data,
    };
}

describe("标记 / 取消（badMark 字段口径同 srcStale）", () => {
    it("标记写 badMark=1 并落脏；再标幂等不重复落盘", async () => {
        const { bank, read } = newBank([rec("q1")]);
        const markSpy = vi.spyOn(bank, "markDirty");
        expect(await markBad(bank, "q1")).toBe(true);
        expect(read().records.q1.badMark).toBe("1");
        expect(markSpy).toHaveBeenCalledTimes(1);
        expect(await markBad(bank, "q1")).toBe(false); // 已标记：无变化
        expect(markSpy).toHaveBeenCalledTimes(1);
    });

    it('取消删键（不留 badMark="0" 残值），再取消幂等', async () => {
        const { bank, read } = newBank([rec("q1", "doc1", { badMark: "1" })]);
        expect(await unmarkBad(bank, "q1")).toBe(true);
        expect("badMark" in read().records.q1).toBe(false); // 删键而非置假值
        expect(await unmarkBad(bank, "q1")).toBe(false);
    });

    it("qid 不在库 / 空串：零动作零落盘", async () => {
        const { bank } = newBank([rec("q1")]);
        expect(await markBad(bank, "gone")).toBe(false);
        expect(await markBad(bank, "")).toBe(false);
        expect(await isBadMarked(bank, "gone")).toBe(false);
    });

    it("isBadMarked 按记录读（未标记存量记录为 false）", async () => {
        const { bank } = newBank([rec("q1"), rec("q2", "doc1", { badMark: "1" })]);
        expect(await isBadMarked(bank, "q1")).toBe(false);
        expect(await isBadMarked(bank, "q2")).toBe(true);
    });
});

describe("收集（跨卷全局，排序可预期）", () => {
    it("badMarkedQids 收全库标记题，按题集 × qid 稳定序", async () => {
        const { bank } = newBank([
            rec("b2", "doc2", { badMark: "1" }),
            rec("a2", "doc1", { badMark: "1" }),
            rec("a1", "doc1", { badMark: "1" }),
            rec("a3", "doc1"),
        ]);
        expect(await badMarkedQids(bank)).toEqual(["a1", "a2", "b2"]);
    });

    it("badMarkCount 计总数；题库未就绪返回 0（徽标不显示）", async () => {
        const { bank } = newBank([rec("q1", "doc1", { badMark: "1" }), rec("q2")]);
        expect(await badMarkCount(bank)).toBe(1);
        expect(await badMarkCount(undefined)).toBe(0);
    });

    it("头部徽标口径 countBadMarked 读快照（未装载 0=不出钮）", async () => {
        const { bank, read } = newBank([rec("q1", "doc1", { badMark: "1" }), rec("q2")]);
        expect(countBadMarked(bank.peek())).toBe(0); // 装载前 peek=undefined
        expect(countBadMarked(undefined)).toBe(0);
        await bank.all();
        expect(countBadMarked(bank.peek())).toBe(1);
        read().records.q2.badMark = "1";
        expect(countBadMarked(bank.peek())).toBe(2); // 同步读，无 await
    });
});

describe("装载：无新字段存量记录零影响（backfill 口径）", () => {
    it("存量库（无 badMark）装载后字段不补、收集为空、标记可用", async () => {
        const { bank, read } = newBank([rec("q1"), rec("q2")]);
        await bank.all();
        expect("badMark" in read().records.q1).toBe(false); // 不写 undefined 键
        expect(await badMarkedQids(bank)).toEqual([]);
        expect(await markBad(bank, "q1")).toBe(true);
        expect(await badMarkedQids(bank)).toEqual(["q1"]);
    });

    it("字段不进 kramdown/指纹面：标记前后 hash 与 kramdown 逐字节不变", async () => {
        const { bank, read } = newBank([rec("q1")]);
        const before = { kd: read().records.q1.kramdown, hash: read().records.q1.hash };
        await markBad(bank, "q1");
        expect(read().records.q1.kramdown).toBe(before.kd);
        expect(read().records.q1.hash).toBe(before.hash);
    });
});
