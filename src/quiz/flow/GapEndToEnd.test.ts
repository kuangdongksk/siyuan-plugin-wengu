import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnswerHost } from "./AnswerFlow";
import { revealAll, submitQuestion } from "./AnswerFlow";
import { submitSlot } from "./SlotFlow";
import { answerGateFor } from "../service/AnswerGate";
import { TimerController } from "../service/TimerController";
import { QTimingOwner } from "../service/QTimingOwner";
import { CardCtl } from "../render/CardCtl";
import { buildCardInit, restoreContextFor, type CardInitCtx } from "../render/CardState";
import { registerCard, unregisterCard } from "../render/CardRegistry";
import { resetGapSameForTest } from "../service/GapJudge";
import { QuestionType, type WenguQuestion } from "../../types";
import type { WenguSession } from "../service/HistoryStore";

/**
 * 填空复核的**端到端接线**（Issue #187 复核补强）：完全按产品链跑
 * ——真 `answerGateFor`（含惰性设置读取）+ 真 `submitQuestion`/`submitSlot`
 * + 真会话记账，**只 mock `judgeJev`**。单元用例各自绿而链子断掉，正是
 * 20260921 那三处缺陷的形态（标记丢失 / 设置读早 / 逐空身份错），这组
 * 用例专门守住「用户真看得见的那条线」。
 *
 * 不碰真网络：`judgeJev` 用 spy 固定返回 noul 概率。
 */

const mkSession = (): WenguSession =>
    ({
        id: "s",
        docId: "d",
        startedAt: 0,
        mode: "n",
        answered: 0,
        correct: 0,
        results: [],
        elapsedSec: 0,
    }) as unknown as WenguSession;

/** 真视图形态的宿主：`settings` 在 gate 构造**之后**才就位（同 QuizView）。 */
function mkHost(qs: WenguQuestion[], session: WenguSession, mode: "instant" | "after") {
    const view = {
        settings: undefined as { jevKey?: string } | undefined,
        questions: (): WenguQuestion[] => qs,
        currentSession: (): WenguSession => session,
        historyStore: (): undefined => undefined,
        bankStore: (): undefined => undefined,
        persist: (): void => undefined,
        takeSec: (): number => 0,
        elapsedSec: (): number => 0,
        notifyAnswer: (): void => undefined,
    };
    const timer = new TimerController(() => undefined);
    const gate = answerGateFor(view as never, timer, new QTimingOwner());
    // QuizView 的 `settings` 是构造体里赋的值 —— gate 已在此之前建好了
    view.settings = { jevKey: "sk-test" };
    return {
        view,
        host: {
            t: (k: string) => k,
            gate,
            container: (): never => ({ querySelector: (): null => null, querySelectorAll: (): [] => [] }) as never,
            questions: (): WenguQuestion[] => qs,
            currentRevealMode: (): "instant" | "after" => mode,
            timerController: (): never =>
                ({ elapsed: (): number => 0, questionSec: (): number => 0, takeQuestionSec: (): number => 0 }) as never,
            currentSession: (): WenguSession => session,
            aiModelId: (): string => "",
            recordAnswer: gate.recordAnswer,
            flushTime: (): void => undefined,
            roundComplete: (): void => undefined,
            persist: (): void => undefined,
        } as unknown as AnswerHost,
    };
}

const mkCtl = (host: AnswerHost, q: WenguQuestion, idx = 0): CardCtl => {
    const ctx: CardInitCtx = { t: host.t, interactive: true, locked: false };
    return new CardCtl(host, q, idx, buildCardInit(q, ctx), true);
};

const fillQ = (id = "f1"): WenguQuestion => ({
    id,
    type: QuestionType.Fill,
    answer: "光合作用(photosynthesis)",
    stemMd: "名称",
    attempts: 0,
    wrongCount: 0,
});

afterEach(() => {
    resetGapSameForTest();
    vi.restoreAllMocks();
});

describe("端到端 · 填空（instant）", () => {
    it("失配 → 判同：会话落 jevSame + 结果行带标记 + 去重登记", async () => {
        const spy = vi.spyOn(await import("../../ai/jev/client"), "judgeJev");
        spy.mockResolvedValue([{ kind: "noul", noul: 0.95 }] as never);
        const q = fillQ();
        const session = mkSession();
        const { host } = mkHost([q], session, "instant");
        const ctl = mkCtl(host, q);
        registerCard(ctl);
        try {
            ctl.ui.mine = "光合作用";
            await submitQuestion(host, q, ctl);
            expect(spy).toHaveBeenCalledTimes(1);
            expect(session.results[0]).toEqual({
                qid: "f1",
                submitted: "光合作用",
                ok: true,
                jevSame: true,
            });
            expect(session.correct).toBe(1);
            expect(ctl.ui.resultHtml).toBe("correctjevSameMark");
            expect(ctl.ui.resultStatus).toBe("right");
        } finally {
            unregisterCard(ctl);
        }
    });

    it("收卷重画（revealAll）后标记仍在", async () => {
        const spy = vi.spyOn(await import("../../ai/jev/client"), "judgeJev");
        spy.mockResolvedValue([{ kind: "noul", noul: 0.95 }] as never);
        const q = fillQ();
        const session = mkSession();
        const { host } = mkHost([q], session, "instant");
        const ctl = mkCtl(host, q);
        registerCard(ctl);
        try {
            ctl.ui.mine = "光合作用";
            await submitQuestion(host, q, ctl);
            await revealAll(host);
            expect(ctl.ui.resultHtml).toBe("correctjevSameMark");
        } finally {
            unregisterCard(ctl);
        }
    });

    it("after 模式：收卷前不泄口风，收卷后标记补回", async () => {
        const spy = vi.spyOn(await import("../../ai/jev/client"), "judgeJev");
        spy.mockResolvedValue([{ kind: "noul", noul: 0.95 }] as never);
        const q = fillQ("f2");
        const session = mkSession();
        const { host } = mkHost([q], session, "after");
        const ctl = mkCtl(host, q);
        registerCard(ctl);
        try {
            ctl.ui.mine = "光合作用";
            await submitQuestion(host, q, ctl);
            expect(ctl.ui.resultHtml).toBe("answeredPending"); // 收卷前
            expect(session.results[0].jevSame).toBe(true); // 账已入
            await revealAll(host);
            expect(ctl.ui.resultHtml).toBe("correctjevSameMark"); // 收卷后补回
        } finally {
            unregisterCard(ctl);
        }
    });

    it("同题同答重复提交：判同被回放（零新请求，不再翻成错）", async () => {
        const spy = vi.spyOn(await import("../../ai/jev/client"), "judgeJev");
        spy.mockResolvedValue([{ kind: "noul", noul: 0.95 }] as never);
        const q = fillQ("f3");
        const session = mkSession();
        const { host } = mkHost([q], session, "after");
        const ctl = mkCtl(host, q);
        registerCard(ctl);
        try {
            ctl.ui.mine = "光合作用";
            await submitQuestion(host, q, ctl);
            expect(spy).toHaveBeenCalledTimes(1);
            // 收卷前再提交同一答（after 允许改答案）
            await submitQuestion(host, q, ctl);
            expect(spy).toHaveBeenCalledTimes(1); // 缓存命中，零请求
            expect(session.results[0].ok).toBe(true);
            expect(session.results[0].jevSame).toBe(true);
        } finally {
            unregisterCard(ctl);
        }
    });

    it("≤0.2 / 中间档：维持判错，且不写标记", async () => {
        const spy = vi.spyOn(await import("../../ai/jev/client"), "judgeJev");
        spy.mockResolvedValue([{ kind: "noul", noul: 0.5 }] as never);
        const q = fillQ("f4");
        const session = mkSession();
        const { host } = mkHost([q], session, "instant");
        const ctl = mkCtl(host, q);
        registerCard(ctl);
        try {
            ctl.ui.mine = "光合作用";
            await submitQuestion(host, q, ctl);
            expect(session.results[0].ok).toBe(false);
            expect(session.results[0].jevSame).toBeUndefined();
            expect(ctl.ui.resultHtml).toBe("wronganswerLabel光合作用(photosynthesis)");
            expect(ctl.ui.resultStatus).toBe("wrong");
        } finally {
            unregisterCard(ctl);
        }
    });
});

describe("端到端 · 逐空（cloze）", () => {
    const clozeQ: WenguQuestion = {
        id: "c1",
        type: QuestionType.Cloze,
        answer: "",
        slots: [{ optionMd: ["0.5", "1/2"], answer: "0.5" }],
        attempts: 0,
        wrongCount: 0,
    };

    it("逐空判同：会话记录（qid#k）落标记 + 卡面翻对", async () => {
        const spy = vi.spyOn(await import("../../ai/jev/client"), "judgeJev");
        spy.mockResolvedValue([{ kind: "noul", noul: 0.95 }] as never);
        const session = mkSession();
        const { host } = mkHost([clozeQ], session, "instant");
        const ctl = mkCtl(host, clozeQ);
        registerCard(ctl);
        try {
            ctl.ui.slots!.curSelected = "B"; // 选项 B = "1/2"，与答案 "0.5" 字面不等
            submitSlot(host, clozeQ, ctl);
            await vi.waitFor(() => expect(ctl.ui.slots!.marks[0].ok).toBe(true));
            // 会话记录身份必须是 qid#k，且带标记
            expect(session.results[0]).toEqual({
                qid: "c1#0",
                submitted: "B",
                ok: true,
                jevSame: true,
            });
            expect(ctl.ui.resultHtml).toBe("correct");
            expect(ctl.ui.resultStatus).toBe("right");
        } finally {
            unregisterCard(ctl);
        }
    });

    it("逐空判不同：维持判错，卡面与账本都不变", async () => {
        const spy = vi.spyOn(await import("../../ai/jev/client"), "judgeJev");
        spy.mockResolvedValue([{ kind: "noul", noul: 0.05 }] as never);
        const session = mkSession();
        const { host } = mkHost([clozeQ], session, "instant");
        const ctl = mkCtl(host, clozeQ);
        registerCard(ctl);
        try {
            ctl.ui.slots!.curSelected = "B";
            submitSlot(host, clozeQ, ctl);
            await new Promise((r) => setTimeout(r, 20));
            expect(ctl.ui.slots!.marks[0].ok).toBe(false);
            expect(session.results[0].ok).toBe(false);
            expect(session.results[0].jevSame).toBeUndefined();
        } finally {
            unregisterCard(ctl);
        }
    });
});

describe("端到端 · 恢复与改答（数据一致性）", () => {
    it("重开页签恢复：判同标记随会话补回（不止活在提交那一瞬）", async () => {
        const spy = vi.spyOn(await import("../../ai/jev/client"), "judgeJev");
        spy.mockResolvedValue([{ kind: "noul", noul: 0.95 }] as never);
        const q = fillQ("r1");
        const session = mkSession();
        const { host } = mkHost([q], session, "instant");
        const ctl = mkCtl(host, q);
        registerCard(ctl);
        try {
            ctl.ui.mine = "光合作用";
            await submitQuestion(host, q, ctl);
            expect(session.results[0].jevSame).toBe(true);
        } finally {
            unregisterCard(ctl);
        }
        // 模拟「重开页签」：同一会话重建卡（恢复路径）
        const t = (k: string): string => k;
        const ctx: CardInitCtx = {
            t,
            interactive: false,
            locked: false,
            restore: restoreContextFor([q], session, "instant"),
        };
        const restored = buildCardInit(q, ctx);
        expect(restored.resultHtml).toBe("correctjevSameMark");
    });

    it("改答为错：旧判同标记必须清掉（不许「判错 + Jev 判同」并存）", async () => {
        const spy = vi.spyOn(await import("../../ai/jev/client"), "judgeJev");
        spy.mockResolvedValueOnce([{ kind: "noul", noul: 0.95 }] as never); // 首答判同
        spy.mockResolvedValue([{ kind: "noul", noul: 0.05 }] as never); // 改答判不同
        const q = fillQ("r2");
        const session = mkSession();
        const { host } = mkHost([q], session, "after"); // after 才允许收卷前改答
        const ctl = mkCtl(host, q);
        registerCard(ctl);
        try {
            ctl.ui.mine = "光合作用";
            await submitQuestion(host, q, ctl);
            expect(session.results[0].jevSame).toBe(true);
            // 换一个答案再提交，复核明确判不同
            ctl.ui.mine = "呼吸作用";
            await submitQuestion(host, q, ctl);
            expect(session.results[0].ok).toBe(false);
            expect(session.results[0].jevSame).toBeUndefined();
            await revealAll(host);
            expect(ctl.ui.resultHtml).toBe("wronganswerLabel光合作用(photosynthesis)");
            expect(ctl.ui.resultHtml).not.toContain("jevSameMark");
        } finally {
            unregisterCard(ctl);
        }
    });
});

describe("端到端 · 无 key（验收 1 的守门人）", () => {
    it("没配 key：全程零请求、结果行与改造前逐字同形（连判同缓存都不参与）", async () => {
        const spy = vi.spyOn(await import("../../ai/jev/client"), "judgeJev");
        spy.mockResolvedValue([{ kind: "noul", noul: 0.95 }] as never);
        const q = fillQ("n1");
        const session = mkSession();
        const view = {
            settings: undefined as { jevKey?: string } | undefined, // 没配 key
            questions: (): WenguQuestion[] => [q],
            currentSession: (): WenguSession => session,
            historyStore: (): undefined => undefined,
            bankStore: (): undefined => undefined,
            persist: (): void => undefined,
            takeSec: (): number => 0,
            elapsedSec: (): number => 0,
            notifyAnswer: (): void => undefined,
        };
        const gate = answerGateFor(view as never, new TimerController(() => undefined), new QTimingOwner());
        const host = {
            t: (k: string): string => k,
            gate,
            container: (): never => ({ querySelector: (): null => null, querySelectorAll: (): [] => [] }) as never,
            questions: (): WenguQuestion[] => [q],
            currentRevealMode: (): "instant" => "instant",
            timerController: (): never =>
                ({ elapsed: (): number => 0, questionSec: (): number => 0, takeQuestionSec: (): number => 0 }) as never,
            currentSession: (): WenguSession => session,
            aiModelId: (): string => "",
            recordAnswer: gate.recordAnswer,
            flushTime: (): void => undefined,
            roundComplete: (): void => undefined,
            persist: (): void => undefined,
        } as unknown as AnswerHost;
        const ctl = mkCtl(host, q);
        registerCard(ctl);
        try {
            ctl.ui.mine = "光合作用";
            await submitQuestion(host, q, ctl);
            expect(spy).not.toHaveBeenCalled();
            expect(session.results[0]).toEqual({ qid: "n1", submitted: "光合作用", ok: false });
            expect(ctl.ui.resultHtml).toBe("wronganswerLabel光合作用(photosynthesis)");
            expect(ctl.ui.resultStatus).toBe("wrong");
        } finally {
            unregisterCard(ctl);
        }
    });
});

describe("端到端 · 落库链不自递归（#189 转发环回归）", () => {
    it("判同落账触发的 persist 不抛 RangeError（栈溢出）", async () => {
        const spy = vi.spyOn(await import("../../ai/jev/client"), "judgeJev");
        spy.mockResolvedValue([{ kind: "noul", noul: 0.95 }] as never);
        // 真 QuizView 形态：`persist` 曾是 `= gate.persist`，而 gate 的实现是
        // `() => v.persist()` ⇒ 无限自递归。本用例守住「落账链能真的跑完」。
        (globalThis as never as { document: unknown }).document ??= {
            addEventListener: (): void => undefined,
            removeEventListener: (): void => undefined,
        };
        (globalThis as never as { window: unknown }).window ??= { setTimeout: (): void => undefined };
        const el = {
            addEventListener: (): void => undefined,
            removeEventListener: (): void => undefined,
            querySelector: (): null => null,
            querySelectorAll: (): [] => [],
            classList: { add: (): void => undefined, remove: (): void => undefined },
            style: { setProperty: (): void => undefined },
        } as never;
        const { QuizView } = await import("../index");
        const view = new QuizView(el, { correct: "correct" }, "doc") as never as {
            persist: () => void;
            gate: { persist: () => void };
        };
        expect(() => view.persist()).not.toThrow();
        expect(() => view.gate.persist()).not.toThrow();
    });
});
