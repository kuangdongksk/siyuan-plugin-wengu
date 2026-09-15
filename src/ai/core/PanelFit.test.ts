import { describe, expect, it } from "vitest";
import { WS_FIT_CLS, workspaceFits } from "./PanelFit";

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
