import { describe, expect, it } from "vitest";
import {
    alignClueColors,
    CLUE_COLORS,
    clueColorAt,
    clueColorDef,
    clueColorStyle,
    DEFAULT_CLUE_COLOR,
    isPickedColor,
    longestColorKey,
    pushClueColor,
    removeClueColor,
    resetThemeVarsProbe,
    setClueColorAt,
} from "./ClueColor";
import { renderClueRow } from "./MaterialFlow";

/**
 * 线索多色纯逻辑（Issue #57）：色板定义、`clueColors` 平行数组的下标对齐
 * 维护（增/删/改）、颜色 → 内联样式换算、重叠合并归属、chips 圆点契约。
 * 全部与 DOM 无关（node 环境；样式串只是字符串断言）。
 */

describe("色板定义（主题 CSS 变量，零配置）", () => {
    it("四色 + key 就是落库值序（0..3）", () => {
        expect(CLUE_COLORS.map((c) => c.key)).toEqual([0, 1, 2, 3]);
    });

    it("每格走思源卡片色变量（info/success/warning/error）", () => {
        expect(CLUE_COLORS.map((c) => c.cssVar)).toEqual([
            "--b3-card-info",
            "--b3-card-success",
            "--b3-card-warning",
            "--b3-card-error",
        ]);
    });

    it("每格有色名 i18n 键（缺词条会露出原始键名）", () => {
        for (const c of CLUE_COLORS) expect(c.labelKey).toMatch(/^clueColor/);
    });

    it("默认色号 = -1（不占四色序）", () => {
        expect(DEFAULT_CLUE_COLOR).toBe(-1);
        expect(CLUE_COLORS.some((c) => c.key === DEFAULT_CLUE_COLOR)).toBe(false);
    });
});

describe("clueColorDef / isPickedColor（值域容错）", () => {
    it("四色 key 各回各自定义", () => {
        for (const c of CLUE_COLORS) expect(clueColorDef(c.key)).toBe(c);
    });

    it("默认色号/越界/非整数一律 undefined", () => {
        for (const k of [DEFAULT_CLUE_COLOR, 4, -2, 1.5, NaN, undefined]) {
            expect(clueColorDef(k)).toBeUndefined();
            expect(isPickedColor(k)).toBe(false);
        }
    });
});

describe("clueColorAt（读侧口径：缺位/越界 = 默认黄）", () => {
    it("有值取该值；无表（题从未选过色）全默认黄", () => {
        expect(clueColorAt([2, 0], 0)).toBe(2);
        expect(clueColorAt([2, 0], 1)).toBe(0);
        expect(clueColorAt(undefined, 0)).toBe(DEFAULT_CLUE_COLOR);
    });

    it("数组短于线索数（历史上只给前几条选过色）：缺位回默认黄", () => {
        expect(clueColorAt([3], 1)).toBe(DEFAULT_CLUE_COLOR);
        expect(clueColorAt([], 0)).toBe(DEFAULT_CLUE_COLOR);
    });
});

describe("clueColors 下标对齐维护（与 clues 严格对齐）", () => {
    it("align：补默认色占位到等长；多余的截掉", () => {
        const c: number[] = [1];
        alignClueColors(c, 3);
        expect(c).toEqual([1, DEFAULT_CLUE_COLOR, DEFAULT_CLUE_COLOR]);
        alignClueColors(c, 2);
        expect(c).toEqual([1, DEFAULT_CLUE_COLOR]);
    });

    it("align：undefined（该题从未选色）不建表——存量零迁移", () => {
        const c: number[] | undefined = undefined;
        alignClueColors(c, 5);
        expect(c).toBeUndefined();
    });

    it("push：undefined 不建表（调用方据此保持零迁移）", () => {
        const c: number[] | undefined = undefined;
        pushClueColor(c, 0, 2);
        expect(c).toBeUndefined();
    });

    it("push：已建表 ⇒ 先补存量位占位再 push，下标继续对齐", () => {
        const c: number[] = [1];
        pushClueColor(c, 1, 3); // 存量 1 条（下标 0 已占）
        expect(c).toEqual([1, 3]);
        // 存量 3 条（历史上只选过前两条）时补齐占位再 push
        pushClueColor(c, 3, 0);
        expect(c).toEqual([1, 3, DEFAULT_CLUE_COLOR, 0]);
    });

    it("set：首次给第 i 条选色 ⇒ 补齐 [0, i] 的占位", () => {
        const c: number[] = [];
        setClueColorAt(c, 2, 3);
        expect(c).toEqual([DEFAULT_CLUE_COLOR, DEFAULT_CLUE_COLOR, 3]);
    });

    it("set：改已存在的位 = 就地覆写（不增长度）", () => {
        const c = [1, 2];
        setClueColorAt(c, 1, 0);
        expect(c).toEqual([1, 0]);
    });

    it("set：负下标零动作（chip 的 data-clue 异常时不越界写）", () => {
        const c = [1];
        setClueColorAt(c, -1, 3);
        expect(c).toEqual([1]);
    });

    it("删：同下标同步删；删中间位时后面的颜色前移（验收 3 重排）", () => {
        const c = [0, 1, 2, 3];
        removeClueColor(c, 1);
        expect(c).toEqual([0, 2, 3]);
        // 「文本数组」侧同口径：删完剩下的线索与颜色仍逐位对齐
        const texts = ["a", "b", "c", "d"];
        texts.splice(1, 1);
        expect(texts.map((_, i) => c[i])).toEqual([0, 2, 3]);
    });

    it("删：undefined（未建表）与越界下标零动作", () => {
        const c: number[] | undefined = undefined;
        removeClueColor(c, 0);
        expect(c).toBeUndefined();
        const e = [1];
        removeClueColor(e, 5);
        expect(e).toEqual([1]);
    });

    it("增删组合后长度与文本数组恒等（下标对齐不变量）", () => {
        // 复刻 ClueFlow.addClue 的推进口径：首次带色建表 → 补占位 → push；
        // 主路径（不带色）在已建表的题上也必须等长推进
        const texts: string[] = [];
        const colors: number[] = [];
        const add = (t: string, color?: number): void => {
            if (color !== undefined && !colors.length) alignClueColors(colors, texts.length);
            if (color !== undefined) pushClueColor(colors, texts.length, color);
            texts.push(t);
            alignClueColors(colors, texts.length);
        };
        add("甲", 0);
        add("乙");
        add("丙", 2);
        expect(colors).toEqual([0, DEFAULT_CLUE_COLOR, 2]);
        expect(colors.length).toBe(texts.length);
        removeClueColor(colors, 0);
        texts.splice(0, 1);
        expect(colors.length).toBe(texts.length);
        expect(colors).toEqual([DEFAULT_CLUE_COLOR, 2]);
    });
});

describe("clueColorStyle（内联样式，主题变量）", () => {
    it("无 DOM（node 单测环境）时返回空串 —— 落回 scss 默认，不写解不出的 var()", () => {
        resetThemeVarsProbe();
        expect(clueColorStyle(0)).toBe("");
        expect(clueColorStyle(undefined)).toBe("");
    });

    it("主题变量可用时按 key 出「背景 + 前景」两个变量", () => {
        // 造一个最小 DOM 桩：getComputedStyle 回带值的自定义属性
        const g = globalThis as { document?: unknown; getComputedStyle?: unknown };
        const prevDoc = g.document;
        const prevGcs = g.getComputedStyle;
        g.document = {
            body: { appendChild: (): void => {} },
            createElement: () => ({ style: {}, remove(): void {} }),
        };
        g.getComputedStyle = () => ({
            getPropertyValue: (n: string) => (n === "--b3-card-warning" ? " #f5f5f5 " : ""),
        });
        resetThemeVarsProbe();
        try {
            expect(clueColorStyle(0)).toBe("background-color:var(--b3-card-info);color:var(--b3-card-info-color)");
            expect(clueColorStyle(3)).toBe("background-color:var(--b3-card-error);color:var(--b3-card-error-color)");
            // 默认色/越界 ⇒ 默认黄（不是空串：主题可用时默认也要显式落黄）
            expect(clueColorStyle(DEFAULT_CLUE_COLOR)).toBe(
                "background-color:var(--b3-card-warning);color:var(--b3-card-warning-color)"
            );
            expect(clueColorStyle(99)).toBe(
                "background-color:var(--b3-card-warning);color:var(--b3-card-warning-color)"
            );
        } finally {
            resetThemeVarsProbe();
            g.document = prevDoc;
            g.getComputedStyle = prevGcs;
        }
    });
});

describe("longestColorKey（合并归属，Issue #57 验收 5）", () => {
    const colors = [1, 2, 3];

    it("取区间最长那条的色号（与 mergeMarkSlots 的 text 归属同源）", () => {
        expect(
            longestColorKey(
                [
                    { index: 0, len: 8 },
                    { index: 1, len: 20 },
                ],
                colors
            )
        ).toBe(2);
    });

    it("同长取先出现的那条（入参顺序稳定）", () => {
        expect(
            longestColorKey(
                [
                    { index: 0, len: 6 },
                    { index: 2, len: 6 },
                ],
                colors
            )
        ).toBe(1);
    });

    it("空候选/下标未知 ⇒ 默认黄", () => {
        expect(longestColorKey([], colors)).toBe(DEFAULT_CLUE_COLOR);
        expect(longestColorKey([{ index: -1, len: 10 }], colors)).toBe(DEFAULT_CLUE_COLOR);
    });
});

describe("renderClueRow 圆点契约（Issue #57）", () => {
    /** 最小行元素桩（只用到 setAttribute/removeAttribute/innerHTML/querySelector）。 */
    const rowStub = (): { el: HTMLElement; html: () => string } => {
        let html = "";
        const el = {
            hidden: false,
            setAttribute(): void {},
            removeAttribute(): void {},
            querySelector(): null {
                return null;
            },
            get innerHTML(): string {
                return html;
            },
            set innerHTML(v: string) {
                html = v;
            },
        } as unknown as HTMLElement;
        return { el, html: () => html };
    };
    const t = (k: string): string => k;

    it("逐条 chip 前缀同色圆点（色值来自主题变量，行内 style）", () => {
        const { el, html } = rowStub();
        renderClueRow(el, t, ["甲", "乙"], [2, 3]);
        const out = html();
        expect(out).toContain("wengu-clue-dot");
        expect(out).toContain("background-color:var(--b3-card-warning)");
        expect(out).toContain("background-color:var(--b3-card-error)");
        // 圆点仍是原 chip 壳（两击删除的 data-clue 契约不变）
        expect(out).toContain('data-clue="0"');
        expect(out).toContain('data-clue="1"');
    });

    it("colors 缺省（题从未选色）时逐条默认黄 —— 观感与改造前一致", () => {
        const { el, html } = rowStub();
        renderClueRow(el, t, ["甲"]);
        expect(html()).toContain("background-color:var(--b3-card-warning)");
    });

    it("colors 短于 clues 时缺位回默认黄（不越界、不出空 style）", () => {
        const { el, html } = rowStub();
        renderClueRow(el, t, ["甲", "乙"], [1]);
        const out = html();
        expect(out).toContain("background-color:var(--b3-card-success)");
        expect(out).toContain("background-color:var(--b3-card-warning)");
        expect(out).not.toContain("var(undefined)");
    });

    it("圆点在 chip **内**（chips 色点改色靠 closest 链反查 chip 与题目）", () => {
        const { el, html } = rowStub();
        renderClueRow(el, t, ["甲"], [0]);
        const out = html();
        const chipAt = out.indexOf('class="wengu-clue-chip"');
        const dotAt = out.indexOf("wengu-clue-dot");
        const chipEnd = out.indexOf("</span>", chipAt);
        expect(chipAt).toBeGreaterThanOrEqual(0);
        expect(dotAt).toBeGreaterThan(chipAt);
        expect(dotAt).toBeLessThan(chipEnd);
    });

    it("空线索清空行（圆点一并消失）", () => {
        const { el, html } = rowStub();
        renderClueRow(el, t, []);
        expect(html()).toBe("");
    });
});
