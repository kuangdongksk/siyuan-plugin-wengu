import { describe, expect, it } from "vitest";
import { BAR_AGG_MAX, barGroupSize, buildTimeBars, type TimeBarInput } from "./TimeBars";

/**
 * 用时图分组聚合的纯函数单测（Issue #155 块 B）。
 *
 * 边界口径：
 *  - 卷长 ≤ 60 逐题（现状不变）；
 *  - 61 起按 `ceil(len/60)` 题一组，保证组数 ≤ 60（243 → 5 题一组 49 组）；
 *  - 组柱高 = 组内**已答**总用时占比；类名取组内最差（错 > partial > 对 >
 *    全未答）；组 title = 「第 n–m 题 · 已答 x/y · 总用时 mm:ss」。
 */

const q = (label: number, sec: number, state: "right" | "wrong" | "partial" | "none"): TimeBarInput => ({
    label,
    sec,
    unanswered: state === "none",
    wrong: state === "wrong",
    partial: state === "partial",
});

/** 全对的卷子（用时逐个递增，便于断言高度）。 */
const right = (n: number): TimeBarInput[] => Array.from({ length: n }, (_, i) => q(i + 1, (i + 1) * 10, "right"));

const fmt = {
    fmtTitle: (x: TimeBarInput) => `T${x.label}`,
    fmtGroup: (g: { from: number; to: number; answered: number; total: number; sec: number }) =>
        `G${g.from}-${g.to}:${g.answered}/${g.total}:${g.sec}`,
};

describe("barGroupSize（Issue #155 块 B 边界）", () => {
    it("60 题及以下逐题", () => {
        expect(barGroupSize(0)).toBe(1);
        expect(barGroupSize(1)).toBe(1);
        expect(barGroupSize(BAR_AGG_MAX)).toBe(1); // 60 = 边界内
    });

    it("61 题起分组，且组数恒 ≤ 60", () => {
        expect(barGroupSize(61)).toBe(2); // 61 → 2 题一组 31 组
        expect(barGroupSize(120)).toBe(2);
        expect(barGroupSize(243)).toBe(5); // 真机 243 题 → 5 题一组 49 组
        expect(barGroupSize(600)).toBe(10);
    });

    it("组数上限（含整除/非整除两端）", () => {
        for (const len of [61, 62, 119, 120, 121, 243, 360, 361, 600, 3600]) {
            expect(Math.ceil(len / barGroupSize(len))).toBeLessThanOrEqual(60);
            expect(barGroupSize(len)).toBeGreaterThan(1);
        }
    });

    it("整除卷最后一组不短（120→60 组每组 2；1200→20 题一组 60 组）", () => {
        expect(barGroupSize(1200)).toBe(20);
        expect(Math.ceil(1200 / 20)).toBe(60);
    });
});

describe("buildTimeBars 逐题档（≤60，现状不变）", () => {
    it("空卷 → 空列", () => {
        expect(buildTimeBars([], fmt)).toEqual([]);
    });

    it("每列一题、标签为题号、不标记 grouped", () => {
        const cols = buildTimeBars(right(3), fmt);
        expect(cols.map((c) => c.label)).toEqual([1, 2, 3]);
        expect(cols.every((c) => !c.grouped)).toBe(true);
        expect(cols.map((c) => c.items.length)).toEqual([1, 1, 1]);
        expect(cols[0].items[0].title).toBe("T1");
    });

    it("高度 ∝ 单题用时（分母=最长），0 秒仍留矮柱下限 4", () => {
        const cols = buildTimeBars([q(1, 10, "right"), q(2, 20, "right"), q(3, 0, "none")], fmt);
        expect(cols[0].h).toBe(50);
        expect(cols[1].h).toBe(100);
        expect(cols[2].h).toBe(4);
    });

    it("类名按对/错/partial/未答分色", () => {
        const cols = buildTimeBars([q(1, 5, "right"), q(2, 5, "wrong"), q(3, 5, "partial"), q(4, 0, "none")], fmt);
        expect(cols.map((c) => c.cls)).toEqual([
            "wengu-bar-right",
            "wengu-bar-wrong",
            "wengu-bar-partial",
            "wengu-bar-muted",
        ]);
    });

    it("恰好 60 题仍逐题（不进聚合档）", () => {
        const cols = buildTimeBars(right(60), fmt);
        expect(cols.length).toBe(60);
        expect(cols.every((c) => !c.grouped)).toBe(true);
    });
});

describe("buildTimeBars 聚合档（>60）", () => {
    it("243 题 → 49 组（5 题一组），末组短、组内明细可逐题展开", () => {
        const cols = buildTimeBars(right(243), fmt);
        expect(cols.length).toBe(49);
        expect(cols.every((c) => c.grouped)).toBe(true);
        expect(cols.slice(0, 48).every((c) => c.items.length === 5)).toBe(true);
        expect(cols[0].items.map((x) => x.label)).toEqual([1, 2, 3, 4, 5]);
        // 243 = 48×5 + 3 ⇒ 末组 3 题（分组不许丢尾）
        expect(cols[48].items.map((x) => x.label)).toEqual([241, 242, 243]);
    });

    it("分组不丢题：各组明细拼起来与整卷逐题一致", () => {
        const labels = buildTimeBars(right(243), fmt).flatMap((c) => c.items.map((x) => x.label));
        expect(labels).toEqual(Array.from({ length: 243 }, (_, i) => i + 1));
    });

    it("61 题 → 31 组（2 题一组，整除/非整除两端都对）", () => {
        const cols = buildTimeBars(right(61), fmt);
        expect(cols.length).toBe(31);
        expect(cols[0].items.length).toBe(2);
        expect(cols[30].items.map((x) => x.label)).toEqual([61]);
    });

    it("组柱高 ∝ 组内已答总用时（未答不计入总用时；分母=各组最大值）", () => {
        // 60 组（2 题一组）：组 1 = 未答(0) + 已答 5 ⇒ 5s、已答 1/2；
        // 组 2 = 已答 15 + 已答 0 ⇒ 15s；其余全 0 ⇒ 参考组（下限 4%）
        const head = [q(1, 99, "none"), q(2, 5, "right"), q(3, 15, "right"), q(4, 0, "right")];
        const cols = buildTimeBars([...head, ...right(60).map((x) => ({ ...x, sec: 0, label: x.label + 4 }))], fmt);
        expect(cols.length).toBe(32); // 64 题 → ceil(64/60)=2 一组
        expect(cols[0].title).toBe("G1-2:1/2:5");
        expect(cols[0].h).toBe(33); // 5/15
        expect(cols[1].h).toBe(100); // 15/15
        expect(cols[2].h).toBe(4); // 全组 0 秒 → 矮柱下限
    });

    it("全组未答 → 矮柱下限 + muted（不因 0 时长消失）", () => {
        const list = Array.from({ length: 70 }, (_, i) => (i < 2 ? q(i + 1, 0, "none") : q(i + 1, 10, "right")));
        const cols = buildTimeBars(list, fmt);
        expect(cols[0].h).toBe(4);
        expect(cols[0].cls).toBe("wengu-bar-muted");
    });

    it("组色取组内最差：含错 → wrong、含 partial → partial、全对 → right", () => {
        // 首组（2 题）= states；其余 60 题全对 ⇒ 卷长 >60 进聚合档
        const mk = (states: Array<"right" | "wrong" | "partial" | "none">): TimeBarInput[] => {
            const head = states.map((s, i) => q(i + 1, 10, s));
            const tail = Array.from({ length: 60 }, (_, i) => q(i + states.length + 1, 10, "right"));
            return [...head, ...tail];
        };
        expect(buildTimeBars(mk(["wrong", "right"]), fmt)[0].cls).toBe("wengu-bar-wrong");
        expect(buildTimeBars(mk(["partial", "right"]), fmt)[0].cls).toBe("wengu-bar-partial");
        expect(buildTimeBars(mk(["right", "right"]), fmt)[0].cls).toBe("wengu-bar-right");
        // 未答不算「最差」——组内有一题答对时不是 muted
        expect(buildTimeBars(mk(["none", "right"]), fmt)[0].cls).toBe("wengu-bar-right");
        // 含错优先于含 partial
        expect(buildTimeBars(mk(["partial", "wrong"]), fmt)[0].cls).toBe("wengu-bar-wrong");
    });

    it("组 title 文案与组内明细的逐题 title 都拿到", () => {
        const cols = buildTimeBars(
            [q(1, 5, "right"), q(2, 0, "none"), ...right(60).map((x) => ({ ...x, label: x.label + 2 }))],
            fmt
        );
        // 62 题 → 2 题一组，31 组；首组 = 第 1–2 题
        expect(cols.length).toBe(31);
        expect(cols[0].title).toBe("G1-2:1/2:5");
        expect(cols[0].items.map((x) => x.title)).toEqual(["T1", "T2"]);
    });

    it("组内明细保留逐题语义（title/cls/高度各自独立）", () => {
        const cols = buildTimeBars([q(1, 10, "wrong"), q(2, 20, "right"), ...right(60)], fmt);
        expect(cols[0].items.map((x) => x.cls)).toEqual(["wengu-bar-wrong", "wengu-bar-right"]);
        expect(cols[0].items.map((x) => x.title)).toEqual(["T1", "T2"]);
    });
});
