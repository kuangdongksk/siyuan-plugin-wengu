import { describe, expect, it } from "vitest";
import { QuestionBank, type BankData, type BankRecord } from "./QuestionBank";
import { recordsByKeys } from "./BankRegen";

/** node 测试环境无 window（vitest 不启 jsdom），markDirty 的防抖定时器
 *  需要它——挂全局自指即可（同 BankRecording.test.ts）。 */
(globalThis as { window?: unknown }).window ??= globalThis;

/** 最小题库：两条记录仅 knowledge 措辞不同（洛必达 vs 洛必达法则）。 */
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

function rec(qid: string, knowledge?: string, chapter?: string): BankRecord {
    return {
        qid,
        kramdown: "",
        type: "single",
        ...(knowledge ? { knowledge } : {}),
        ...(chapter ? { chapter } : {}),
        kpRefs: [],
        sourceDocId: "doc1",
        hash: qid,
        stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
    };
}

describe("knowledgeIndex 标签归一（洛必达 = 洛必达法则）", () => {
    it("同考点两措辞并成一行，计数合并，显示名取标准名（正式写法）", async () => {
        const bank = bankWith([rec("q1", "洛必达"), rec("q2", "洛必达法则"), rec("q3", "极限")]);
        const idx = await bank.knowledgeIndex();
        const kn = idx.filter((r) => r.key.startsWith("kn:"));
        expect(kn).toHaveLength(2); // 洛必达两行并一行 + 极限一行
        const lhp = kn.find((r) => r.key === "kn:洛必达");
        expect(lhp?.count).toBe(2);
        expect(lhp?.title).toBe("洛必达法则"); // 标准名=信息最全写法，不是词干短名
    });

    it("collectQids 按归一键命中两措辞的全部题", async () => {
        const bank = bankWith([rec("q1", "洛必达"), rec("q2", "洛必达法则"), rec("q3", "极限")]);
        const qids = await bank.collectQids(["kn:洛必达"]);
        expect(qids.sort()).toEqual(["q1", "q2"]);
    });

    it("recordsByKeys 同样归并（针对性生成取模板）", async () => {
        const bank = bankWith([rec("q1", "洛必达"), rec("q2", "洛必达法则"), rec("q3", "极限")]);
        const recs = await recordsByKeys(bank, ["kn:洛必达法则"]); // 旧键也能命中
        expect(recs.map((r) => r.qid).sort()).toEqual(["q1", "q2"]);
    });

    it("kpRefs 优先于 knowledge：有引用的题不进 kn 键", async () => {
        const withKp = rec("q1", "洛必达");
        withKp.kpRefs = [{ id: "20240101000000-abcdefg", title: "洛必达法则" }];
        const bank = bankWith([withKp, rec("q2", "洛必达")]);
        const idx = await bank.knowledgeIndex();
        expect(idx.some((r) => r.key === "kp:20240101000000-abcdefg")).toBe(true);
        // q2 仍走 kn；q1 因 kpRefs 优先不再产生 kn 键
        expect(idx.filter((r) => r.key === "kn:洛必达")).toHaveLength(1);
    });
});

describe("版本闩（version>1 = 更新版插件写的库，停写保护）", () => {
    it("内存按空起步且 createCollection/flush 全程零落盘——防旧版覆写清库", async () => {
        let saved = 0;
        const bank = new QuestionBank(
            async () => ({ version: 2, records: { q1: rec("q1") } }),
            async () => {
                saved++;
            }
        );
        const data = await bank.all();
        expect(Object.keys(data.records)).toHaveLength(0); // 不识别的数据不进内存
        await bank.createCollection("测试", ["q1"], "manual");
        await bank.flush();
        expect(saved).toBe(0); // markDirty/flush 双闸，一次都不写
    });

    it("version 1 正常装载照常落盘（非闩）", async () => {
        let saved = 0;
        const bank = new QuestionBank(
            async () => undefined,
            async () => {
                saved++;
            }
        );
        await bank.createCollection("测试", [], "manual");
        await bank.flush();
        expect(saved).toBe(1);
    });
});
