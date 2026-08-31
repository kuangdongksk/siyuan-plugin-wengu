import { describe, expect, it } from "vitest";
import { QuestionBank, type BankData, type BankRecord } from "./QuestionBank";
import { addDocTime, overrideAnswer, overrideStepsResult, recordStepsResult, recordSlotsResult } from "./BankRecording";

/** node 测试环境无 window（vitest 不启 jsdom），markDirty 的防抖定时器
 *  需要它——挂全局自指即可（node 的 setTimeout/clearTimeout 全局就有）。 */
(globalThis as { window?: unknown }).window ??= globalThis;

/**
 * 作答记账自托管（20260831）：六个原「读块属性→写块属性」记账函数的
 * 语义等价迁移——累计答错不清零、改判只翻 right 微调 wrongCount、AI
 * 实时步不落细粒度。纯内存操作，不碰内核。
 */

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

function rec(qid: string, attempts = 2, wrongCount = 1): BankRecord {
    return {
        qid,
        kramdown: "",
        type: "steps",
        kpRefs: [],
        sourceDocId: "doc1",
        hash: qid,
        stats: { attempts, wrongCount, updatedAt: 0 },
    };
}

describe("recordStepsResult · steps 整题记账", () => {
    it("attempts+1、全步对不加错、lastAnswer 竖线、细粒度按 persist 落", async () => {
        const bank = bankWith([rec("q1")]);
        const allOk = await recordStepsResult(bank, "q1", ["A", "B"], [true, true], true);
        expect(allOk).toBe(true);
        const s = (await bank.all()).records.q1.stats;
        expect(s.attempts).toBe(3);
        expect(s.wrongCount).toBe(1); // 全对不清零历史错次
        expect(s.lastAnswer).toBe("A|B");
        expect(s.right).toBe("1");
        expect(s.stepRight).toBe("11");
        expect(s.stepLast).toBe("A|B");
    });
    it("persist=false 只记整题四字段（AI 实时步不落细粒度）", async () => {
        const bank = bankWith([rec("q1")]);
        await recordStepsResult(bank, "q1", ["A", "B"], [true, false], false);
        const s = (await bank.all()).records.q1.stats;
        expect(s.attempts).toBe(3);
        expect(s.wrongCount).toBe(2);
        expect(s.right).toBe("0");
        expect(s.stepRight).toBeUndefined();
        expect(s.stepLast).toBeUndefined();
    });
    it("qid 带 #k 后缀剥到整题；不在库的题静默跳过", async () => {
        const bank = bankWith([rec("q1")]);
        await recordStepsResult(bank, "q1#0", ["A"], [true], false);
        expect((await bank.all()).records.q1.stats.attempts).toBe(3);
        const miss = await recordStepsResult(bank, "ghost", ["A"], [true], false);
        expect(miss).toBe(true); // 返回值仍是判定结果，只是不记账
    });
});

describe("recordSlotsResult · slots 整题记账", () => {
    it("逐空细粒度恒落盘（slotRight 位图）", async () => {
        const bank = bankWith([rec("q1")]);
        await recordSlotsResult(bank, "q1", ["A", "C"], [true, false]);
        const s = (await bank.all()).records.q1.stats;
        expect(s.attempts).toBe(3);
        expect(s.wrongCount).toBe(2);
        expect(s.slotRight).toBe("10");
        expect(s.slotLast).toBe("A|C");
        expect(s.right).toBe("0");
    });
});

describe("overrideAnswer / overrideStepsResult · 改判", () => {
    it("brief 错改对：翻 right 回退一次错次，对改错补记", async () => {
        const bank = bankWith([rec("q1", 2, 1)]);
        await overrideAnswer(bank, "q1", true);
        let s = (await bank.all()).records.q1.stats;
        expect(s.right).toBe("1");
        expect(s.wrongCount).toBe(0);
        expect(s.attempts).toBe(2); // 改判不动 attempts
        await overrideAnswer(bank, "q1", false);
        s = (await bank.all()).records.q1.stats;
        expect(s.right).toBe("0");
        expect(s.wrongCount).toBe(1);
    });
    it("steps 申诉翻对：整题由错翻对回退一次错次并落逐步态", async () => {
        const bank = bankWith([rec("q1", 1, 1)]);
        (await bank.all()).records.q1.stats.right = "0";
        const allOk = await overrideStepsResult(bank, "q1", ["A", "B"], [true, true]);
        expect(allOk).toBe(true);
        const s = (await bank.all()).records.q1.stats;
        expect(s.right).toBe("1");
        expect(s.wrongCount).toBe(0);
        expect(s.stepRight).toBe("11");
    });
});

describe("addDocTime · 文档用时", () => {
    it("累加进 docStats；非法输入安全跳过", async () => {
        const bank = bankWith([]);
        await addDocTime(bank, "doc1", 15);
        await addDocTime(bank, "doc1", 7);
        await addDocTime(bank, "", 5);
        await addDocTime(bank, "doc1", 0);
        expect((await bank.all()).docStats).toEqual({ doc1: 22 });
    });
});
