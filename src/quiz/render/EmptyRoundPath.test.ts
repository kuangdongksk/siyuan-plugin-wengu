import { describe, expect, it } from "vitest";
import { finishRoundGuarded, type RoundFinishCtx } from "./RoundReport";
import type { WenguSession } from "../service/HistoryStore";
import { TimerController } from "../service/TimerController";

/**
 * 空轮收卷路径盘点（Issue #169 调查项）：开轮即 upsert，用户「开了轮没答题
 * 就离开」会往库里留一条 `answered:0` 的记录。本组把**收卷守卫**这条路的
 * 行为锁死（空轮必须真删、且不写 endedAt），其余路径的结论见 PR 描述与
 * `docs`/记忆里的盘点（切卷/重开那条走 `finishSession`，会写 endedAt 封卷）。
 *
 * 走 `finishRoundGuarded` 而不直接调 `closeEmptyRound`：守卫是两个收卷入口
 * 的**唯一出口**（#147），空轮判据也必须从它进来（#155 块 A）。
 */

/** 空轮：开轮即 upsert 的那条 0 作答记录（`endedAt` 视形态给/不给）。 */
function emptyRound(over: Partial<WenguSession> = {}): WenguSession {
    return {
        id: "empty",
        docId: "d1",
        startedAt: 100,
        mode: "countUp",
        elapsedSec: 3,
        answered: 0,
        correct: 0,
        results: [],
        ...over,
    };
}

/** 收卷 ctx 探针：只记录「抹了谁 / 有没有走收卷落库」，不做真 DOM 渲染。 */
function probe(session: WenguSession) {
    const log: string[] = [];
    const el = {
        querySelector: (): null => null,
        querySelectorAll: (): [] => [],
        classList: { add: (): void => undefined, remove: (): void => undefined, toggle: (): void => undefined },
    } as unknown as HTMLElement;
    const ctx = {
        el,
        t: (k: string): string => k,
        list: [],
        rounds: [session],
        session,
        timer: new TimerController(() => undefined),
        revealMode: "instant" as const,
        aiModelId: "",
        finishSession: (): void => void log.push("finishSession"),
        discardSession: (): void => void log.push("discardSession"),
        history: {
            removeSession: async (id: string): Promise<void> => void log.push(`remove:${id}`),
            upsert: async (): Promise<void> => void log.push("upsert"),
        },
        rerenderView: (): void => undefined,
        revealAnswered: (): void => undefined,
        stopRound: (): void => void log.push("stopRound"),
        lockAllCards: (): void => undefined,
    } as unknown as RoundFinishCtx;
    return { ctx, log };
}

describe("空轮收卷路径盘点（Issue #169 调查项·桌面）", () => {
    it("弃轮形态（无 endedAt）：收卷时抹掉已落盘那条，且不写 endedAt", async () => {
        const { ctx, log } = probe(emptyRound({ id: "mu5fzmhp-9lb9ni" }));
        finishRoundGuarded(ctx);
        await new Promise((r) => setTimeout(r, 0));
        expect(log).toContain("remove:mu5fzmhp-9lb9ni"); // 真删，不靠内存清
        expect(log).toContain("discardSession");
        expect(log).toContain("stopRound");
        // 封卷链一步都不走（否则 0 作答也会被写上 endedAt / 出报告）
        expect(log).not.toContain("finishSession");
        expect(log).not.toContain("upsert");
    });

    it("收卷形态（已有 endedAt，即开轮 3 秒被写 endedAt 的那种）：同样抹掉", async () => {
        const { ctx, log } = probe(emptyRound({ id: "mu6anse2-2zarfg", endedAt: 103 }));
        finishRoundGuarded(ctx);
        await new Promise((r) => setTimeout(r, 0));
        // 空轮判据只看 answered，不看 endedAt —— 带 endedAt 的空轮一样要擦
        expect(log).toContain("remove:mu6anse2-2zarfg");
        expect(log).not.toContain("finishSession");
    });

    it("非空轮不受影响：不抹记录、不走空轮清会话（照旧收卷链）", () => {
        const { ctx, log } = probe(
            emptyRound({ id: "real", answered: 1, results: [{ qid: "q1", submitted: "A", ok: true }] })
        );
        finishRoundGuarded(ctx);
        expect(log.some((x) => x.startsWith("remove:"))).toBe(false);
        expect(log).not.toContain("discardSession");
    });

    it("「不会」也算作答（记 ok=false）：不算空轮、不抹", () => {
        const { ctx, log } = probe(
            emptyRound({ id: "dunno", answered: 1, correct: 0, results: [{ qid: "q1", submitted: "", ok: false }] })
        );
        finishRoundGuarded(ctx);
        expect(log.some((x) => x.startsWith("remove:"))).toBe(false);
    });
});
