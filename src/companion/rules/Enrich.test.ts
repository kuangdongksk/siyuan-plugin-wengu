import { describe, expect, it } from "vitest";
import { enrichGapMs, QUIZ_FAST_GAP_MS, QUIZ_SLOW_PACE_MS } from "./Enrich";

describe("enrichGapMs 答题节奏→AI触发间隔", () => {
    it("样本不足按快节奏保守", () => {
        expect(enrichGapMs(undefined)).toBe(QUIZ_FAST_GAP_MS);
    });

    it("慢节奏（≥60s/题）每题触发", () => {
        expect(enrichGapMs(QUIZ_SLOW_PACE_MS)).toBe(0);
        expect(enrichGapMs(QUIZ_SLOW_PACE_MS + 1)).toBe(0);
        expect(enrichGapMs(180_000)).toBe(0);
    });

    it("快节奏压到两分半", () => {
        expect(enrichGapMs(0)).toBe(QUIZ_FAST_GAP_MS);
        expect(enrichGapMs(QUIZ_SLOW_PACE_MS - 1)).toBe(QUIZ_FAST_GAP_MS);
        expect(enrichGapMs(10_000)).toBe(QUIZ_FAST_GAP_MS);
    });
});
