import { describe, expect, it } from "vitest";
import { anchorsOf } from "../flow/ClueFlow";
import {
    buildCanonMap,
    canonOffsetOf,
    canonRangeOf,
    canonSlice,
    canonSlots,
    canonSlotsComplete,
    pushClueRange,
    remapCanon,
    removeClueRange,
    verifyCanonSlice,
    type CanonMap,
} from "./ClueCanon";

/**
 * 权威坐标系（Issue #52 二期验收 6）：Range→权威坐标换算、切片校验、
 * 轮间重算映射、clueRanges 对齐维护（删/增）、装载 backfill 口径。
 *
 * 全部纯函数（DOM 观测在 MaterialDecorate）——与 GlossDom.test 同款：
 * 单测不启 jsdom，坐标口径在这里锁死。
 */

/** 一段基础渲染产物形态的节点表：[节点文本, 是否权威]。 */
function mapOf(nodes: [string, boolean][]): { map: CanonMap; texts: string[]; isCanon: boolean[] } {
    const texts = nodes.map((n) => n[0]);
    const isCanon = nodes.map((n) => n[1]);
    const picked = nodes.filter((n) => n[1]).map((n) => n[0]);
    const idx = nodes.map((_, i) => i).filter((i) => isCanon[i]);
    return { map: buildCanonMap(picked, idx), texts, isCanon };
}

describe("buildCanonMap / canonOffsetOf：权威串与节点表", () => {
    it("权威串 = 权威节点原文按序拼接（非权威节点不参与）", () => {
        const { map } = mapOf([
            ["第一段文字", true],
            ["1·n.资金", false], // 词表联动上标（非权威）
            ["第二段文字", true],
        ]);
        expect(map.text).toBe("第一段文字第二段文字");
        expect(map.nodes).toEqual([
            { start: 0, end: 5 },
            { start: 5, end: 10 },
        ]);
        expect(map.nodeIndex).toEqual([0, 2]);
    });

    it("节点内偏移换算成权威偏移；非权威节点换算不出（null）", () => {
        const { map } = mapOf([
            ["abc", true],
            ["XX", false],
            ["def", true],
        ]);
        expect(canonOffsetOf(map, 0, 1)).toBe(1);
        expect(canonOffsetOf(map, 2, 1)).toBe(4);
        expect(canonOffsetOf(map, 1, 0)).toBeNull();
    });

    it("空节点表（无权威文本）也是合法坐标系", () => {
        const map = buildCanonMap([], []);
        expect(map.text).toBe("");
        expect(canonOffsetOf(map, 0, 0)).toBeNull();
    });
});

describe("canonRangeOf：Range → 权威坐标（D2 主路径）", () => {
    it("两端都在权威节点内 ⇒ 精确换算", () => {
        const { map } = mapOf([["abcdef", true]]);
        expect(canonRangeOf(map, { nodeIndex: 0, offset: 1 }, { nodeIndex: 0, offset: 4 })).toEqual({ s: 1, e: 4 });
    });

    it("跨节点（跨段/跨 **加粗**）取两端各自权威偏移", () => {
        const { map } = mapOf([
            ["foo", true],
            ["bar", true],
            ["baz", true],
        ]);
        expect(canonRangeOf(map, { nodeIndex: 0, offset: 1 }, { nodeIndex: 2, offset: 2 })).toEqual({ s: 1, e: 8 });
    });

    it("端点落在非权威节点（上标）⇒ 钳到最近权威边界", () => {
        // [0]abc [1]1·n.非权威 [2]def：从「abc 内 offset 3」到「非权威节点尾」
        const { map } = mapOf([
            ["abc", true],
            ["1·n.", false],
            ["def", true],
        ]);
        // 起点在权威内、终点在非权威节点上 ⇒ 终点钳到它前面权威节点末尾
        expect(canonRangeOf(map, { nodeIndex: 0, offset: 1 }, { nodeIndex: 1, offset: 3 })).toEqual({ s: 1, e: 3 });
        // 起点落在非权威节点（表外节点下标）⇒ 钳到其后最近权威起点
        expect(canonRangeOf(map, { nodeIndex: 1, offset: 0 }, { nodeIndex: 2, offset: 2 })).toEqual({ s: 3, e: 5 });
    });

    it("reversed 端点（拖选反向）被归一成升序区间", () => {
        const { map } = mapOf([["abcdef", true]]);
        expect(canonRangeOf(map, { nodeIndex: 0, offset: 4 }, { nodeIndex: 0, offset: 1 })).toEqual({ s: 1, e: 4 });
    });

    it("空表/退化区间返回 null ⇒ 调用侧走降级链", () => {
        const empty = buildCanonMap([], []);
        expect(canonRangeOf(empty, { nodeIndex: 0, offset: 0 }, { nodeIndex: 0, offset: 3 })).toBeNull();
        const { map } = mapOf([["abcdef", true]]);
        expect(canonRangeOf(map, { nodeIndex: 0, offset: 2 }, { nodeIndex: 0, offset: 2 })).toBeNull();
    });
});

describe("切片校验（D5 防漂移自愈）", () => {
    it("权威切片 === 存储 text ⇒ 通过", () => {
        const { map } = mapOf([["abcdef", true]]);
        expect(canonSlice(map, { s: 1, e: 4 })).toBe("bcd");
        expect(verifyCanonSlice(map, { s: 1, e: 4 }, "bcd")).toBe(true);
    });

    it("材料被增量重转导致漂移 ⇒ 不等即拦（不亮错位置）", () => {
        const { map } = mapOf([["abcdef", true]]);
        expect(verifyCanonSlice(map, { s: 1, e: 4 }, "xyz")).toBe(false);
    });

    it("越界/空区间一律拦下", () => {
        const { map } = mapOf([["abc", true]]);
        expect(verifyCanonSlice(map, { s: -1, e: 2 }, "ab")).toBe(false);
        expect(verifyCanonSlice(map, { s: 1, e: 9 }, "bc")).toBe(false);
        expect(verifyCanonSlice(map, { s: 2, e: 2 }, "")).toBe(false);
    });
});

describe("canonSlots：坐标 → 节点内区间（跨节点展开）", () => {
    it("单节点内区间直接映射", () => {
        const { map } = mapOf([["abcdef", true]]);
        expect(canonSlots(map, { s: 1, e: 4 })).toEqual([{ node: 0, from: 1, to: 4 }]);
    });

    it("跨节点区间逐节点取交集展开（跨段/跨加粗施工用）", () => {
        const { map } = mapOf([
            ["ab", true],
            ["cd", true],
        ]);
        expect(canonSlots(map, { s: 1, e: 3 })).toEqual([
            { node: 0, from: 1, to: 2 },
            { node: 1, from: 0, to: 1 },
        ]);
        expect(canonSlotsComplete(map, { s: 1, e: 3 })).toBe(true);
    });

    it("区间越过权威表外 ⇒ 仍展开但标记不完整（调用侧降级）", () => {
        const { map } = mapOf([["ab", true]]);
        expect(canonSlotsComplete(map, { s: 1, e: 9 })).toBe(false);
        expect(canonSlots(map, { s: 1, e: 1 })).toEqual([]);
    });
});

describe("remapCanon：轮间重算映射（装饰改节点表后以权威坐标为中介重建）", () => {
    it("词表 wrap 切短节点 + 插入非权威上标 ⇒ 权威表按坐标重算", () => {
        // 装饰前：abc（权威） + def（权威）
        const base = buildCanonMap(["abc", "def"], [0, 1]);
        // 装饰后（词形联动把 abc 内的 ab 包进 <u>，并插入上标 1·n.）：
        // [0]"ab"（<u> 内，权威） [1]"1·n."（上标，非权威） [2]"c"（权威） [3]"def"（权威）
        const next = remapCanon(base, ["ab", "1·n.", "c", "def"], [true, false, true, true]);
        expect(next.text).toBe("abcdef");
        expect(next.nodeIndex).toEqual([0, 2, 3]);
        expect(next.nodes).toEqual([
            { start: 0, end: 2 },
            { start: 2, end: 3 },
            { start: 3, end: 6 },
        ]);
        // 上标不在表里（不可锚定），权威切片不受装饰影响
        expect(canonOffsetOf(next, 1, 0)).toBeNull();
        expect(next.text.slice(0, 6)).toBe("abcdef");
    });

    it("线索 mark 插入后重算：mark 内文本仍属权威（可再次施工/校验）", () => {
        const base = buildCanonMap(["abcdef"], [0]);
        const next = remapCanon(base, ["ab", "cdef"], [true, true]);
        expect(next.nodes).toEqual([
            { start: 0, end: 2 },
            { start: 2, end: 6 },
        ]);
        expect(canonSlice(next, { s: 1, e: 4 })).toBe("bcd");
    });

    it("节点表整体改序（同文重复）不会把坐标算飞（只增不减）", () => {
        const base = buildCanonMap(["aa", "aa"], [0, 1]);
        const next = remapCanon(base, ["a", "1", "a", "a", "a"], [true, false, true, true, true]);
        expect(next.nodes.map((n) => n.end)).toEqual([1, 2, 3, 4]);
    });
});

describe("clueRanges 对齐维护（D3：下标与 clues 严格对齐）", () => {
    it("新标线索：文本与坐标同下标推进", () => {
        const texts: string[] = [];
        const ranges: ({ s: number; e: number } | undefined)[] = [];
        pushClueRange(texts, ranges, "第一段", { s: 0, e: 3 });
        pushClueRange(texts, ranges, "第二段", { s: 5, e: 8 });
        expect(texts).toEqual(["第一段", "第二段"]);
        expect(ranges).toEqual([
            { s: 0, e: 3 },
            { s: 5, e: 8 },
        ]);
    });

    it("惰性升格：存量线索（无坐标）先补 undefined 占位，下标仍严格对齐", () => {
        const texts = ["存量甲", "存量乙"];
        const ranges: ({ s: number; e: number } | undefined)[] = [];
        pushClueRange(texts, ranges, "新线索", { s: 9, e: 12 });
        expect(texts.length).toBe(3);
        expect(ranges.length).toBe(3);
        expect(ranges[0]).toBeUndefined();
        expect(ranges[1]).toBeUndefined();
        expect(ranges[2]).toEqual({ s: 9, e: 12 });
    });

    it("降级新增（文本匹配没求到坐标）⇒ 该位 undefined，不挤位", () => {
        const texts: string[] = ["甲"];
        const ranges: ({ s: number; e: number } | undefined)[] = [{ s: 0, e: 1 }];
        pushClueRange(texts, ranges, "乙", undefined);
        expect(texts).toEqual(["甲", "乙"]);
        expect(ranges).toEqual([{ s: 0, e: 1 }, undefined]);
    });

    it("删除第 i 条：两数组同下标同步删", () => {
        const texts = ["甲", "乙", "丙"];
        const ranges: ({ s: number; e: number } | undefined)[] = [{ s: 0, e: 1 }, undefined, { s: 4, e: 5 }];
        removeClueRange(texts, ranges, 1);
        expect(texts).toEqual(["甲", "丙"]);
        expect(ranges).toEqual([
            { s: 0, e: 1 },
            { s: 4, e: 5 },
        ]);
    });

    it("删除时坐标数组缺失（存量会话未升格）也不影响文本侧删除", () => {
        const texts = ["甲", "乙"];
        removeClueRange(texts, undefined, 0);
        expect(texts).toEqual(["乙"]);
    });

    it("装载 backfill 口径：旧会话无 clueRanges = undefined = 全走 fallback", () => {
        const session: {
            clues: Record<string, string[]>;
            clueRanges?: Record<string, ({ s: number; e: number } | undefined)[]>;
        } = { clues: { q1: ["甲", "乙"] } };
        // 不 bump version、不改名、只加 optional 字段：装载侧读到 undefined
        // 即「全走 fallback」（不设 backfill 动作——测的是形态契约）
        expect(session.clueRanges).toBeUndefined();
        expect(anchorsOf(session, "q1")).toEqual([{ text: "甲" }, { text: "乙" }]);
    });

    it("锚点拼装：色号平行数组（Issue #57）按下标配对；默认黄不建键", () => {
        const session: {
            clues: Record<string, string[]>;
            clueColors?: Record<string, number[]>;
        } = {
            clues: { q1: ["甲", "乙", "丙"] },
            // 只有第一条显式选过色（第二条缺位 = 默认黄）
            clueColors: { q1: [2, -1, 3] },
        };
        expect(anchorsOf(session, "q1")).toEqual([{ text: "甲", color: 2 }, { text: "乙" }, { text: "丙", color: 3 }]);
    });

    it("旧会话无色号表 = undefined：锚点形态与改造前逐字相同（存量零迁移）", () => {
        const session: { clues: Record<string, string[]>; clueColors?: Record<string, number[]> } = {
            clues: { q1: ["甲"] },
        };
        expect(session.clueColors).toBeUndefined();
        expect(anchorsOf(session, "q1")).toEqual([{ text: "甲" }]);
    });

    it("锚点拼装：坐标数组与文本数组按下标配对（缺位=只有文本锚点）", () => {
        const session: {
            clues: Record<string, string[]>;
            clueRanges?: Record<string, ({ s: number; e: number } | undefined)[]>;
        } = {
            clues: { q1: ["甲", "乙", "丙"] },
            clueRanges: { q1: [{ s: 0, e: 1 }, undefined, { s: 9, e: 12 }] },
        };
        expect(anchorsOf(session, "q1")).toEqual([
            { text: "甲", range: { s: 0, e: 1 } },
            { text: "乙" },
            { text: "丙", range: { s: 9, e: 12 } },
        ]);
    });
});
