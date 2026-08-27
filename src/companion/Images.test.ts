import { describe, expect, it } from "vitest";
import { EXPR_KEYS, WenguExpr } from "./Expressions";
import { exprImageNames, imageUrl } from "./Images";

describe("Images", () => {
    it("每个表情的候选名：首名=英文枚举键，且至少一个中文别名", () => {
        for (const k of EXPR_KEYS) {
            const names = exprImageNames(k);
            expect(names[0]).toBe(k);
            expect(names.slice(1).some((n) => /[\u4e00-\u9fff]/.test(n))).toBe(true);
        }
        expect(exprImageNames(WenguExpr.Happy)).toContain("开心");
        expect(exprImageNames(WenguExpr.Sad)).toContain("失落");
        expect(exprImageNames(WenguExpr.Surprise)).toContain("惊讶");
    });

    it("imageUrl 归一斜杠并逐段编码（中文文件名可命中）", () => {
        expect(imageUrl("assets/wengu/yuwen", "happy", "png")).toBe("/assets/wengu/yuwen/happy.png");
        expect(imageUrl("/assets/x/", "sad", "jpg")).toBe("/assets/x/sad.jpg");
        expect(imageUrl("assets/语文", "开心", "png")).toBe(
            `/assets/${encodeURIComponent("语文")}/${encodeURIComponent("开心")}.png`
        );
    });
});
