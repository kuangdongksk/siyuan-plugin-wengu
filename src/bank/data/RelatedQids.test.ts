import { describe, expect, it } from "vitest";
import { relatedQidsOf, relatedRecordsOf } from "./RelatedQids";
import { hasAnswerData, kpIdsOf, qidSetOf, recordKeysOf, weakKeysOf, weakLinesOf } from "./RelatedData";
import type { BankRecord } from "./QuestionBank";
import type { WeakPointEntry } from "./WeaknessStore";
import { weakKeys } from "./WeaknessStore";
import type { WenguQuestion } from "../../types";

/**
 * 相关题收集口径（Issue #44 验收 7）：related 活视图专题题单与弹窗列表
 * 共用的纯函数——**含跨题集**与**「sourceDocId 命中但无 kpRefs」**用例
 * （后者正是不能复用 col-kp-{id} 的原因）。
 */

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

const kp = (id: string, title = id) => ({ id, title });

describe("relatedRecordsOf 相关题收集口径", () => {
    it("sourceDocId 命中即入选——该题无 kpRefs 也不漏", () => {
        const records = [
            rec("q1", { sourceDocId: "docA" }), // 无 kpRefs 的直接挂名题
            rec("q2", { sourceDocId: "docB", kpRefs: [kp("h1")] }),
        ];
        const out = relatedRecordsOf(records, "docA", new Map());
        expect(out.map((r) => r.qid)).toEqual(["q1"]);
    });

    it("kpRefs 落在该文档下即入选（跨题集：sourceDocId 是别的题集）", () => {
        const records = [
            rec("q1", { sourceDocId: "set-1", kpRefs: [kp("h1")] }),
            rec("q2", { sourceDocId: "set-2", kpRefs: [kp("h2")] }), // 别文档的引用
            rec("q3", { sourceDocId: "set-2", kpRefs: [kp("h3"), kp("h1")] }), // 混挂
        ];
        const roots = new Map([
            ["h1", "docA"],
            ["h2", "docB"],
            ["h3", "docB"],
        ]);
        const out = relatedRecordsOf(records, "docA", roots);
        expect(out.map((r) => r.qid)).toEqual(["q1", "q3"]); // 跨 3 个题集里的 2 条
    });

    it("两条判据是并集，同一条命中多次只出一次", () => {
        const records = [rec("q1", { sourceDocId: "docA", kpRefs: [kp("h1"), kp("h2")] })];
        const roots = new Map([
            ["h1", "docA"],
            ["h2", "docA"],
        ]);
        expect(relatedRecordsOf(records, "docA", roots).map((r) => r.qid)).toEqual(["q1"]);
    });

    it("题单序=记录序（不排序）——与弹窗列表同源同序", () => {
        const records = [
            rec("q3", { sourceDocId: "docA" }),
            rec("q1", { sourceDocId: "docA" }),
            rec("q2", { sourceDocId: "docA" }),
        ];
        expect(relatedQidsOf(records, "docA", new Map())).toEqual(["q3", "q1", "q2"]);
    });

    it("空 docId 恒空（未定位到根文档时不误收全库）", () => {
        const records = [rec("q1", { sourceDocId: "" })];
        expect(relatedQidsOf(records, "", new Map())).toEqual([]);
    });

    it("无命中返回空（不回退全库）", () => {
        const records = [rec("q1", { sourceDocId: "docB", kpRefs: [kp("h9")] })];
        expect(relatedQidsOf(records, "docA", new Map([["h9", "docZ"]]))).toEqual([]);
    });
});

describe("RelatedData 分析材料纯函数", () => {
    it("recordKeysOf：kpRefs 优先，缺则 kn:/ch:，都无=空", () => {
        expect(recordKeysOf(rec("q1", { kpRefs: [kp("h1"), kp("h2")] }))).toEqual({
            kpIds: ["h1", "h2"],
            weakKeys: ["kp:h1", "kp:h2"],
        });
        expect(recordKeysOf(rec("q2", { knowledge: "洛必达" }))).toEqual({ kpIds: [], weakKeys: ["kn:洛必达"] });
        expect(recordKeysOf(rec("q3", { chapter: "极限" }))).toEqual({ kpIds: [], weakKeys: ["ch:极限"] });
        expect(recordKeysOf(rec("q4"))).toEqual({ kpIds: [], weakKeys: [] });
    });

    it("recordKeysOf：kn 键走 knKey 归一，与 WeaknessStore.weakKeys 逐字相等", () => {
        // 回归（Issue #44 复审）：题目写「洛必达法则」、薄弱表键归一成「洛必达」，
        // 原文直拼会匹配不上 → AI 分析的薄弱段静默漏条目。
        const r = rec("q1", { knowledge: "洛必达法则" });
        const q: WenguQuestion = { id: "q1", knowledge: "洛必达法则", attempts: 1, wrongCount: 1 };
        expect(recordKeysOf(r).weakKeys).toEqual(weakKeys(q).map((k) => k.key));
        expect(recordKeysOf(r).weakKeys).toEqual(["kn:洛必达"]);
        // 纯装饰文本（归一后空串）与 WeaknessStore 一致地不产键。
        expect(recordKeysOf(rec("q2", { knowledge: "《》" })).weakKeys).toEqual([]);
        expect(weakKeys({ id: "q2", knowledge: "《》", attempts: 1, wrongCount: 0 })).toEqual([]);
    });

    it("hasAnswerData：attempts 全 0 = 尚无作答数据（AI 不得编造薄弱点）", () => {
        expect(hasAnswerData([{ attempts: 0 }, { attempts: 0 }])).toBe(false);
        expect(hasAnswerData([{ attempts: 0 }, { attempts: 3 }])).toBe(true);
        expect(hasAnswerData([])).toBe(false);
    });

    it("weakKeysOf / kpIdsOf 去重", () => {
        const rows = [
            { kpIds: ["h1", "h2"], weakKeys: ["kp:h1"] },
            { kpIds: ["h2"], weakKeys: ["kp:h2", "kp:h1"] },
        ];
        expect(weakKeysOf(rows).sort()).toEqual(["kp:h1", "kp:h2"]);
        expect(kpIdsOf(rows)).toEqual(["h1", "h2"]);
    });

    it("weakLinesOf：只留命中键且错次>0 的条目，按错次降序", () => {
        const entry = (key: string, wrong: number, extra: Partial<WeakPointEntry> = {}): WeakPointEntry => ({
            key,
            title: key,
            wrong,
            total: wrong + 1,
            lastWrongAt: 0,
            causes: {},
            ...extra,
        });
        const points = [
            entry("kp:h1", 2, { causes: { calc: 1, concept: 3 }, aiNote: "符号易错" }),
            entry("kp:h2", 5),
            entry("kn:洛必达", 9), // 不在键集里
            entry("kp:h3", 0), // 零错次：不进摘要
        ];
        const out = weakLinesOf(points, ["kp:h1", "kp:h2", "kp:h3"]);
        expect(out.map((w) => w.title)).toEqual(["kp:h2", "kp:h1"]);
        expect(out[1]).toMatchObject({ wrong: 2, total: 3, topCause: "concept", aiNote: "符号易错" });
    });

    it("weakLinesOf：零命中/空键集返回空（调用方据此省略 prompt 该段）", () => {
        expect(weakLinesOf([], ["kp:h1"])).toEqual([]);
        expect(weakLinesOf([{ key: "kp:h1", title: "t", wrong: 1, total: 1, lastWrongAt: 0, causes: {} }], [])).toEqual(
            []
        );
    });

    it("qidSetOf：qid 集（回顾筛选的输入）", () => {
        expect([...qidSetOf([{ qid: "q1" }, { qid: "q2" }, { qid: "q1" }])].sort()).toEqual(["q1", "q2"]);
    });
});
