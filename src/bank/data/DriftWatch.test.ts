import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionBank, type BankData, type BankRecord } from "./QuestionBank";
import { dryRunDoc, resolveDrift, runDriftCheck } from "./DriftWatch";
import { questionHash } from "./BankParse";
import { listQuestions, getBlockKramdown } from "../../quiz/service/QuestionService";
import { refreshDocFor } from "./BankMigrate";

/**
 * 题目镜像漂移检测（自托管二期）：dryRunDoc 三态比对、runDriftCheck
 * 登记幂等、resolveDrift 收口。文档读通道用 vi.mock 喂假数据。
 */

vi.mock("../../quiz/service/QuestionService", () => ({
    listQuestions: vi.fn(),
    getBlockKramdown: vi.fn(),
}));
vi.mock("./BankMigrate", () => ({
    refreshDocFor: vi.fn(async () => 0),
}));

const fakeList = vi.mocked(listQuestions);
const fakeKramdown = vi.mocked(getBlockKramdown);
const fakeRefresh = vi.mocked(refreshDocFor);

/** node 测试环境无 window（vitest 不启 jsdom），QuestionBank.markDirty 的
 *  防抖定时器需要它——挂全局自指即可。 */
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

/** 题块桩：qid → kramdown 文本（hash 用真 questionHash 算）。 */
function stubDoc(blocks: Record<string, string>): void {
    fakeList.mockImplementation(async () => Object.keys(blocks).map((id) => ({ id, attempts: 0, wrongCount: 0 })));
    fakeKramdown.mockImplementation(async (id: string) => blocks[id] ?? "");
}

function rec(qid: string, kd: string): BankRecord {
    return {
        qid,
        kramdown: kd,
        type: "single",
        kpRefs: [],
        sourceDocId: "doc1",
        hash: questionHash(kd),
        stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
    };
}

const SAME = '题干原文\n{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}';
const EDITED = '题干被手改\n{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}';

describe("dryRunDoc · 三态比对（只读不写）", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("相同零漂移；手改变更；文档新增=新发现；题块删=gone；gen- 跳过", async () => {
        const bank = bankWith([rec("q1", SAME), rec("gen-x", SAME)]);
        stubDoc({ q1: SAME, q2: EDITED });
        const diff = await dryRunDoc(bank, "doc1");
        expect(diff?.changed).toEqual([]); // q1 相同
        expect(diff?.fresh).toEqual(["q2"]); // 文档有、题库无
        expect(diff?.gone).toEqual([]); // gen-x 不算 gone

        stubDoc({ q1: EDITED, q2: EDITED });
        const diff2 = await dryRunDoc(bank, "doc1");
        expect(diff2?.changed).toEqual(["q1"]);
        expect(diff2?.fresh).toEqual(["q2"]);

        stubDoc({ q2: EDITED }); // q1 块被删
        const diff3 = await dryRunDoc(bank, "doc1");
        expect(diff3?.changed).toEqual([]);
        expect(diff3?.gone).toEqual(["q1"]);
    });

    it("运行时统计属性不扰动指纹（作答后哈希稳定）", async () => {
        const bank = bankWith([rec("q1", SAME)]);
        // 文档读回形态：容器 IAL 里带上了旧统计属性（停写前的存量）
        stubDoc({ q1: SAME.replace('q="1"', 'q="1" custom-plugin-wengu-attempts="9" custom-plugin-wengu-right="0"') });
        const diff = await dryRunDoc(bank, "doc1");
        expect(diff?.changed).toEqual([]);
    });

    it("文档读取失败返回 undefined（调用方静默等下次）", async () => {
        fakeList.mockImplementation(async () => {
            throw new Error("doc gone");
        });
        const diff = await dryRunDoc(bankWith([]), "doc1");
        expect(diff).toBeUndefined();
    });
});

describe("runDriftCheck / resolveDrift · 登记与收口", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("非空漂移落 driftDocs；同构重复触发不重写；恢复一致自动清条目", async () => {
        const bank = bankWith([rec("q1", SAME)]);
        stubDoc({ q1: EDITED });
        await runDriftCheck(bank, "doc1");
        const data = await bank.all();
        expect(data.driftDocs?.doc1?.changed).toEqual(["q1"]);
        const first = data.driftDocs?.doc1;
        await runDriftCheck(bank, "doc1");
        expect((await bank.all()).driftDocs?.doc1).toBe(first); // 同构跳过

        stubDoc({ q1: SAME }); // 用户采纳或还原
        await runDriftCheck(bank, "doc1");
        expect((await bank.all()).driftDocs?.doc1).toBeUndefined();
    });

    it("ignore 只清登记；adopt 重扫入库并清登记", async () => {
        const bank = bankWith([rec("q1", SAME)]);
        stubDoc({ q1: EDITED });
        await runDriftCheck(bank, "doc1");
        await resolveDrift(bank, "doc1", "ignore");
        expect((await bank.all()).driftDocs?.doc1).toBeUndefined();
        expect(fakeRefresh).not.toHaveBeenCalled();

        stubDoc({ q1: EDITED });
        await runDriftCheck(bank, "doc1");
        await resolveDrift(bank, "doc1", "adopt");
        expect(fakeRefresh).toHaveBeenCalledWith(bank, "doc1");
        expect((await bank.all()).driftDocs?.doc1).toBeUndefined();
    });
});
