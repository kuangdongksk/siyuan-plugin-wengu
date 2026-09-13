import { describe, expect, it, vi } from "vitest";
import { initialMobileUi, MobileDrill, type MobileUi } from "./MobileDrill";
import { QuestionType } from "../../types";
import type { WenguQuestion } from "../../types";
import type { WenguSession } from "../../quiz/service/HistoryStore";
import type { MobileDeps } from "../types";

/**
 * 移动端刷题编排的关键口径（Issue #59 验收 5）：记账通道全部走既有
 * 通道（会话 upsert 幂等 / 题库镜像首答与重复提交分账）、揭示写入点
 * 不缺（即时判分即锁定+揭示；收卷模式提交只记已答）、「未完成轮」
 * 判据只看 endedAt。
 *
 * 用假 bank/history 记录调用（真实现走内核 IO，不进单测）。
 */

function q(id: string, over: Partial<WenguQuestion> = {}): WenguQuestion {
    return {
        id,
        type: QuestionType.Single,
        answer: "A",
        optionMd: ["甲", "乙"],
        attempts: 0,
        wrongCount: 0,
        ...over,
    };
}

/** 假题库：记录 recordAnswer / recordVerifyResult 调用（镜像分账判据）。 */
function fakeBank() {
    const calls: { kind: string; qid: string; ok: boolean }[] = [];
    return {
        calls,
        bank: {
            preload: async (): Promise<void> => undefined,
            all: async (): Promise<unknown> => ({ sets: {}, records: {}, materials: {} }),
            recordAnswer: async (qid: string, _a: string, ok: boolean): Promise<void> =>
                void calls.push({ kind: "first", qid, ok }),
            peek: (): undefined => undefined,
            flush: async (): Promise<void> => undefined,
            markDirty: (): void => undefined,
        } as never,
    };
}

function fakeHistory() {
    const upserts: WenguSession[] = [];
    const store = {
        upsert: async (s: WenguSession): Promise<void> => void upserts.push(s),
        docSessions: async (): Promise<WenguSession[]> => [],
        preload: async (): Promise<void> => undefined,
    };
    return { store: store as never, upserts };
}

/** 建一个控制器（ui 深代理在真机由壳组件创建；单测里给普通对象即可）。 */
function make(over: Partial<Parameters<typeof buildDeps>[0]> = {}) {
    const { ui, deps, calls, upserts } = buildDeps(over);
    const drill = new MobileDrill(ui, deps);
    return { drill, ui, calls, upserts };
}

function buildDeps(
    over: {
        bank?: unknown;
        history?: unknown;
    } = {}
) {
    const { bank, calls } = fakeBank();
    const { store, upserts } = fakeHistory();
    const ui: MobileUi = initialMobileUi();
    const deps: MobileDeps = {
        i18n: {},
        bank: (over.bank as never) ?? bank,
        history: (over.history as never) ?? store,
        settings: { showNums: true },
    };
    return { ui, deps, calls, upserts };
}

/** 构造一个已装载的会话（绕过内核装载链，直接摆好本轮状态）。 */
function armed(over: { reveal?: "instant" | "after"; questions?: WenguQuestion[] } = {}) {
    const { drill, ui, calls, upserts } = make();
    const list = over.questions ?? [q("a"), q("b")];
    ui.home = { loading: false, error: "", sets: [], activeSetId: "set1", activeSetTitle: "卷一" };
    ui.fullList = list;
    ui.setup.reveal = over.reveal ?? "instant";
    drill.start("fresh");
    return { drill, ui, calls, upserts, list };
}

describe("开刷与作答", () => {
    it("开刷建会话并落库；题集为空时不动", () => {
        const { drill, upserts } = armed();
        expect(drill.ui.screen).toBe("drill");
        expect(drill.ui.list).toHaveLength(2);
        expect(drill.ui.session?.endedAt).toBeUndefined();
        expect(upserts.length).toBeGreaterThan(0);
        const { drill: empty } = make();
        empty.ui.home.activeSetId = "x";
        empty.start("fresh");
        expect(empty.ui.screen).toBe("home"); // 无题不开刷
    });

    it("单选题点选即答：判分即锁定 + 揭示（揭示写入点不缺）", async () => {
        const { drill, calls } = armed();
        drill.pickLetter("A");
        await drill.submit();
        const ui = drill.ui.cards[0];
        expect(ui.graded).toBe(true);
        expect(ui.locked).toBe(true);
        expect(ui.revealed).toBe(true);
        expect(ui.ok).toBe(true);
        expect(calls[0]).toMatchObject({ kind: "first", qid: "a", ok: true });
        // 会话记一题，attempts 口径由题库镜像承担
        expect(drill.ui.session?.results).toHaveLength(1);
    });

    it("重复提交走「覆写」口径：会话不涨、题库走 verify 分支", async () => {
        const { drill, calls } = armed({ reveal: "after" });
        drill.pickLetter("A");
        await drill.submit();
        const answered = drill.ui.session?.answered;
        drill.pickLetter("B");
        await drill.submit();
        // 会话 upsert 幂等：answered 不涨
        expect(drill.ui.session?.answered).toBe(answered);
        expect(drill.ui.session?.results).toHaveLength(1);
        // 题库：首答记一次（收卷模式推迟到交卷，故此刻只有 0 次）
        expect(calls.filter((c) => c.kind === "first")).toHaveLength(0);
    });

    it("「不会」记空串一错；跳过则完全不记账", async () => {
        const { drill } = armed();
        drill.skip();
        expect(drill.ui.qIdx).toBe(1);
        expect(drill.ui.session?.results).toHaveLength(0);
        drill.dunno();
        expect(drill.ui.cards[1].graded).toBe(true);
        expect(drill.ui.cards[1].ok).toBe(false);
        expect(drill.ui.session?.results[0]).toMatchObject({ qid: "b", submitted: "", ok: false });
    });
});

describe("终态语义（即时 vs 收卷）", () => {
    it("即时模式：答满自动收卷并进报告", async () => {
        const { drill } = armed();
        drill.pickLetter("A");
        await drill.submit();
        drill.next();
        drill.pickLetter("A");
        await drill.submit();
        expect(drill.ui.session?.endedAt).toBeTruthy();
        expect(drill.ui.screen).toBe("report");
    });

    it("收卷模式：提交只记已答、答满不收卷，交卷才揭示", async () => {
        const { drill, calls } = armed({ reveal: "after" });
        drill.pickLetter("A");
        await drill.submit();
        drill.next();
        drill.pickLetter("A");
        await drill.submit();
        // 答满但未收卷：仍在做题屏，答案不揭示
        expect(drill.ui.screen).toBe("drill");
        expect(drill.ui.session?.endedAt).toBeUndefined();
        expect(drill.ui.cards.every((c) => !c.revealed)).toBe(true);
        // 交卷：揭示全部 + 题库补记 + 进报告
        drill.endRound();
        expect(drill.ui.cards.every((c) => c.revealed)).toBe(true);
        expect(drill.ui.cards.every((c) => c.locked)).toBe(true);
        expect(drill.ui.session?.endedAt).toBeTruthy();
        expect(drill.ui.screen).toBe("report");
        expect(calls.filter((c) => c.kind === "first")).toHaveLength(2);
    });

    it("空轮不收卷", () => {
        const { drill } = armed();
        drill.requestEnd();
        expect(drill.ui.session?.endedAt).toBeUndefined();
        expect(drill.ui.screen).toBe("drill");
    });
});

describe("未完成轮判据只看 endedAt", () => {
    it("答满但未交卷的轮仍算未完成（可继续上次改答案）", async () => {
        const { drill } = armed({ reveal: "after" });
        drill.pickLetter("A");
        await drill.submit();
        drill.next();
        drill.pickLetter("A");
        await drill.submit();
        // 模拟回到开刷面板时探测未完成轮
        drill.ui.home.activeSetId = "set1";
        drill.ui.session!.endedAt = undefined;
        const sessions = [drill.ui.session!];
        const { drill: fresh } = make({
            history: {
                docSessions: async (): Promise<WenguSession[]> => sessions,
                upsert: async (): Promise<void> => undefined,
            },
        });
        fresh.ui.home = { loading: false, error: "", sets: [], activeSetId: "set1", activeSetTitle: "卷一" };
        fresh.ui.fullList = drill.ui.list;
        await (fresh as unknown as { restoreResumeFor(): Promise<void> }).restoreResumeFor();
        expect(fresh.ui.resume?.id).toBe(drill.ui.session!.id);
    });

    it("空轮不算未完成", async () => {
        const empty: WenguSession = {
            id: "s",
            docId: "set1",
            startedAt: 1,
            mode: "countUp",
            elapsedSec: 0,
            answered: 0,
            correct: 0,
            results: [],
        };
        const { drill } = make({
            history: {
                docSessions: async (): Promise<WenguSession[]> => [empty],
                upsert: async (): Promise<void> => undefined,
            },
        });
        drill.ui.home.activeSetId = "set1";
        await (drill as unknown as { restoreResumeFor(): Promise<void> }).restoreResumeFor();
        expect(drill.ui.resume).toBeUndefined();
    });
});

describe("错题再练一轮", () => {
    it("以本轮错题为范围开新轮（scope=wrong + 清单快照）", async () => {
        const { drill } = armed();
        drill.pickLetter("B"); // 答错
        await drill.submit();
        drill.next();
        drill.pickLetter("A"); // 答对
        await drill.submit();
        expect(drill.ui.screen).toBe("report");
        drill.retryWrong();
        expect(drill.ui.list).toHaveLength(1);
        expect(drill.ui.list[0].id).toBe("a");
        expect(drill.ui.session?.scope).toBe("wrong");
        expect(drill.ui.session?.scopeIds).toEqual(["a"]);
        expect(drill.ui.screen).toBe("drill");
    });
});

describe("作答形态分派（answerKindOf 唯一判据）", () => {
    it("填空题可提交并即时判分（改造前无作答位、提交无反应）", async () => {
        const fill = q("f", { type: QuestionType.Fill, answer: "42", optionMd: [] });
        const { drill, calls } = armed({ questions: [fill] });
        drill.setMine(" 42 ");
        await drill.submit();
        expect(drill.ui.cards[0].graded).toBe(true);
        expect(drill.ui.cards[0].revealed).toBe(true);
        expect(drill.ui.cards[0].ok).toBe(true);
        expect(calls[0]).toMatchObject({ kind: "first", qid: "f", ok: true });
    });

    it("填空题空提交不记账（noAnswer 提示）", async () => {
        const fill = q("f", { type: QuestionType.Fill, answer: "42", optionMd: [] });
        const { drill, calls } = armed({ questions: [fill] });
        await drill.submit();
        expect(drill.ui.cards[0].graded).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it("逐空题不给作答位：提交只提示、零记账零揭示", async () => {
        const cloze = q("z", {
            type: QuestionType.Cloze,
            answer: "B",
            optionMd: [],
            slots: [{ optionMd: ["甲", "乙"], answer: "B" }],
        });
        const { drill, calls } = armed({ questions: [cloze] });
        await drill.submit();
        expect(drill.ui.cards[0].resultText).toBe("mobileSlotsDesktopOnly");
        expect(drill.ui.cards[0].graded).toBe(false);
        expect(drill.ui.cards[0].revealed).toBe(false);
        expect(calls).toHaveLength(0);
        // 「不会」同口径：不把整题记成一笔空串（逐空记账是 qid#k）
        drill.dunno();
        expect(calls).toHaveLength(0);
        expect(drill.ui.session?.results).toHaveLength(0);
    });

    it("无题型兜底题：即时揭示露自评、先不记账；自评才落账", async () => {
        const plain = q("p", { type: undefined, answer: undefined, optionMd: [] });
        const { drill, calls } = armed({ questions: [plain] });
        await drill.submit();
        expect(drill.ui.cards[0].revealed).toBe(true);
        expect(drill.ui.cards[0].selfOn).toBe(true);
        expect(drill.ui.session?.results).toHaveLength(0);
        expect(calls).toHaveLength(0);
        drill.selfAssess(true);
        expect(drill.ui.session?.results).toHaveLength(1);
    });

    it("收卷模式下兜底题只置已答（不提前揭示）", async () => {
        const plain = q("p", { type: undefined, answer: undefined, optionMd: [] });
        const { drill } = armed({ questions: [plain], reveal: "after" });
        await drill.submit();
        expect(drill.ui.cards[0].graded).toBe(true);
        expect(drill.ui.cards[0].revealed).toBe(false);
        expect(drill.ui.cards[0].resultText).toBe("answeredPending");
    });

    it("收卷模式的填空只置已答，交卷才揭示", async () => {
        const fill = q("f", { type: QuestionType.Fill, answer: "42", optionMd: [] });
        const { drill, calls } = armed({ questions: [fill], reveal: "after" });
        drill.setMine("42");
        await drill.submit();
        expect(drill.ui.cards[0].revealed).toBe(false);
        expect(calls).toHaveLength(0); // 收卷模式推迟到交卷补记
        drill.endRound();
        expect(drill.ui.cards[0].revealed).toBe(true);
        expect(drill.ui.cards[0].locked).toBe(true);
        expect(calls.filter((c) => c.kind === "first")).toHaveLength(1);
    });
});

describe("AI 判分失败回落自评", () => {
    it("简答提交失败时露自评钮且不静默丢账", async () => {
        const brief = q("e", { type: QuestionType.Essay, answer: "略" });
        const { drill } = armed({ questions: [brief] });
        drill.setMine("我的推导");
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        await drill.submit();
        spy.mockRestore();
        // 走 judgeBrief → 内核 stub 抛错 → 结果行给失败文案 + 自评钮
        expect(drill.ui.cards[0].selfOn).toBe(true);
        expect(drill.ui.cards[0].resultText).toContain("aiJudgeFailed");
        expect(drill.ui.cards[0].busy).toBe(false);
    });
});
