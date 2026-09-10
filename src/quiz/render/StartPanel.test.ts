import { describe, expect, it } from "vitest";
import { buildStartPanelModel, startRound, type StartRoundCtx } from "./StartPanel";
import type { WenguSession } from "../service/HistoryStore";
import { QuestionType, type WenguQuestion } from "../../types";
import { TimerController } from "../service/TimerController";

/**
 * 「继续上次」的未完成判据（Issue #12 B3）：原先除 endedAt 之外还要求
 * 「答满即不算未完成」——那条只在 instant 下成立（答满立刻收卷、endedAt
 * 自然写上）；after 模式答满**不自动收卷**，答满却未交卷的轮必须仍能
 * 「继续上次」改答案并交卷。判据收敛为「有作答且 endedAt 未写」。
 */

const t = (k: string): string => k;

function q(id: string): WenguQuestion {
    return { id, type: QuestionType.Single, answer: "A", optionMd: ["甲", "乙"], attempts: 0, wrongCount: 0 };
}

const list = [q("q1"), q("q2")];

function session(over: Partial<WenguSession> = {}): WenguSession {
    return {
        id: "s1",
        docId: "doc1",
        startedAt: 1,
        mode: "countUp",
        revealMode: "after",
        elapsedSec: 5,
        answered: 2,
        correct: 1,
        results: [
            { qid: "q1", submitted: "A", ok: true },
            { qid: "q2", submitted: "B", ok: false },
        ],
        ...over,
    };
}

describe("buildStartPanelModel · after 答满未收卷仍算「未完成」", () => {
    it("答满但未收卷（endedAt 缺省）：出「继续上次」并回显该轮配置", () => {
        const m = buildStartPanelModel({ t, defaults: {} as never, rounds: [session()], list });
        expect(m.unfinishedAnswered).toBe(2);
        expect(m.resume?.reveal).toBe("after");
    });

    it("已收卷（endedAt 已写）：不出「继续上次」——收卷的轮不该被续开", () => {
        const m = buildStartPanelModel({ t, defaults: {} as never, rounds: [session({ endedAt: 99 })], list });
        expect(m.unfinishedAnswered).toBeUndefined();
        expect(m.resume).toBeUndefined();
    });

    it("空轮（无作答）：不算未完成", () => {
        const m = buildStartPanelModel({
            t,
            defaults: {} as never,
            rounds: [session({ answered: 0, results: [] })],
            list,
        });
        expect(m.unfinishedAnswered).toBeUndefined();
    });
});

describe("startRound · continue 判据与面板同口径", () => {
    function ctx(rounds: WenguSession[]): { c: StartRoundCtx; timer: TimerController } {
        const timer = new TimerController(() => undefined);
        const c: StartRoundCtx = {
            defaults: {} as never,
            rounds,
            fullList: list,
            docId: "doc1",
            timer,
            setList: () => undefined,
            setRevealMode: () => undefined,
            setActiveIdx: () => undefined,
            setStarted: () => undefined,
            setFinished: () => undefined,
            setSession: () => undefined,
            afterStart: () => undefined,
        };
        return { c, timer };
    }

    const cfg = {
        progress: "continue" as const,
        scope: "all" as const,
        reveal: "after" as const,
        stepsMode: "offline" as const,
        timing: "countUp" as const,
        countdownMin: 20,
    };

    it("答满未收卷的 after 轮：continue 续开同一轮（不是新轮）", () => {
        const s = session();
        const { c } = ctx([s]);
        let got: WenguSession | undefined;
        c.setSession = (x) => (got = x);
        startRound(c, { ...cfg });
        expect(got).toBe(s);
    });

    it("已收卷的 after 轮：continue 落回新轮（endedAt 已写不续开）", () => {
        const s = session({ endedAt: 99 });
        const { c } = ctx([s]);
        let got: WenguSession | undefined;
        c.setSession = (x) => (got = x);
        startRound(c, { ...cfg });
        expect(got).not.toBe(s);
        expect(got?.id).not.toBe("s1");
    });
});
