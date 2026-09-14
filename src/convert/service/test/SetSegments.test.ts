import { describe, expect, it } from "vitest";
import {
    advanceSegs,
    cursorOffsetOfKey,
    hashContent,
    planReimportBySegs,
    qidsFromOffset,
    segViewOf,
    type SetSeg,
} from "../source/SetSegments";
import type { BankData, BankSet } from "../../../bank/data/QuestionBank";

/**
 * 题集源级哈希 + 分段边界表（Issue #74）纯逻辑面（内核 IO 不进单测，见
 * vitest.config.ts）。两条硬口径在这里锁死：
 *  - **偏移口径**与既有 `A:<偏移>` 键、断点游标同一字符串同一单位（剥
 *    IAL 后 kramdown 的字符偏移）；
 *  - **判定顺序**里的「无记录」三段（整篇命中 / 第 k 段失配 / 无 segs）
 *    ——「有续跑记录优先」那条在 DocOps 调用侧（reimportResume），见下组。
 */

/** 建段表（按段首尾相接切源文本，模拟 ConvertBatch 每批 flush 的追加）。 */
function segsOf(src: string, ends: number[]): SetSeg[] {
    const out: SetSeg[] = [];
    let s = 0;
    for (const e of ends) {
        out.push({ s, e, h: hashContent(src.slice(s, e)) });
        s = e;
    }
    return out;
}

const SRC = ["一、选择题", "第1题 求 $\\lim$", "A. 选项", "第2题 求导", "A. 选项二", "第3题 积分", ""].join("\n");

describe("hashContent / cursorOffsetOfKey", () => {
    it("确定性、无随机：同输入同哈希，跨调用稳定", () => {
        expect(hashContent("abc")).toBe(hashContent("abc"));
        expect(hashContent("abc")).not.toBe(hashContent("abd"));
    });

    it("空白归一：边界缩进/换行不影响同一段原文的哈希", () => {
        expect(hashContent("甲 乙")).toBe(hashContent("  甲\n乙  "));
    });

    it("A:<偏移> 键解析；H: 结构键与空值不归本模块管", () => {
        expect(cursorOffsetOfKey("A:1234")).toBe(1234);
        expect(cursorOffsetOfKey("H:第1章/#0")).toBeUndefined();
        expect(cursorOffsetOfKey("A:")).toBeUndefined();
        expect(cursorOffsetOfKey(undefined)).toBeUndefined();
    });
});

describe("advanceSegs（每批 flush 追加）", () => {
    it("首段自 segStart 起，段首尾相接覆盖 [0, 游标]", () => {
        const segs = advanceSegs(undefined, 0, 10, SRC);
        expect(segs).toHaveLength(1);
        expect(segs[0]).toEqual({ s: 0, e: 10, h: hashContent(SRC.slice(0, 10)) });
    });

    it("连续多段无空洞无重叠；e 取**实际落库游标**（不信任调用方给的段首）", () => {
        let segs = advanceSegs(undefined, 0, 12, SRC);
        segs = advanceSegs(segs, 12, 24, SRC);
        segs = advanceSegs(segs, 30, 40, SRC); // 段首参数与上段 e 不符：以段表为准
        expect(segs.map((x) => [x.s, x.e])).toEqual([
            [0, 12],
            [12, 24],
            [24, 40],
        ]);
        for (let i = 1; i < segs.length; i++) expect(segs[i].s).toBe(segs[i - 1].e);
        for (const seg of segs) expect(seg.h).toBe(hashContent(SRC.slice(seg.s, seg.e)));
    });

    it("续跑接续追加：既有段表原样保留（段首自末段 e 起）", () => {
        const prior = segsOf(SRC, [12, 24]);
        const next = advanceSegs(prior, 24, 36, SRC);
        expect(next).toHaveLength(3);
        expect(next.slice(0, 2)).toEqual(prior); // 既有段逐字不变
        expect(next[2]).toEqual({ s: 24, e: 36, h: hashContent(SRC.slice(24, 36)) });
    });

    it("零步长/回退不落段（AI 兜底推进的异常窗口不进段表）", () => {
        const segs = segsOf(SRC, [12]);
        expect(advanceSegs(segs, 12, 12, SRC)).toEqual(segs);
        expect(advanceSegs(segs, 12, 8, SRC)).toEqual(segs);
    });

    it("纯函数：不改入参（调用方可能仍持有旧表）", () => {
        const segs = segsOf(SRC, [12]);
        const snapshot = JSON.parse(JSON.stringify(segs));
        advanceSegs(segs, 12, 20, SRC);
        expect(segs).toEqual(snapshot);
    });

    it("段首回退（同游标重复 flush）：按既有段裁掉重叠区旧段，段表恒互不重叠", () => {
        const segs = advanceSegs(segsOf(SRC, [12]), 0, 20, SRC);
        expect(segs.map((x) => [x.s, x.e])).toEqual([
            [0, 12],
            [12, 20],
        ]);
        for (let i = 1; i < segs.length; i++) expect(segs[i].s).toBe(segs[i - 1].e);
    });
});

describe("planReimportBySegs（重导判定决策矩阵）", () => {
    const ends = [12, 24, 36];
    const set = (): BankSet => ({
        id: "set-1",
        title: "卷",
        qids: [],
        createdAt: 0,
        srcContentHash: hashContent(SRC),
        segs: segsOf(SRC, ends),
    });

    it("① 全部命中（整篇哈希相同）→ 零动作", () => {
        expect(planReimportBySegs(SRC, set())).toEqual({ kind: "unchanged" });
    });

    it("② 第 k 段失配 → 从该段起点起重转（k=1）", () => {
        const s = set();
        const changed = SRC.slice(0, s.segs![1].s) + "第2题 改成求极限" + SRC.slice(s.segs![1].e);
        const d = planReimportBySegs(changed, s);
        expect(d).toEqual({ kind: "partial", from: s.segs![1].s, deleteFrom: s.segs![1].s, keptSegs: 1 });
    });

    it("② 首段失配 → keptSegs=0、从 0 起重转", () => {
        const s = set();
        const changed = "改过的开头\n" + SRC.slice(12);
        expect(planReimportBySegs(changed, s)).toEqual({
            kind: "partial",
            from: 0,
            deleteFrom: 0,
            keptSegs: 0,
        });
    });

    it("③ 文末追加（全段命中但整篇哈希不同）→ 从末段 e 续转，一段不删", () => {
        const s = set();
        const tail = s.segs![s.segs!.length - 1].e;
        const appended = SRC + "第4题 追加的新题\n";
        expect(planReimportBySegs(appended, s)).toEqual({
            kind: "partial",
            from: tail,
            deleteFrom: tail,
            keptSegs: s.segs!.length,
        });
        // 反面证据：确实是从**已落库游标**（段表覆盖的末尾）起，而不是源末
        expect(tail).toBe(36);
        expect(tail).toBeLessThan(SRC.length);
    });

    it("④ 无 segs（存量/旧记录）→ 现状行为（整卷重转），整篇哈希不参与短路", () => {
        const s = set();
        delete s.segs;
        expect(planReimportBySegs(SRC, s)).toEqual({ kind: "full" });
        expect(planReimportBySegs(SRC, undefined)).toEqual({ kind: "full" });
        expect(planReimportBySegs(SRC, { segs: [], srcContentHash: hashContent(SRC) })).toEqual({ kind: "full" });
    });

    it("⑤ 哈希字段缺失：整篇短路不成立，段表照常逐段比对", () => {
        const s = set();
        delete s.srcContentHash;
        // 未变更的源 + 无整篇哈希：全段命中 → 从末段续转（没有任何段要删）
        expect(planReimportBySegs(SRC, s)).toEqual({
            kind: "partial",
            from: 36,
            deleteFrom: 36,
            keptSegs: 3,
        });
        // 无哈希且无 segs → 整卷
        delete s.segs;
        expect(planReimportBySegs(SRC, s)).toEqual({ kind: "full" });
    });

    it("源被删短：越出源尾的段必失配 → 从**第一条**失配段起重转", () => {
        const s = set();
        // 截到 20 字符：段表 [24,46) 整段落在源外（必失配）；其前的段按截短
        // 后的实际文本重算——命中的段（如 [0,12)）仍被保留，故这里只断言
        // 「决策起点落在第一条真正失配的段上」与「保留段数自洽」。
        const shorter = SRC.slice(0, 20);
        const d = planReimportBySegs(shorter, s) as { kind: string; from: number; keptSegs: number };
        expect(d.kind).toBe("partial");
        const k = s.segs!.findIndex((x) => hashContent(shorter.slice(x.s, x.e)) !== x.h);
        expect(k).toBe(1); // 第 2 段 [12,24) 也已被截断 → 它就是第一条失配段
        expect(d.from).toBe(s.segs![k].s);
        expect(d.keptSegs).toBe(k);
        // 末段（落在源外）确实失配——「源被删短」不会被当成「未变更」
        expect(hashContent(shorter.slice(s.segs![2].s, s.segs![2].e))).not.toBe(s.segs![2].h);
        expect(planReimportBySegs(shorter, s)).not.toEqual({ kind: "unchanged" });
    });

    it("多段失配时只认**第一条**：其后的段不再比对（重转从该处一路续写）", () => {
        const s = set();
        const changed = SRC.slice(0, 4) + "改" + SRC.slice(5, 24) + "也改了" + SRC.slice(27);
        expect(planReimportBySegs(changed, s)).toEqual({ kind: "partial", from: 0, deleteFrom: 0, keptSegs: 0 });
    });

    it("空白扰动不算变更（同一段原文的边界空白不误报失配）", () => {
        const s = set();
        const padded = SRC.replace("第2题 求导", "第2题   求导");
        expect(planReimportBySegs(padded, s)).toEqual({ kind: "unchanged" });
    });
});

describe("qidsFromOffset（删除集）", () => {
    const bank = (): BankData =>
        ({
            version: 1,
            records: {
                "gen-a": { qid: "gen-a", sourceDocId: "set-1", srcKey: "A:0" },
                "gen-b": { qid: "gen-b", sourceDocId: "set-1", srcKey: "A:12" },
                "gen-c": { qid: "gen-c", sourceDocId: "set-1", srcKey: "A:24" },
                "gen-d": { qid: "gen-d", sourceDocId: "set-1" }, // 无源键（材料/异常）
                "gen-e": { qid: "gen-e", sourceDocId: "set-1", srcKey: "H:第1章/#0" }, // 结构键
                "gen-x": { qid: "gen-x", sourceDocId: "set-2", srcKey: "A:0" }, // 别的题集
            },
            collections: [],
            migratedDocs: [],
            hashed: {},
            knowRoots: [],
            folders: [],
            knowHidden: [],
            docStats: {},
            materials: {},
            sets: {
                "set-1": {
                    id: "set-1",
                    title: "卷",
                    qids: ["gen-a", "gen-b", "gen-c", "gen-d", "gen-e"],
                    createdAt: 0,
                },
                "set-2": { id: "set-2", title: "另一卷", qids: ["gen-x"], createdAt: 0 },
            },
        }) as unknown as BankData;

    it("偏移 >= from 的 qid（含该段起点那条），题单序", () => {
        expect(qidsFromOffset(bank(), "set-1", 12)).toEqual(["gen-b", "gen-c"]);
        expect(qidsFromOffset(bank(), "set-1", 0)).toEqual(["gen-a", "gen-b", "gen-c"]);
    });

    it("无源键/结构键的记录不误删（偏移无从比较）；别的题集不受影响", () => {
        expect(qidsFromOffset(bank(), "set-1", 24)).toEqual(["gen-c"]);
        expect(qidsFromOffset(bank(), "set-1", 999)).toEqual([]);
        expect(qidsFromOffset(bank(), "nope", 0)).toEqual([]);
    });
});

describe("segViewOf", () => {
    it("取字段、缺字段即 undefined（存量题集零迁移）", () => {
        const full: BankSet = {
            id: "s",
            title: "",
            qids: [],
            createdAt: 0,
            srcContentHash: "h",
            segs: [{ s: 0, e: 1, h: "x" }],
        };
        expect(segViewOf(full)).toEqual({ srcContentHash: "h", segs: [{ s: 0, e: 1, h: "x" }] });
        expect(segViewOf({ id: "s", title: "", qids: [], createdAt: 0 })).toEqual({
            srcContentHash: undefined,
            segs: undefined,
        });
        expect(segViewOf(undefined)).toBeUndefined();
    });
});
