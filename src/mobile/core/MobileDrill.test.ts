import { describe, expect, it, vi } from "vitest";
import { armed, judgeGate, make, q } from "./MobileDrillHarness";
import { mockDoc } from "./MobileResumeMock";
import { initialMobileUi, MobileDrill, type MobileUi } from "./MobileDrill";
import { QuestionBank, type BankData } from "../../bank/data/QuestionBank";
import { QuestionType } from "../../types";
import type { WenguSession } from "../../quiz/service/HistoryStore";
import type { MobileDeps } from "../types";

/**
 * 移动端刷题编排的关键口径（Issue #59 验收 5）：记账通道全部走既有
 * 通道（会话 upsert 幂等 / 题库镜像首答与重复提交分账）、揭示写入点
 * 不缺（即时判分即锁定+揭示；收卷模式提交只记已答）、「未完成轮」
 * 判据只看 endedAt。
 *
 * 装配件（假 bank/history、armed/make）在 MobileDrillHarness.ts；
 * 展示层洗牌用例在 MobileDrillShuffle.test.ts（Issue #131 拆片）。
 */

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
        // 展示层洗牌后正确字母是随机的：按洗后的视图取（口径见洗牌一节）
        drill.pickLetter(drill.ui.list[0].answer!);
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

    it("空轮静默关轮：不落库、不出报告、回开刷面板（Issue #158 对齐桌面 #155）", async () => {
        const { drill, removes } = armed();
        const id = drill.ui.session!.id;
        // `start` 一开轮就 upsert（「未完成轮可继续」的依托），空轮必须抹掉它
        expect(drill.deps.history).toBeTruthy();
        drill.requestEnd();
        expect(drill.ui.session).toBeUndefined(); // 清会话
        expect(removes).toContain(id); // 落盘那条被删（统计口径不留空轮）
        expect(drill.ui.screen).toBe("home"); // 回开刷面板，可开新轮
        expect(drill.ui.confirmEnd).toBe(false);
        expect(drill.ui.list).toEqual([]);
        expect(drill.ui.cards).toEqual([]);
        // 回面板会重探测未完成轮：这条空轮不该被认成「可继续」
        await Promise.resolve();
        expect(drill.ui.resume).toBeUndefined();
    });

    it("空轮在 after 模式同样关轮（不给确认弹层）", () => {
        const { drill } = armed({ reveal: "after" });
        drill.requestEnd();
        expect(drill.ui.confirmEnd).toBe(false);
        expect(drill.ui.screen).toBe("home");
        expect(drill.ui.session).toBeUndefined();
    });
});

describe("未完成轮判据只看 endedAt", () => {
    it("答满但未交卷的轮仍算未完成（可继续上次改答案）", async () => {
        // after 模式答满但未交卷：endedAt 未写 ⇒ 仍算未完成（可继续改答案）
        const { drill } = make({
            history: {
                allSessions: async (): Promise<WenguSession[]> => [fullAfter({ id: "open", endedAt: undefined })],
                upsert: async (): Promise<void> => undefined,
            },
        });
        drill.ui.home = {
            loading: false,
            error: "",
            sets: [mockDoc("set1", "卷一")],
            activeSetId: "set1",
            activeSetTitle: "卷一",
        };
        drill.ui.fullList = [q("set1/a"), q("set1/b")];
        await drill.restoreResumeFor();
        expect(drill.ui.resume?.id).toBe("open");
        expect(drill.ui.resumeView).toMatchObject({ answered: 2, total: 2 });
    });

    it("空轮不算未完成", async () => {
        const { drill } = make({
            history: {
                allSessions: async (): Promise<WenguSession[]> => [
                    fullAfter({ id: "empty", results: [], answered: 0 }),
                ],
                upsert: async (): Promise<void> => undefined,
            },
        });
        drill.ui.home = {
            loading: false,
            error: "",
            sets: [mockDoc("set1", "卷一")],
            activeSetId: "set1",
            activeSetTitle: "卷一",
        };
        await drill.restoreResumeFor();
        expect(drill.ui.resume).toBeUndefined();
        expect(drill.ui.resumeView).toBeUndefined();
    });
});

describe("错题再练一轮", () => {
    it("以本轮错题为范围开新轮（scope=wrong + 清单快照）", async () => {
        const { drill } = armed();
        // 洗牌后正确字母不确定：取一个**不等于**答案的字母来答错
        const right = drill.ui.list[0].answer!;
        drill.pickLetter(right === "A" ? "B" : "A"); // 答错
        await drill.submit();
        drill.next();
        drill.pickLetter(drill.ui.list[1].answer!); // 答对
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

/** 已收卷的一轮（当作「更新的已收卷轮」，边界 A 用）。 */
function fullAfter(over: Partial<WenguSession> = {}): WenguSession {
    return {
        id: "done",
        docId: "set1",
        startedAt: 200,
        endedAt: 300,
        mode: "countUp",
        revealMode: "after",
        elapsedSec: 20,
        answered: 2,
        correct: 1,
        results: [
            { qid: "set1/a", submitted: "A", ok: true },
            { qid: "set1/b", submitted: "B", ok: false },
        ],
        ...over,
    };
}

/** 让在途的 fire-and-forget 记账（recordAnswer/mirrorRepeatAnswer 都是
 *  `void` 调用）跑完：题库 flush 不会等这些 promise，只排空微任务即可。 */
async function drain(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("after 模式 brief 终局判分晚于交卷（复审必修）", () => {
    /** 真 QuestionBank + 内存数据：attempts 是审计口径，必须直接观测
     *  （recordVerifyResult 是函数式友元、读 bank.all().records，假 bank
     *  记调用看不到 attempts 是否只 +1）。 */
    function realBank() {
        const data: BankData = {
            version: 1,
            records: {
                e: {
                    qid: "e",
                    kramdown: "",
                    type: "essay",
                    kpRefs: [],
                    sourceDocId: "set1",
                    hash: "h",
                    stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
                },
            },
            collections: [],
            migratedDocs: [],
            hashed: {},
            knowRoots: [],
            folders: [],
            knowHidden: [],
            docStats: {},
        };
        return {
            data,
            bank: new QuestionBank(
                async () => data,
                async () => undefined
            ),
        };
    }

    function armedAfter(bank: QuestionBank) {
        const ui: MobileUi = initialMobileUi();
        const deps: MobileDeps = {
            i18n: {},
            bank: bank as never,
            history: {
                upsert: async (): Promise<void> => undefined,
                docSessions: async (): Promise<WenguSession[]> => [],
                preload: async (): Promise<void> => undefined,
            } as never,
            settings: { showNums: true },
        };
        const drill = new MobileDrill(ui, deps);
        drill.ui.home = { loading: false, error: "", sets: [], activeSetId: "set1", activeSetTitle: "卷一" };
        drill.ui.fullList = [q("e", { type: QuestionType.Essay, answer: "略" })];
        drill.ui.setup.reveal = "after";
        drill.start("fresh");
        return drill;
    }

    it("迟到 verdict 覆写题库镜像，attempts 只 +1（不再停在占位「错」）", async () => {
        judgeGate.arm();
        const { data, bank } = realBank();
        const drill = armedAfter(bank);
        drill.setMine("我的推导");
        const inflight = drill.submit(); // AI 在途（受 judgeGate 控制）
        await Promise.resolve();
        // 用户此刻交卷：flush 以占位 false 落账（attempts+1）
        drill.endRound();
        expect(drill.ui.session?.endedAt).toBeTruthy();
        await drain();
        expect(data.records.e.stats.attempts).toBe(1);
        expect(data.records.e.stats.right).toBe("0"); // 占位「错」

        // AI 迟到返回「答对」
        judgeGate.open({ verdict: "right", ok: true, comment: "不错" });
        await inflight.catch((): void => undefined);
        await drain();

        const stats = data.records.e.stats;
        expect(stats.right).toBe("1"); // 题库被覆写为对
        expect(stats.attempts).toBe(1); // 不再 +1（覆写口径）
        expect(stats.lastAnswer).toBe("我的推导");
        // 会话与题库一致（不再互相矛盾）
        expect(drill.ui.session?.results[0]).toMatchObject({ qid: "e", ok: true, verdict: "right" });
    });

    it("未收卷时迟到 verdict 照旧不碰题库（交卷时才补镜像）", async () => {
        judgeGate.arm();
        const { data, bank } = realBank();
        const drill = armedAfter(bank);
        drill.setMine("我的推导");
        const inflight = drill.submit();
        await Promise.resolve();
        // 不交卷：只改会话，题库此刻零变化
        judgeGate.open({ verdict: "right", ok: true, comment: "不错" });
        await inflight.catch((): void => undefined);
        await drain();
        expect(data.records.e.stats.attempts).toBe(0);
        expect(data.records.e.stats.right).toBeUndefined();
        expect(drill.ui.session?.results[0]).toMatchObject({ ok: true });
    });
});

describe("instant 模式 brief 判完即收口（复审评估项）", () => {
    it("末题是 brief：AI 判完自动出报告（与客观题答满即收口一致）", async () => {
        judgeGate.arm();
        const { drill } = armed({ questions: [q("e", { type: QuestionType.Essay, answer: "略" })] });
        drill.setMine("我的推导");
        const inflight = drill.submit();
        await Promise.resolve();
        // 判分在途：题已置 graded、尚未收卷
        expect(drill.ui.screen).toBe("drill");
        expect(drill.ui.session?.endedAt).toBeUndefined();
        judgeGate.open({ verdict: "right", ok: true, comment: "不错" });
        await inflight.catch((): void => undefined);
        // 判完 → checkAllDone → 即时模式自动收卷进报告
        expect(drill.ui.session?.endedAt).toBeTruthy();
        expect(drill.ui.screen).toBe("report");
        expect(drill.ui.cards[0]).toMatchObject({ graded: true, revealed: true, locked: true, ok: true });
    });

    it("判分失败回落自评时不自动收卷（等 selfAssess 收口，与桌面 catch 分支同款）", async () => {
        // 不 arm 闸 → 透传真实现 → 内核 stub 抛错
        const brief = q("e", { type: QuestionType.Essay, answer: "略" });
        const { drill } = armed({ questions: [brief] });
        drill.setMine("我的推导");
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        await drill.submit();
        spy.mockRestore();
        expect(drill.ui.cards[0].selfOn).toBe(true);
        expect(drill.ui.session?.endedAt).toBeUndefined();
        expect(drill.ui.screen).toBe("drill");
        // 自评后收口
        drill.selfAssess(true);
        expect(drill.ui.session?.endedAt).toBeTruthy();
        expect(drill.ui.screen).toBe("report");
    });
});
