import { describe, expect, it } from "vitest";
import { WS_FIT_CLS, WS_MAIN_CLS, fitTargetOf, toggleFit, workspaceFits, type FitEl } from "./PanelFit";

/**
 * 「整页不滚动」宿主档位的单测（Issue #96，20260915 复审补越界防线；
 * Issue #146 随高度链回归一并复活）。本仓单测不带 DOM（vitest 环境 node），
 * 故用**假体记账**：每个假元素记下自己被 toggle 过的类与顺序，越界写法
 * （document 级全选 / 改别人的骨架）当场现形。
 */

/** 记账用假元素：classList 是真实 Set 语义 + 调用流水。 */
function fakeEl(cls: string[] = []): FitEl & {
    classes: Set<string>;
    toggles: string[];
    children: Record<string, FitEl>;
} {
    const classes = new Set(cls);
    const el = {
        classes,
        toggles: [] as string[],
        children: {} as Record<string, FitEl>,
        classList: {
            contains: (c: string): boolean => classes.has(c),
            toggle: (c: string, on: boolean): void => {
                el.toggles.push(`${on ? "+" : "-"}${c}`);
                if (on) classes.add(c);
                else classes.delete(c);
            },
        },
        querySelector: (sel: string): FitEl | null => el.children[sel] ?? null,
    };
    return el;
}

describe("workspaceFits（收内滚的工作区白名单）", () => {
    it("仅 AI 会话收内滚", () => {
        expect(workspaceFits("ai")).toBe(true);
        expect(workspaceFits("collection")).toBe(false);
        expect(workspaceFits("knowledge")).toBe(false);
        expect(workspaceFits("companion")).toBe(false);
        expect(workspaceFits(undefined)).toBe(false);
        expect(workspaceFits("")).toBe(false);
    });
});

describe("fitTargetOf（只认本面板那一份骨架）", () => {
    it("宿主自身即 .wengu-ws-main 时就是它", () => {
        const root = fakeEl(["wengu-main", WS_MAIN_CLS]);
        expect(fitTargetOf(root)).toBe(root);
    });

    it("壳多包一层时在宿主子树内下探一次，不越界", () => {
        const inner = fakeEl([WS_MAIN_CLS]);
        const root = fakeEl(["wengu-shell"]);
        root.children[`.${WS_MAIN_CLS}`] = inner;
        expect(fitTargetOf(root)).toBe(inner);
        expect(inner.toggles).toHaveLength(0); // 纯查询不改状态
    });

    it("找不到骨架时返回 undefined（宁可不收内滚也不乱改）", () => {
        expect(fitTargetOf(fakeEl(["wengu-shell"]))).toBeUndefined();
        expect(fitTargetOf(undefined)).toBeUndefined();
        expect(fitTargetOf(null)).toBeUndefined();
    });
});

describe("toggleFit（零开销 + 可选关闭 + 只碰传进来的那一个）", () => {
    it("开/关都打在同一个元素上，别的骨架零动作", () => {
        const mine = fakeEl([WS_MAIN_CLS]);
        const other = fakeEl([WS_MAIN_CLS]);
        toggleFit(mine, true);
        expect(mine.classes.has(WS_FIT_CLS)).toBe(true);
        expect(other.toggles).toHaveLength(0); // 越界（document 级全选）当场现形
        toggleFit(mine, false);
        expect(mine.classes.has(WS_FIT_CLS)).toBe(false);
        expect(other.toggles).toHaveLength(0);
        expect(mine.toggles).toEqual([`+${WS_FIT_CLS}`, `-${WS_FIT_CLS}`]);
    });

    it("el 为空 = 零动作（找不到骨架时的兜底路径）", () => {
        expect(() => toggleFit(undefined, true)).not.toThrow();
    });
});

describe("挂载/卸载配对（源码级锁：开关在 ai/SessionPanel 的挂钩处）", () => {
    it("挂载开档、卸载收档，且判定走 workspaceFits", async () => {
        const src = (await import("../SessionPanel.ts?raw")).default as string;
        expect(src).toContain("workspaceFits(");
        expect(src).toMatch(/mountAiSessionPanel[\s\S]*?fitHost\(workspaceFits\("ai"\), root\)/);
        expect(src).toMatch(/detachAiSessionPanel[\s\S]*?fitHost\(false\)/);
        // 关档必须在**卸载**路径里（漏关 ⇒ 下一块面板继承 overflow:hidden）
        const detach = src.slice(src.indexOf("export function detachAiSessionPanel"));
        expect(detach).toContain("fitHost(false)");
        // 禁 document 级全选
        expect(src).not.toContain("querySelectorAll");
        expect(src).not.toContain("document.");
    });
});
