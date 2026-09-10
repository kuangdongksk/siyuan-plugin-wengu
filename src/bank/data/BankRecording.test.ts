import { describe, expect, it } from "vitest";
import { QuestionBank, type BankData, type BankRecord } from "./QuestionBank";
import {
    addDocTime,
    overrideAnswer,
    overrideStepsResult,
    recordStepsResult,
    recordSlotsResult,
    recordVerifyResult,
} from "./BankRecording";

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
        // 本题**已答错过**：right=0（镜像记账写的是 "0"/"1"）
        const bank = bankWith([rec("q1", 2, 1)]);
        (await bank.all()).records.q1.stats.right = "0";
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
    it("没答过的记录（right 缺省）翻错要补记一次——right 缺省视为对", async () => {
        const bank = bankWith([rec("q1", 0, 0)]);
        await overrideAnswer(bank, "q1", false);
        const s = (await bank.all()).records.q1.stats;
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

describe("recordVerifyResult · after 模式重复提交覆写（Issue #12 B2）", () => {
    it("不动 attempts，lastAnswer/right 以最后一次为准", async () => {
        const bank = bankWith([rec("q1", 1, 0)]); // 首次提交已记 attempts=1
        (await bank.all()).records.q1.stats.right = "1";
        (await bank.all()).records.q1.stats.lastAnswer = "A";
        await recordVerifyResult(bank, "q1", "C", false);
        const s = (await bank.all()).records.q1.stats;
        expect(s.attempts).toBe(1); // 重复提交不重复计数
        expect(s.lastAnswer).toBe("C");
        expect(s.right).toBe("0");
    });
    it("wrongCount 口径＝曾错不清零：错→对不回退（历史真错过），对→错补记一次", async () => {
        const bank = bankWith([rec("q1", 1, 0)]); // 首次提交已记账（attempts=1）
        (await bank.all()).records.q1.stats.right = "0"; // 首次提交答错（wrongCount 已含这一次）
        await recordVerifyResult(bank, "q1", "B", true);
        let s = (await bank.all()).records.q1.stats;
        expect(s.right).toBe("1");
        expect(s.wrongCount).toBe(0); // 当次错因这次改对而抵掉（历史（rec 传入的）错次不在本口径内）
        await recordVerifyResult(bank, "q1", "D", false);
        s = (await bank.all()).records.q1.stats;
        expect(s.right).toBe("0");
        expect(s.wrongCount).toBe(1); // 对翻错补记一次
        await recordVerifyResult(bank, "q1", "D", false);
        s = (await bank.all()).records.q1.stats;
        expect(s.wrongCount).toBe(1); // 终态未变，零动作
    });
    it("终态一致时零动作（改回原文再提交同一对错不膨胀）", async () => {
        const bank = bankWith([rec("q1", 1, 0)]);
        (await bank.all()).records.q1.stats.right = "0";
        await recordVerifyResult(bank, "q1", "A", false);
        await recordVerifyResult(bank, "q1", "B", false);
        const s = (await bank.all()).records.q1.stats;
        expect(s.wrongCount).toBe(0);
        expect(s.lastAnswer).toBe("B");
    });
    it("不在库的题静默跳过（返 false，不抛）", async () => {
        const bank = bankWith([]);
        expect(await recordVerifyResult(bank, "ghost", "A", true)).toBe(false);
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
