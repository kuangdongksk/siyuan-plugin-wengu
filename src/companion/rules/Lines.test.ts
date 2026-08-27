import { describe, expect, it } from "vitest";
import { LINES, PERSONA_KEYS, normalizePersona, pickLine, type LineEvent } from "./Lines";

describe("Lines", () => {
    it("四个人设可规整，未识别回落 gentle", () => {
        expect(PERSONA_KEYS).toEqual(["gentle", "sharp", "genki", "calm"]);
        expect(normalizePersona("sharp")).toBe("sharp");
        expect(normalizePersona("genki")).toBe("genki");
        expect(normalizePersona("calm")).toBe("calm");
        expect(normalizePersona("别的")).toBe("gentle");
        expect(normalizePersona(undefined)).toBe("gentle");
    });

    it("每个人设 × 每个事件都有非空台词（不允许静默回退）", () => {
        const events = Object.keys(LINES.gentle) as LineEvent[];
        expect(events.length).toBeGreaterThanOrEqual(12);
        for (const p of PERSONA_KEYS) {
            for (const ev of events) {
                expect(LINES[p][ev], `${p}/${ev}`).toBeDefined();
                expect(LINES[p][ev]!.length).toBeGreaterThan(0);
                for (const s of LINES[p][ev]!) expect(s.trim().length).toBeGreaterThan(0);
            }
        }
    });

    it("pickLine 替换 {n}/{c}/{sec} 占位（变体随机，断言不残留+多抽覆盖）", () => {
        const draws = Array.from({ length: 40 }, () => pickLine("gentle", "wrong-streak", 7));
        for (const s of draws) expect(s).not.toContain("{n}");
        expect(new Set(draws).size).toBeGreaterThan(1); // 变体确实在轮换
        expect(draws.some((s) => s.includes("7"))).toBe(true); // 占位版被替换
        for (let i = 0; i < 40; i++) {
            expect(pickLine("calm", "quiz-fast", undefined, undefined, 6)).not.toContain("{sec}");
        }
    });
});
