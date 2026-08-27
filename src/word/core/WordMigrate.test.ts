import { describe, expect, it } from "vitest";
import { BUILTIN_BOOK, keyOf, wordKey, type WenguWordBookData } from "../service/WordBook";
import { migrateV2 } from "./WordMigrate";
import { confKey } from "./WordStore";

/** 迷你书：两条词形差异（空格/连字符/撇号/大小写）检验归一化。 */
const BOOK: WenguWordBookData = {
    version: 1,
    id: "test",
    title: "测试书",
    words: [
        { w: "ability", m: "n. 能力" },
        { w: "Ad Hoc", m: "临时" },
        { w: "co-operate", m: "v. 合作" },
        { w: "it's", m: "pron. 它的" },
    ],
};

describe("wordKey 归一化词头", () => {
    it("小写 + 去空格/连字符/撇号（与拼写判定同规则）", () => {
        expect(wordKey("Ability")).toBe("ability");
        expect(wordKey("ad hoc")).toBe("adhoc");
        expect(wordKey("Co-Operate")).toBe("cooperate");
        expect(wordKey("it's")).toBe("its");
    });
});

describe("migrateV2 下标→词头", () => {
    it("逐词字段全部换 key、cursor 丢弃、标量保留", () => {
        const p = migrateV2(
            {
                version: 2,
                cursor: 3,
                words: { "0": { d: 5, s: 4, due: 9 }, "9": { d: 5, s: 8, due: 1 } },
                ladder: { "1": [2, 1] },
                reviews: { "0": [{ ts: 1, rt: 3, dl: 0 }] },
                mistakes: { "2": { count: 2, lastTs: 7, note: "x" } },
                simple: { "3": 1 },
                familiar: {},
                starred: { "0": 1, "3": 1 },
                log: { "2026-08-01": [3, 4] },
                today: { key: "2026-08-01", newCount: 3, revCount: 4 },
                timing: { "0": [{ mode: "spell", ms: 100, over: 0 }] },
                notes: { "1": "记法" },
                groupSize: 15,
                windowCap: 6,
            },
            BOOK
        );
        expect(p.version).toBe(3);
        expect("cursor" in p).toBe(false);
        expect(Object.keys(p.words)).toEqual([keyOf(BOOK, 0)]); // 越界下标 9 丢弃
        expect(Object.keys(p.ladder)).toEqual([wordKey("Ad Hoc")]);
        expect(Object.keys(p.reviews)).toEqual(["ability"]);
        expect(Object.keys(p.mistakes)).toEqual(["cooperate"]);
        expect(Object.keys(p.simple)).toEqual(["its"]);
        expect(Object.keys(p.starred).sort()).toEqual(["ability", "its"]);
        expect(Object.keys(p.timing)).toEqual(["ability"]);
        expect(Object.keys(p.notes)).toEqual(["adhoc"]);
        expect(p.groupSize).toBe(15);
        expect(p.windowCap).toBe(6);
        expect(p.log["2026-08-01"]).toEqual([3, 4]);
    });

    it("易混组 ids 与 confNotes key 同步换算，坏组员丢弃", () => {
        const p = migrateV2(
            {
                version: 2,
                cursor: 0,
                words: {},
                ladder: {},
                reviews: {},
                mistakes: {},
                simple: {},
                familiar: {},
                starred: {},
                log: {},
                today: { key: "", newCount: 0, revCount: 0 },
                confusables: [
                    { ids: [0, 1], src: "evidence" },
                    { ids: [0, 99], src: "evidence" }, // 99 越界 → 组员剩 1 无 raw → 丢弃
                    { ids: [2], src: "evidence", raw: "cooperation" }, // 单成员带 raw 保留
                ],
                confNotes: { "0,1": "笔记", "0,99": "坏笔记" },
            },
            BOOK
        );
        expect(p.confusables).toEqual([
            { ids: ["ability", "adhoc"], src: "evidence" },
            { ids: ["cooperate"], src: "evidence", raw: "cooperation" },
        ]);
        expect(p.confNotes).toEqual({ [confKey(["ability", "adhoc"])]: "笔记" });
    });

    it("空/坏数据按空 v3 起步（各字段形状完整）", () => {
        const p = migrateV2(undefined, BUILTIN_BOOK);
        expect(p.version).toBe(3);
        expect(p.words).toEqual({});
        expect(p.ladder).toEqual({});
        expect(p.today).toEqual({ key: "", newCount: 0, revCount: 0 });
    });
});
