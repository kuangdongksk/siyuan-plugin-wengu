import { describe, expect, it } from "vitest";
import type { AnswerHost } from "./AnswerFlow";
import { selfStarsOf, setSelfStars } from "./AnswerFlow";
import type { WenguSession } from "../service/HistoryStore";

/**
 * 自评五星的**数据落点**（Issue #135 §7.b 方案 1：会话内轻量）。
 *
 * 载荷形状＝`WenguSession.selfStars?: Record<qid, 1..5>`，遵守数据演进守则
 * （optional / 只加不改名 / 不 bump version / 装载零迁移）。本文件锁住
 * 三条最容易漂移的口径：
 *   ① 读数：旧会话没有该键 ⇒ 未评（0），不抛不报；
 *   ② 写入：点第 n 星落 n；**再点同值=取消 ⇒ 删键**（不是写 0——0 会让
 *      「已评 0 星」与「未评」两态在存储上分不开）；
 *   ③ 落库：每次评分即 `persist()`（用户显式动作，与自评对错的即时
 *      持久化语义一致；不落库则重开页签即丢）。
 */

/** 只带被测分支会用到的宿主能力的假件（同 SlotFlow.test.ts 口径）。 */
function hostOf(session?: WenguSession): { host: AnswerHost; saved: () => number } {
    let saves = 0;
    const host = {
        currentSession: (): WenguSession | undefined => session,
        persist: (): void => void saves++,
    } as unknown as AnswerHost;
    return { host, saved: (): number => saves };
}

function session(): WenguSession {
    return {
        id: "s1",
        docId: "d1",
        startedAt: 1,
        mode: "countUp",
        elapsedSec: 0,
        answered: 0,
        correct: 0,
        results: [],
    };
}

describe("selfStarsOf · 读数（旧会话零迁移）", () => {
    it("无会话 / 无该键 / 无该题一律未评（0）", () => {
        expect(selfStarsOf(hostOf().host, "q1")).toBe(0);
        const { host } = hostOf(session());
        expect(selfStarsOf(host, "q1")).toBe(0);
        const s = session();
        s.selfStars = { q2: 4 };
        expect(selfStarsOf(hostOf(s).host, "q1")).toBe(0);
        expect(selfStarsOf(hostOf(s).host, "q2")).toBe(4);
    });
});

describe("setSelfStars · 写入（§7.b 交互：评分 / 改评 / 取消）", () => {
    it("点第 n 星落 n 并立即落库", () => {
        const s = session();
        const { host, saved } = hostOf(s);
        setSelfStars(host, "q1", 3);
        expect(s.selfStars).toEqual({ q1: 3 });
        expect(saved()).toBe(1);
    });

    it("已评可改（覆写原值）", () => {
        const s = session();
        const { host } = hostOf(s);
        setSelfStars(host, "q1", 2);
        setSelfStars(host, "q1", 5);
        expect(s.selfStars).toEqual({ q1: 5 });
    });

    it("再点同值=取消：**删键**而非写 0（两态在存储上必须可分）", () => {
        const s = session();
        const { host } = hostOf(s);
        setSelfStars(host, "q1", 4);
        setSelfStars(host, "q1", 0);
        expect(s.selfStars).toEqual({});
        expect("q1" in (s.selfStars ?? {})).toBe(false);
        expect(selfStarsOf(host, "q1")).toBe(0);
    });

    it("不动别的题、不动会话其余字段", () => {
        const s = session();
        const { host } = hostOf(s);
        setSelfStars(host, "q1", 5);
        setSelfStars(host, "q2", 1);
        setSelfStars(host, "q1", 0);
        expect(s.selfStars).toEqual({ q2: 1 });
        expect([s.answered, s.correct, s.results.length]).toEqual([0, 0, 0]);
    });

    it("无会话=静默 no-op（预览/未开刷壳不炸）", () => {
        const { host, saved } = hostOf();
        expect(() => setSelfStars(host, "q1", 3)).not.toThrow();
        expect(saved()).toBe(0);
    });
});
