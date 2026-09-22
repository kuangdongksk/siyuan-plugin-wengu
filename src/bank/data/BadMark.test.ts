import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionBank, type BankData, type BankRecord } from "./QuestionBank";
import { badMarkCount, badMarkedQids, badMarkedSet, isBadMarked, markBad, unmarkBad, unmarkMany } from "./BadMark";
import { regenBadMarkedRecords, regenRecords } from "../ui/RegenDialog";

/** AI 通道替身：按题轮流给「合法回复 / 空回复」——空回复走 runRegen 的
 *  `convertEmptyReply` 抛错路径=重转失败。 */
const replies: string[] = [];
vi.mock("../../ai/client", () => ({
    agentChatOnce: async (): Promise<string> => replies.shift() ?? "",
    aiAbort: (): unknown => ({ signal: new AbortController().signal, onSid: (): void => undefined }),
    // 重生成链把「重新生成」与「答案核查自检」挂同一组（Issue #123）
    newAiGroupId: (): string => "g-test",
}));
vi.mock("../../ui/Notify", () => ({
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
    initNotify: (): void => undefined,
}));

/** node 环境无 window（markDirty 的防抖定时器要它）。 */
(globalThis as { window?: unknown }).window ??= globalThis;

const OK_REPLY = "@@Q type=single\n@@P stem\n新的题干\n@@P opt\n甲\n@@P opt\n乙\n@@P ans\nA\n@@END";

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

/** 无中止句柄（批量重转照常跑到底）。 */
function noStop(): { signal: AbortSignal; onSid(sid: string): void } {
    return { signal: new AbortController().signal, onSid: (): void => undefined };
}

beforeEach(() => {
    replies.length = 0;
});

describe("标记 / 取消（badMark 字段口径同题库存量 optional 字段）", () => {
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

    it("unmarkMany 只清清单内的、且只数真清掉的（幂等项不计）", async () => {
        const { bank, read } = newBank([rec("q1", "doc1", { badMark: "1" }), rec("q2"), rec("q3")]);
        expect(await unmarkMany(bank, ["q1", "q2", "gone"])).toBe(1);
        expect("badMark" in read().records.q1).toBe(false);
        expect(await unmarkMany(bank, ["q1", "q3"])).toBe(0); // 已无标记：零变化
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

    it("badMarkedSet / badMarkCount 读同步快照；未装载=空集/0（徽标不出钮）", async () => {
        const { bank, read } = newBank([rec("q1", "doc1", { badMark: "1" }), rec("q2")]);
        expect(badMarkedSet(bank.peek()).size).toBe(0); // 装载前 peek=undefined
        expect(badMarkCount(bank.peek())).toBe(0);
        expect(badMarkedSet(undefined).size).toBe(0);
        await bank.all();
        expect([...badMarkedSet(bank.peek())]).toEqual(["q1"]);
        expect(badMarkCount(bank.peek())).toBe(1);
        read().records.q2.badMark = "1";
        expect(badMarkCount(bank.peek())).toBe(2); // 同步读，无 await
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

describe("regenRecords 逐题回报成败（批量清标记的判据来源）", () => {
    it("成功/失败逐题回传，返回值=成功数", async () => {
        const { bank } = newBank([rec("q1"), rec("q2")]);
        replies.push(OK_REPLY, ""); // q1 成功、q2 AI 空回复=失败
        const seen: [string, boolean][] = [];
        const ok = await regenRecords(
            { t: (k) => k, bank, modelId: "", onDone: () => undefined },
            ["q1", "q2"],
            noStop(),
            (qid, one) => seen.push([qid, one])
        );
        expect(ok).toBe(1);
        expect(seen).toEqual([
            ["q1", true],
            ["q2", false],
        ]);
    });
});

describe("批量重转标记题（Issue #46 验收 4/5）", () => {
    it("只清「真正重转成功」的标记；失败的保留待再转", async () => {
        const { bank, read } = newBank([rec("q1", "doc1", { badMark: "1" }), rec("q2", "doc1", { badMark: "1" })]);
        replies.push(OK_REPLY, ""); // q1 成功、q2 失败（AI 空回复）
        const ok = await regenBadMarkedRecords({ t: (k) => k, bank, modelId: "", onDone: () => undefined }, noStop());
        expect(ok).toBe(1);
        expect("badMark" in read().records.q1).toBe(false); // 成功：标记清掉
        expect(read().records.q2.badMark).toBe("1"); // 失败：保留
        expect(await badMarkedQids(bank)).toEqual(["q2"]);
    });

    it("无标记题：零 AI 调用、零刷新", async () => {
        const { bank } = newBank([rec("q1")]);
        const onDone = vi.fn();
        expect(await regenBadMarkedRecords({ t: (k) => k, bank, modelId: "", onDone }, noStop())).toBe(0);
        expect(onDone).not.toHaveBeenCalled();
        expect(replies.length).toBe(0);
    });

    it("重转原题位回写：qid 不变、作答统计与题集归属不动", async () => {
        const { bank, read } = newBank([
            rec("q1", "doc1", {
                badMark: "1",
                kramdown: "@@Q type=single\n@@P stem\n旧题干\n@@P ans\nA\n@@END",
                stats: { attempts: 7, wrongCount: 3, right: "0", updatedAt: 123 },
            }),
        ]);
        replies.push(OK_REPLY);
        await regenBadMarkedRecords({ t: (k) => k, bank, modelId: "", onDone: () => undefined }, noStop());
        const r = read().records.q1;
        expect(r.qid).toBe("q1"); // 原题位替换，qid 不变
        expect(r.sourceDocId).toBe("doc1"); // 题集归属不动
        expect(r.stats).toEqual({ attempts: 7, wrongCount: 3, right: "0", updatedAt: 123 }); // 作答统计不动
        expect(r.kramdown).toContain("新的题干"); // 内容确实换新
        expect("badMark" in r).toBe(false);
    });
});
