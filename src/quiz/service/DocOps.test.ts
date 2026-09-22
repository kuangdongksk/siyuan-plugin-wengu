import { describe, expect, it } from "vitest";
import { reimportCfg, reimportResume } from "./DocOps";
import { hashContent, planReimportBySegs, qidsFromOffset } from "../../convert/service/source/SetSegments";
import { removeRecords } from "../../bank/data/BankSets";
import { QuestionBank as Bank } from "../../bank/data/QuestionBank";
import type { BankData } from "../../bank/data/QuestionBank";

// node 测试环境无 window，题库 markDirty 的防抖定时器走 globalThis 顶上
(globalThis as { window?: unknown }).window ??= globalThis;

/** 「删除此题集」/「重新导入」的纯逻辑面（内核 IO 不进单测，见
 *  vitest.config.ts；20260903 起题集=题库实体，planReimportRead/
 *  groupAttrsByBlock 随文档读写通道退役）。 */

describe("reimportCfg", () => {
    const src = "20260829090000-abcdefgh";

    it("prefs 上次选择优先，缺项回落设置默认", () => {
        const c = reimportCfg(
            src,
            { modelId: "m-last", fill: true, steps: false, know: "" },
            { convertModelId: "m-set", fillToChoice: false, bigToSteps: true, convertParallel: 2 }
        );
        expect(c.modelId).toBe("m-last");
        expect(c.fillToChoice).toBe(true); // prefs true 赢
        expect(c.bigToSteps).toBe(true); // prefs 缺省（false）回落设置 true
        expect(c.parallel).toBe(2);
    });

    it("prefs 全空时回落设置/默认值", () => {
        const c = reimportCfg(
            src,
            { modelId: "", fill: false, steps: false, know: "" },
            {
                convertModelId: "m-set",
            }
        );
        expect(c.modelId).toBe("m-set");
        expect(c.fillToChoice).toBe(false);
        expect(c.bigToSteps).toBe(false);
        expect(c.parallel).toBe(1);
    });

    it("默认无续跑（从头重转新题集）", () => {
        const c = reimportCfg(src, { modelId: "", fill: false, steps: false, know: "" });
        expect(c.resume).toBeUndefined();
    });

    it("并发批数收敛到 1~4；知识点串剥链接取 id、垃圾滤净", () => {
        const c = reimportCfg(
            src,
            {
                modelId: "",
                fill: false,
                steps: false,
                know: "siyuan://blocks/20260829080000-xyz12312 混入文字 20260829080000-abc12345,；junk",
            },
            { convertParallel: 9 }
        );
        expect(c.parallel).toBe(4);
        expect(c.knowRoots).toEqual(["20260829080000-xyz12312", "20260829080000-abc12345"]);
    });
});

describe("reimportResume", () => {
    it("进度记录带题集 id 才有断点（已生成部分是题库真实记录）", () => {
        expect(reimportResume({ offset: 5000, setId: "set-abc" })).toEqual({ offset: 5000, setId: "set-abc" });
    });

    it("无题集 id 的记录（旧形态）不带断点，按全量重转", () => {
        expect(reimportResume({ offset: 5000 })).toBeUndefined();
        expect(reimportResume(undefined)).toBeUndefined();
    });
});

/**
 * 重导的段级删除集（Issue #74 回归清单 2）：从第一条失配段起重转前，要删
 * 该段起（`srcKey` 偏移 >= 段起点）的记录，且**只删这些**——变更段之前的
 * 记录（含其作答统计/题单序）原样保留。删除集纯函数在 convert 侧的
 * SetSegments（qidsFromOffset），这里锁「题集内归属 + 组题记录一并计入 +
 * 材料/别集不误伤」的口径（DocOps 真机链走内核，删除动作复用
 * BankSets.removeRecords——该函数已有单测，本用例不重复）。
 */
describe("重导段级删除集（Issue #74）", () => {
    const data = (): BankData =>
        ({
            version: 1,
            records: {
                "gen-1": { qid: "gen-1", sourceDocId: "set-1", srcKey: "A:0" },
                "gen-2": { qid: "gen-2", sourceDocId: "set-1", srcKey: "A:12", group: "mat-1" },
                "gen-3": { qid: "gen-3", sourceDocId: "set-1", srcKey: "A:24", group: "mat-1" },
                "gen-x": { qid: "gen-x", sourceDocId: "set-2", srcKey: "A:0" },
            },
            collections: [],
            migratedDocs: [],
            hashed: {},
            knowRoots: [],
            folders: [],
            docStats: {},
            sets: {
                "set-1": { id: "set-1", title: "卷", qids: ["gen-1", "gen-2", "gen-3"], createdAt: 0 },
                "set-2": { id: "set-2", title: "别的卷", qids: ["gen-x"], createdAt: 0 },
            },
            materials: { "mat-1": { id: "mat-1", setId: "set-1", bodyMd: "阅读原文" } },
        }) as unknown as BankData;

    it("失配段之前的记录一条不删（保留其题单序与作答统计）", () => {
        expect(qidsFromOffset(data(), "set-1", 12)).toEqual(["gen-2", "gen-3"]);
    });

    it("组题记录（挂材料的）与普通记录同口径计入删除集", () => {
        const d = data();
        const qids = qidsFromOffset(d, "set-1", 24);
        expect(qids).toEqual(["gen-3"]);
        // 材料正文不在删除集里（孤儿材料无消费面，与既有口径一致）
        expect(d.materials!["mat-1"]).toBeDefined();
    });

    it("别的题集不受影响；无失配段（整篇哈希不同）时不删任何记录", () => {
        expect(qidsFromOffset(data(), "set-1", 999)).toEqual([]);
        expect(qidsFromOffset(data(), "set-2", 0)).toEqual(["gen-x"]);
    });

    it("删除集经 removeRecords 清掉记录/题单序/哈希索引（既有回收口径）", async () => {
        let cache: BankData | undefined;
        const bank = new Bank(
            async () => (cache ??= data()),
            async (v) => {
                cache = v;
            }
        );
        const before = await bank.all();
        const qids = qidsFromOffset(before, "set-1", 12);
        await removeRecords(bank, qids);
        const after = await bank.all();
        expect(Object.keys(after.records).filter((q) => q.startsWith("gen-"))).toEqual(["gen-1", "gen-x"]);
        expect(after.sets!["set-1"].qids).toEqual(["gen-1"]);
    });
});

/**
 * 重导路由收敛（Issue #212，20260922）：旧代 `H:` 结构切块增量链（三态分类 +
 * 逐块选弹窗 + 省费模式）整体退役后，无续跑记录时的决策面**只剩
 * `planReimportBySegs` 一支**——本组用纯函数锁住 DocOps 依赖的四条路由：
 * 未变更零动作 / 部分失配截断续转 / 无凭据整卷重转（含残余 `H:` 题集与
 * 存量题集，二者此刻在存储上无从区分、处置同为整卷重转）。
 *
 * DocOps 真机链要走内核读取与转换起跑（不进单测），故这里锁**它唯一的
 * 判据来源**：`reimportCfg`/`reimportResume` 之上再无别的分支条件。
 */
describe("重导路由（Issue #212 后只剩段表一支）", () => {
    /** 源：三段，段表首尾相接且覆盖到源末。 */
    const SRC = ["一、选择题", "第1题 求 $\\lim$", "A. 选项", "第2题 求导", "A. 选项二", "第3题 积分", ""].join("\n");
    const segOf = (s: number, e: number) => ({ s, e, h: hashContent(SRC.slice(s, e)) });
    const covered = { segs: [segOf(0, 12), segOf(12, 24), segOf(24, SRC.length)], srcContentHash: hashContent(SRC) };

    it("未变更（整篇哈希命中 + 段表覆盖到源末）→ 零动作，不删不烧", () => {
        expect(planReimportBySegs(SRC, covered)).toEqual({ kind: "unchanged" });
    });

    it("部分失配 → 从第一条失配段截断续转（其前记录保留）", () => {
        const edited = SRC.replace("第3题 积分", "第3题 求积分");
        const d = planReimportBySegs(edited, { ...covered, srcContentHash: hashContent(edited) });
        expect(d).toEqual({ kind: "partial", from: 24, deleteFrom: 24, keptSegs: 2 });
    });

    it("无凭据（残余 `H:` 题集 / 存量题集）→ 整卷重转，且不认整篇哈希", () => {
        // 非逐段链的题集没有任何段表；即便它带着某个哈希也不短路
        expect(planReimportBySegs(SRC, undefined)).toEqual({ kind: "full" });
        expect(planReimportBySegs(SRC, {})).toEqual({ kind: "full" });
        expect(planReimportBySegs(SRC, { segs: [], srcContentHash: hashContent(SRC) })).toEqual({ kind: "full" });
    });

    it("有续跑记录时优先续跑（决策不进 planReimportBySegs，由 reimportResume 门控）", () => {
        expect(reimportResume({ offset: 24, setId: "set-1" })).toBeDefined();
        expect(reimportResume({ offset: 24 })).toBeUndefined();
    });
});
