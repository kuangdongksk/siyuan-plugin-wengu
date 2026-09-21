import { describe, expect, it } from "vitest";
import { isJevEnabled } from "./enabled";

describe("Jev 总闸（isJevEnabled）", () => {
    it("key 非空且开关未关 → 开", () => {
        expect(isJevEnabled({ jevKey: "sk-1" })).toBe(true);
        expect(isJevEnabled({ jevKey: "sk-1", jevEnabled: true })).toBe(true);
    });

    it("开关显式关 → 关（即使有 key）", () => {
        expect(isJevEnabled({ jevKey: "sk-1", jevEnabled: false })).toBe(false);
    });

    it("key 空/空白/缺失 → 关", () => {
        expect(isJevEnabled({ jevKey: "" })).toBe(false);
        expect(isJevEnabled({ jevKey: "   " })).toBe(false);
        expect(isJevEnabled({})).toBe(false);
        expect(isJevEnabled(undefined)).toBe(false);
    });
});
