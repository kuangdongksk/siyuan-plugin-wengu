import { describe, expect, it } from "vitest";
import { sealRound, type RoundStore } from "./RoundSeal";
import { isAbandonedRound } from "./ResumePicker";
import type { WenguSession } from "./HistoryStore";

/**
 * 轮次封卷（Issue #169 调查项）：`QuizView.finishSession`（切卷 / 重开页签 /
 * 刷新 / 销毁 / 收卷）的判定与落盘。
 *
 * 本组锁的是**漏擦路径的反面**：真机 `mu6anse2-2zarfg`「开轮 3 秒被写
 * `endedAt`」的空轮，出自旧实现在这里**不看空轮、一律 `endedAt + upsert`**。
 * ⚠️ 别把这条归给倒计时链（那条走 `closeEmptyRound`，是**真删**、不写
 * `endedAt`；且倒计时最短 1 分钟，3 秒到不了归零）。
 */

/** 探针：记录「封了谁 / 抹了谁」，不做真落盘。 */
function probe() {
    const log: string[] = [];
    const store: RoundStore = {
        upsert: async (s: WenguSession): Promise<void> => void log.push(`upsert:${s.id}`),
        removeSession: async (id: string): Promise<void> => void log.push(`remove:${id}`),
    };
    return { store, log, input: { elapsedSec: 7, thoughts: { q1: "思路" } } };
}

/** 一轮会话：`over` 覆写形态（空轮＝零作答）。 */
function round(over: Partial<WenguSession> = {}): WenguSession {
    return {
        id: "r1",
        docId: "d1",
        startedAt: 1,
        mode: "countUp",
        elapsedSec: 3,
        answered: 1,
        correct: 1,
        results: [{ qid: "q1", submitted: "A", ok: true }],
        ...over,
    };
}

describe("sealRound · 空轮真删（本单修的漏擦路径）", () => {
    it("零作答的轮（切卷/刷新/关页签留下的那种）：removeSession、不写 endedAt、报告为空", async () => {
        const { store, log, input } = probe();
        const empty = round({ id: "mu6anse2-2zarfg", answered: 0, correct: 0, results: [] });
        const finished = sealRound(store, empty, input);
        await Promise.resolve();
        expect(log).toEqual(["remove:mu6anse2-2zarfg"]); // 真删，**不是** upsert
        expect(finished).toBeUndefined(); // 不进 finished ⇒ 视图侧不出报告
        expect(empty.endedAt).toBeUndefined(); // 不留 endedAt（那正是真机那条的形态）
    });

    it("判据边界：`endedAt` 已写的轮不算弃轮（已封卷的轮由收卷链管，不在这里擦）", () => {
        const already = round({ id: "already", answered: 0, correct: 0, results: [], endedAt: 99 });
        expect(isAbandonedRound(already)).toBe(false);
        // 已封卷的轮不会走到封卷路径（session 已清），此处只锁判据口径
    });

    it("「不会」（record 了 ok=false 的题）：有作答 ⇒ 照常封卷，不许当空轮擦掉", async () => {
        const { store, log, input } = probe();
        const dunno = round({
            id: "dunno",
            answered: 1,
            correct: 0,
            results: [{ qid: "q1", submitted: "", ok: false }],
        });
        const finished = sealRound(store, dunno, input);
        await Promise.resolve();
        expect(log).toEqual(["upsert:dunno"]);
        expect(finished?.endedAt).toBeTruthy();
    });

    it("多步题 `qid#k` 条目算内容：`answered` 未同步为 0 时也不许擦", async () => {
        const { store, log, input } = probe();
        const steps = round({
            id: "steps",
            answered: 0, // 记账字段与 results 不同步的旧形态
            results: [{ qid: "q1#0", submitted: "A", ok: true }],
        });
        sealRound(store, steps, input);
        await Promise.resolve();
        expect(log).toEqual(["upsert:steps"]); // 保守方向：有 results 就不擦
    });
});

describe("sealRound · 有作答照旧封卷（零回归）", () => {
    it("写 endedAt + 用时快照 + 思路快照，并落盘、返回报告快照", async () => {
        const { store, log, input } = probe();
        const s = round({ id: "real", elapsedSec: 3 });
        const finished = sealRound(store, s, { ...input, elapsedSec: 12 });
        await Promise.resolve();
        expect(log).toEqual(["upsert:real"]);
        expect(finished).toBe(s); // 报告读的就是这一条
        expect(s.endedAt).toBeTruthy();
        expect(s.elapsedSec).toBe(12); // max(3, 12)
        expect(s.thoughts).toEqual({ q1: "思路" });
    });

    it("用时只增不减（计时器已结算过更大值时不被写小）", () => {
        const { store, input } = probe();
        const s = round({ elapsedSec: 99 });
        sealRound(store, s, { ...input, elapsedSec: 12 });
        expect(s.elapsedSec).toBe(99);
    });

    it("无 store（只读壳/单测）：判定与内存态照旧，不崩", () => {
        const s = round({ id: "no-store" });
        expect(sealRound(undefined, s, { elapsedSec: 1, thoughts: {} })?.endedAt).toBeTruthy();
        const empty = round({ id: "no-store-empty", answered: 0, correct: 0, results: [] });
        expect(sealRound(undefined, empty, { elapsedSec: 1, thoughts: {} })).toBeUndefined();
    });
});
