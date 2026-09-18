import { describe, expect, it } from "vitest";
import { answeredQuestionCount, isUnfinishedRound, lastUnfinishedRound } from "./ResumePicker";
import type { WenguSession } from "./HistoryStore";

/**
 * 「未完成轮」候选查找（Issue #169）：判据是「有作答且未收卷」，查找是
 * **从尾向前第一个命中**——判据与查找都不许漂移（漂移一次就是恢复入口
 * 要么被空轮埋掉、要么造出幽灵入口）。
 */

function round(over: Partial<WenguSession> = {}): WenguSession {
    return {
        id: "r1",
        docId: "d1",
        startedAt: 1,
        mode: "countUp",
        elapsedSec: 0,
        answered: 1,
        correct: 0,
        results: [{ qid: "q1", submitted: "A", ok: true }],
        ...over,
    };
}

describe("lastUnfinishedRound 候选查找", () => {
    it("空数组 / undefined / 空轮 / 已收卷轮都不算未完成", () => {
        expect(lastUnfinishedRound([])).toBeUndefined();
        expect(lastUnfinishedRound(undefined)).toBeUndefined();
        expect(lastUnfinishedRound([round({ answered: 0, results: [] })])).toBeUndefined();
        expect(lastUnfinishedRound([round({ endedAt: 9 })])).toBeUndefined();
    });

    it("从尾向前找第一个命中：尾随空轮两种形态都被跳过", () => {
        const open = round({ id: "open" });
        const dropped = round({ id: "dropped", startedAt: 2, answered: 0, results: [] });
        const closed = round({ id: "closed", startedAt: 3, answered: 0, results: [], endedAt: 5 });
        expect(lastUnfinishedRound([open, dropped])?.id).toBe("open");
        expect(lastUnfinishedRound([open, closed])?.id).toBe("open");
        expect(lastUnfinishedRound([open, dropped, closed])?.id).toBe("open");
    });

    it("多条未完成轮：取最靠后的那条（仍是「最近一次断点」语义）", () => {
        const a = round({ id: "a" });
        const b = round({ id: "b", startedAt: 2 });
        expect(lastUnfinishedRound([a, b])?.id).toBe("b");
        // 后面盖了空轮也不改这条语义
        expect(lastUnfinishedRound([a, b, round({ id: "c", startedAt: 3, answered: 0, results: [] })])?.id).toBe("b");
    });

    it("尾随已收卷的非空轮也不许把前面的未完成轮顶掉（收卷即断点已封）", () => {
        const open = round({ id: "open" });
        const done = round({ id: "done", startedAt: 2, endedAt: 9 });
        expect(lastUnfinishedRound([open, done])?.id).toBe("open");
    });

    it("纯空轮 / 纯已收卷：全都不命中 ⇒ undefined（不造幽灵入口）", () => {
        expect(lastUnfinishedRound([round({ answered: 0, results: [] }), round({ endedAt: 9 })])).toBeUndefined();
    });
});

describe("未完成轮判据", () => {
    it("多步题 `qid#k` 按块 id 归并：两条只算一题（不误判空轮）", () => {
        const steps = round({
            answered: 0, // 记账字段可能与 results 不同步（旧形态）
            results: [
                { qid: "q1#0", submitted: "A", ok: true },
                { qid: "q1#1", submitted: "B", ok: false },
            ],
        });
        expect(answeredQuestionCount(steps)).toBe(1);
        expect(isUnfinishedRound(steps)).toBe(true);
    });

    it("`endedAt` 已写恒不算未完成（哪怕答了很多题）", () => {
        expect(isUnfinishedRound(round({ endedAt: 1, answered: 5 }))).toBe(false);
    });

    it("空轮不论有无 endedAt 都不算未完成", () => {
        expect(isUnfinishedRound(round({ answered: 0, results: [] }))).toBe(false);
        expect(isUnfinishedRound(round({ answered: 0, results: [], endedAt: 2 }))).toBe(false);
    });

    it("undefined 不算未完成；无 results 的轮按 0 作答算空轮", () => {
        expect(isUnfinishedRound(undefined)).toBe(false);
        expect(isUnfinishedRound(round({ results: [] }))).toBe(false);
    });
});
