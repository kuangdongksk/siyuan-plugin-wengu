import { describe, expect, it } from "vitest";
import { fitTargetOf, toggleFit, WS_FIT_CLS, workspaceFits, type FitEl } from "./PanelFit";

describe("整页不滚动（Issue #96）的宿主档位判定", () => {
    it("AI 会话工作区收内滚；其余工作区（含未定义）一律不自作主张", () => {
        expect(workspaceFits("ai")).toBe(true);
        for (const ws of ["drill", "collection", "knowledge", "companion", "", undefined] as const)
            expect(workspaceFits(ws)).toBe(false);
    });

    it("档类名与 scss 规则逐字一致（改这里必须同步改 rail.scss 的规则选择器）", () => {
        expect(WS_FIT_CLS).toBe("wengu-ws-main--fit");
    });
});

/** 假体元素（单测不带 DOM）：记录收到的 token，供越界断言。 */
function fakeEl(cls: string, children: FitEl[] = []): FitEl & { has(c: string): boolean } {
    const set = new Set(cls.split(/\s+/).filter(Boolean));
    return {
        classList: {
            contains: (c) => set.has(c),
            toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
        },
        querySelector: (sel) => children.find((c) => c.classList.contains(sel.replace(/^\./, ""))) ?? null,
        has: (c) => set.has(c),
    };
}

describe("收内滚档位只落在本面板那一份骨架上（20260915 复审修正）", () => {
    it("宿主自身即主区时直接命中它", () => {
        const root = fakeEl("wengu-main wengu-ws-main");
        expect(fitTargetOf(root)).toBe(root);
    });

    it("宿主不是主区时只在宿主子树内下探，绝不越出本面板", () => {
        const main = fakeEl("wengu-ws-main");
        const root = fakeEl("wengu-ws-page", [main]);
        expect(fitTargetOf(root)).toBe(main);

        const stranger = fakeEl("wengu-main wengu-ws-main"); // 别人页签的骨架
        const host = fakeEl("wengu-ws-page"); // 本面板子树里没有主区
        toggleFit(fitTargetOf(host), true);
        expect(host.has(WS_FIT_CLS)).toBe(false);
        expect(stranger.has(WS_FIT_CLS)).toBe(false); // 别人一份不动
    });

    it("开关成对：卸载只收自己开的那一份，不误关已被他人打开的档", () => {
        const mine = fakeEl("wengu-main wengu-ws-main");
        const other = fakeEl("wengu-main wengu-ws-main");

        toggleFit(fitTargetOf(mine), true);
        expect(mine.has(WS_FIT_CLS)).toBe(true);
        expect(other.has(WS_FIT_CLS)).toBe(false); // 全局 querySelectorAll 会把它一起打开

        toggleFit(fitTargetOf(other), true); // 另一个面板自己开档
        toggleFit(fitTargetOf(mine), false); // 本面板卸载
        expect(mine.has(WS_FIT_CLS)).toBe(false);
        expect(other.has(WS_FIT_CLS)).toBe(true); // 不被误关
    });

    it("找不到主区（空/null）时零动作，宁可不收内滚也不乱改", () => {
        expect(fitTargetOf(undefined)).toBeUndefined();
        expect(fitTargetOf(null)).toBeUndefined();
        expect(() => toggleFit(undefined, true)).not.toThrow();
    });
});
