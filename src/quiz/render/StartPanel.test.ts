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

/**
 * 尾随空轮不得埋掉恢复入口（Issue #169，20260918 真机报障）：
 * 开轮即 upsert，用户「开了轮没答题就离开」会往库里留一条 `answered:0`
 * 的空轮（弃轮无 `endedAt`；倒计时归零/切卷收卷的空轮有 `endedAt`）。
 * 旧写法候选只看**数组末位**，空轮一占末位，前面「有作答且未收卷」的轮
 * 就被永久埋掉——面板不出「继续上次」。改法：从尾向前找第一个命中判据的轮。
 */
describe("buildStartPanelModel · 尾随空轮不埋恢复入口（Issue #169）", () => {
    /** 前一轮：有作答且未收卷（恢复目标，n=2）。 */
    const open = session({ id: "open", startedAt: 10, scope: "wrong", scopeIds: ["q1", "q2"] });
    /** 尾随空轮·弃轮形态。 */
    const dropped = session({ id: "empty-dropped", startedAt: 20, answered: 0, correct: 0, results: [] });
    /** 尾随空轮·收卷形态（开轮 3 秒被写 endedAt，即本机 `mu6anse2-2zarfg`）。 */
    const closed = session({ id: "empty-closed", startedAt: 20, answered: 0, correct: 0, results: [], endedAt: 23 });

    it("尾随弃轮（无 endedAt）：指向前一轮且 n=其已答数，resume 回显该轮范围", () => {
        const m = buildStartPanelModel({ t, defaults: {} as never, rounds: [open, dropped], list });
        expect(m.unfinishedAnswered).toBe(2);
        expect(m.resume?.scope).toBe("wrong");
    });

    it("尾随收卷空轮（有 endedAt）：同样指向前一轮（两种空轮形态都要跳过）", () => {
        const m = buildStartPanelModel({ t, defaults: {} as never, rounds: [open, closed], list });
        expect(m.unfinishedAnswered).toBe(2);
        expect(m.resume?.reveal).toBe("after");
    });

    it("两种空轮叠在尾部：仍找到前一轮", () => {
        const m = buildStartPanelModel({ t, defaults: {} as never, rounds: [open, dropped, closed], list });
        expect(m.unfinishedAnswered).toBe(2);
    });

    it("历史里只有纯空轮（无任何有作答未收卷轮）⇒ 不出「继续上次」（不造幽灵入口）", () => {
        const m = buildStartPanelModel({ t, defaults: {} as never, rounds: [dropped, closed], list });
        expect(m.unfinishedAnswered).toBeUndefined();
        expect(m.resume).toBeUndefined();
    });

    it("多步题（qid#k）按块 id 归并计数：尾随空轮下仍报整题数", () => {
        const steps = session({
            id: "steps",
            startedAt: 30,
            results: [
                { qid: "q1#0", submitted: "A", ok: true },
                { qid: "q1#1", submitted: "B", ok: false },
            ],
        });
        const m = buildStartPanelModel({ t, defaults: {} as never, rounds: [steps, dropped], list });
        expect(m.unfinishedAnswered).toBe(1);
    });
});

describe("startRound · continue 候选与面板同口径（Issue #169）", () => {
    function ctx(rounds: WenguSession[]): StartRoundCtx {
        return {
            defaults: {} as never,
            rounds,
            fullList: list,
            docId: "doc1",
            timer: new TimerController(() => undefined),
            setList: () => undefined,
            setRevealMode: () => undefined,
            setActiveIdx: () => undefined,
            setStarted: () => undefined,
            setFinished: () => undefined,
            setSession: () => undefined,
            afterStart: () => undefined,
        };
    }

    const cfg = {
        progress: "continue" as const,
        scope: "all" as const,
        reveal: "after" as const,
        stepsMode: "offline" as const,
        timing: "countUp" as const,
        countdownMin: 20,
    };

    it("尾随空轮（弃轮）：continue 续开的是前一轮，并恢复其 scopeIds 快照", () => {
        const open = session({ id: "open", startedAt: 10, scope: "wrong", scopeIds: ["q2"] });
        const dropped = session({ id: "empty", startedAt: 20, answered: 0, correct: 0, results: [] });
        const c = ctx([open, dropped]);
        let got: WenguSession | undefined;
        let gotList: WenguQuestion[] | undefined;
        c.setSession = (x) => (got = x);
        c.setList = (l) => (gotList = l);
        startRound(c, { ...cfg });
        expect(got).toBe(open); // 不是新轮、也不是空轮
        expect(gotList?.map((x) => x.id)).toEqual(["q2"]); // 按快照恢复
    });

    it("尾随收卷空轮：continue 同样续开前一轮", () => {
        const open = session({ id: "open", startedAt: 10 });
        const closed = session({ id: "empty", startedAt: 20, answered: 0, correct: 0, results: [], endedAt: 23 });
        const c = ctx([open, closed]);
        let got: WenguSession | undefined;
        c.setSession = (x) => (got = x);
        startRound(c, { ...cfg });
        expect(got).toBe(open);
    });

    it("只有纯空轮：continue 落回新轮（不续开空轮，与面板同判据）", () => {
        const dropped = session({ id: "empty", startedAt: 20, answered: 0, correct: 0, results: [] });
        const c = ctx([dropped]);
        let got: WenguSession | undefined;
        c.setSession = (x) => (got = x);
        startRound(c, { ...cfg });
        expect(got?.id).not.toBe("empty");
    });

    it("fresh 路径不看候选（新轮 id 必不是历史任一条）", () => {
        const open = session({ id: "open" });
        const c = ctx([open]);
        let got: WenguSession | undefined;
        c.setSession = (x) => (got = x);
        startRound(c, { ...cfg, progress: "fresh" });
        expect(got?.id).not.toBe("open");
    });
});
