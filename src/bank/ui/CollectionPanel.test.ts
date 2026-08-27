import { describe, expect, it } from "vitest";
import { summarizeSessions } from "./CollectionPanel";

describe("summarizeSessions", () => {
    it("空会话 = 没刷过", () => {
        expect(summarizeSessions([])).toEqual({ lastAt: undefined, answered: 0, correct: 0 });
    });

    it("聚合轮次并取最近一次开始时间", () => {
        const s = summarizeSessions([
            { startedAt: 1000, answered: 10, correct: 8 },
            { startedAt: 2000, answered: 20, correct: 19 },
            { startedAt: 1500, answered: 5, correct: 1 },
        ]);
        expect(s).toEqual({ lastAt: 2000, answered: 35, correct: 28 });
    });
});
