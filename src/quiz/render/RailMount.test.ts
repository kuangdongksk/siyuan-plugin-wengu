import { describe, expect, it } from "vitest";
import { normalizeWorkspace } from "./RailMount";

describe("normalizeWorkspace（20260901 拆分后的 prefs 规整）", () => {
    it("合法五值透传", () => {
        for (const ws of ["drill", "collection", "knowledge", "ai", "companion"] as const)
            expect(normalizeWorkspace(ws)).toBe(ws);
    });

    it("未知/缺省回刷题", () => {
        expect(normalizeWorkspace("whatever")).toBe("drill");
        expect(normalizeWorkspace(undefined)).toBe("drill");
    });
});
