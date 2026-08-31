import { describe, expect, it } from "vitest";
import { normalizeWorkspace } from "./RailMount";

describe("normalizeWorkspace（□4 rail 合并后的 prefs 规整）", () => {
    it("合法四值透传", () => {
        for (const ws of ["drill", "knowledge", "ai", "companion"] as const) expect(normalizeWorkspace(ws)).toBe(ws);
    });

    it("旧「专题管理」值落知识（清单已并入）；未知/缺省回刷题", () => {
        expect(normalizeWorkspace("collection")).toBe("knowledge");
        expect(normalizeWorkspace("whatever")).toBe("drill");
        expect(normalizeWorkspace(undefined)).toBe("drill");
    });
});
