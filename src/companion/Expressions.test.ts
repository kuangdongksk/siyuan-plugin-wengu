import { describe, expect, it } from "vitest";
import { EXPR_FACES, EXPR_KEYS, normalizeExpr, WenguExpr } from "./Expressions";

describe("Expressions", () => {
    it("枚举九个且不重复", () => {
        expect(EXPR_KEYS.length).toBe(9);
        expect(new Set(EXPR_KEYS).size).toBe(9);
    });

    it("每个表情都有非空的眼与嘴片段", () => {
        for (const k of EXPR_KEYS) {
            expect(EXPR_FACES[k].eyes.trim().length).toBeGreaterThan(0);
            expect(EXPR_FACES[k].mouth.trim().length).toBeGreaterThan(0);
        }
    });

    it("normalizeExpr：合法键原样、中文别名规整、大小写不敏感", () => {
        expect(normalizeExpr("happy")).toBe(WenguExpr.Happy);
        expect(normalizeExpr("开心")).toBe(WenguExpr.Happy);
        expect(normalizeExpr("  Sad ")).toBe(WenguExpr.Sad);
        expect(normalizeExpr("HAPPY")).toBe(WenguExpr.Happy);
        expect(normalizeExpr("恨铁不成钢")).toBe(WenguExpr.Push);
    });

    it("normalizeExpr：认不出的返回 undefined（调用方兜底）", () => {
        expect(normalizeExpr("excited")).toBeUndefined();
        expect(normalizeExpr("")).toBeUndefined();
        expect(normalizeExpr(undefined)).toBeUndefined();
    });
});
