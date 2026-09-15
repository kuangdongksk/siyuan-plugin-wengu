import { describe, expect, it } from "vitest";
import { buildDocStats, buildQuizStats, modeLabel } from "./StatsService";
import type { WenguSession } from "../quiz/service/HistoryStore";
import { QuestionType, type WenguQuestion } from "../types";

/**
 * 统计面板聚合层（Issue #115）：全局总览与单文档详情全部是纯函数，却
 * 无一处测试。这里锁三块真口径：
 *  ① 总览累加与排序（answered/correct/rate/totalSec 按 startedAt 升序，
 *     与传入顺序无关）；
 *  ② 连续天数 streak 的「今天没刷从昨天起算」语义（含跨日边界）；
 *  ③ 单文档错题清单：按错次降序、**清单截 50 但 total 不截断**（旧实现
 *     拿截断长度当总数，20260829 三轮审查修的那条）。
 */

const DAY = 86400_000;

function session(patch: Partial<WenguSession> & { startedAt: number }): WenguSession {
    return {
        id: `s-${patch.startedAt}`,
        docId: "doc-1",
        endedAt: patch.startedAt + 60_000,
        mode: "countUp",
        elapsedSec: 60,
        answered: 1,
        correct: 1,
        results: [],
        ...patch,
    } as WenguSession;
}

describe("buildQuizStats · 总览聚合", () => {
    it("空历史：全零、rate 不除零、streak 0", () => {
        expect(buildQuizStats([], Date.UTC(2026, 8, 15, 12))).toEqual({
            rounds: 0,
            answered: 0,
            correct: 0,
            rate: 0,
            totalSec: 0,
            streak: 0,
            recent: [],
        });
    });

    it("累加三量与正确率，与传入顺序无关（按 startedAt 升序重排）", () => {
        const now = Date.UTC(2026, 8, 15, 12);
        const late = session({ startedAt: now - 1000, answered: 4, correct: 3, elapsedSec: 30 });
        const early = session({ startedAt: now - 5000, answered: 6, correct: 1, elapsedSec: 70 });
        const out = buildQuizStats([late, early], now);
        expect(out.rounds).toBe(2);
        expect(out.answered).toBe(10);
        expect(out.correct).toBe(4);
        expect(out.rate).toBeCloseTo(0.4);
        expect(out.totalSec).toBe(100);
        // 有序：trend 的 n 反映升序序位，startedAt 也是升序
        expect(out.recent.map((r) => r.startedAt)).toEqual([early.startedAt, late.startedAt]);
        expect(out.recent.map((r) => r.n)).toEqual([1, 2]);
    });

    it("单轮 rate 按该轮 answered 算，零作答轮 rate=0", () => {
        const now = Date.UTC(2026, 8, 15, 12);
        const out = buildQuizStats(
            [
                session({ startedAt: now - 1000, answered: 0, correct: 0 }),
                session({ startedAt: now, answered: 4, correct: 1 }),
            ],
            now
        );
        expect(out.recent.map((r) => r.rate)).toEqual([0, 0.25]);
        expect(out.rate).toBe(0.25);
    });

    it("recent 只留最近 20 轮，n 接续全局序位（不从 1 重数）", () => {
        const now = Date.UTC(2026, 8, 15, 12);
        const list = Array.from({ length: 25 }, (_v, i) => session({ startedAt: now - (25 - i) * DAY }));
        const out = buildQuizStats(list, now);
        expect(out.rounds).toBe(25);
        expect(out.recent.length).toBe(20);
        expect(out.recent[0].n).toBe(6);
        expect(out.recent.at(-1)!.n).toBe(25);
    });
});

describe("buildQuizStats · streak 连续天数", () => {
    const now = Date.UTC(2026, 8, 15, 12);
    const atDay = (offset: number, h = 10): number => now - offset * DAY - (12 - h) * 3600_000;

    it("今天刷过：从今天往回数", () => {
        const out = buildQuizStats(
            [session({ startedAt: atDay(0) }), session({ startedAt: atDay(1) }), session({ startedAt: atDay(2) })],
            now
        );
        expect(out.streak).toBe(3);
    });

    it("今天没刷：从昨天起算，不断连", () => {
        const out = buildQuizStats([session({ startedAt: atDay(1) }), session({ startedAt: atDay(2) })], now);
        expect(out.streak).toBe(2);
    });

    it("隔一天就断：前天有、昨天没有 → 0", () => {
        const out = buildQuizStats([session({ startedAt: atDay(2) })], now);
        expect(out.streak).toBe(0);
    });

    it("同一天多轮只算一天（按日聚合）", () => {
        const out = buildQuizStats(
            [
                session({ startedAt: atDay(0, 8) }),
                session({ startedAt: atDay(0, 20) }),
                session({ startedAt: atDay(1) }),
            ],
            now
        );
        expect(out.streak).toBe(2);
    });

    it("跨月边界按本地日期算（不按 86400 整除近似）", () => {
        // now = 2026-09-01 12:00 本地；前天与昨天分属 8/30、8/31
        const sep1 = new Date(2026, 8, 1, 12).getTime();
        const out = buildQuizStats(
            [
                session({ startedAt: new Date(2026, 7, 31, 23).getTime() }),
                session({ startedAt: new Date(2026, 7, 30, 1).getTime() }),
            ],
            sep1
        );
        expect(out.streak).toBe(2);
    });
});

describe("buildDocStats · 单文档详情", () => {
    const q = (id: string, patch: Partial<WenguQuestion> = {}): WenguQuestion => ({
        id,
        type: QuestionType.Single,
        answer: "A",
        attempts: 1,
        wrongCount: 0,
        ...patch,
    });

    it("轮次按 startedAt 升序（趋势图与评分记录共用）", () => {
        const a = session({ id: "s1", startedAt: 200 });
        const b = session({ id: "s2", startedAt: 100 });
        const out = buildDocStats("卷名", [a, b], [q("q1")]);
        expect(out.rounds.map((r) => r.id)).toEqual(["s2", "s1"]);
        expect(out.docTitle).toBe("卷名");
        expect(out.total).toBe(1);
    });

    it("错题清单：只收 wrongCount>0，按错次降序，题号是**全量清单**里的序号", () => {
        const list = [q("q1", { wrongCount: 1 }), q("q2"), q("q3", { wrongCount: 5 })];
        const out = buildDocStats("卷", [], list);
        expect(out.wrongs.map((w) => w.qid)).toEqual(["q3", "q1"]);
        expect(out.wrongs.map((w) => w.index)).toEqual([3, 1]); // 1 起题号（不是错题序号）
        expect(out.wrongTotal).toBe(2);
    });

    it("题干摘要剥 md 记号并截断到 80 字（作答摘要 40 字）", () => {
        const long = "x".repeat(120);
        const out = buildDocStats(
            "卷",
            [],
            [q("q1", { wrongCount: 1, stemMd: "# 标题  $x^2$  **粗**", lastAnswer: long })]
        );
        expect(out.wrongs[0].stemSummary).toBe("标题 x^2 粗");
        expect(out.wrongs[0].lastAnswer).toBe(`${"x".repeat(40)}…`);
        expect(out.wrongs[0].right).toBeUndefined(); // 未作答不编造正误
    });

    it("未作答（lastAnswer 空）不带 lastAnswer；right 原样透出", () => {
        const out = buildDocStats(
            "卷",
            [],
            [q("q1", { wrongCount: 2, stemMd: "题干", lastAnswer: "", right: "0", knowledge: "极限" })]
        );
        expect(out.wrongs[0].lastAnswer).toBeUndefined();
        expect(out.wrongs[0].right).toBe("0");
        expect(out.wrongs[0].knowledge).toBe("极限");
        expect(out.wrongs[0].wrongCount).toBe(2);
    });

    it("错题超 50 条：清单截到 50、wrongTotal 仍是真总数（三轮审查回归）", () => {
        const list = Array.from({ length: 60 }, (_v, i) => q(`q${i}`, { wrongCount: 60 - i }));
        const out = buildDocStats("卷", [], list);
        expect(out.wrongs.length).toBe(50);
        expect(out.wrongTotal).toBe(60);
        expect(out.wrongs[0].wrongCount).toBe(60); // 降序头名
        expect(out.wrongs.at(-1)!.wrongCount).toBe(11); // 截断处的错次
    });

    it("空卷：零轮次、零错题、total 0", () => {
        const out = buildDocStats("空卷", [], []);
        expect(out).toEqual({ docTitle: "空卷", total: 0, rounds: [], wrongs: [], wrongTotal: 0 });
    });
});

describe("modeLabel · 计时方式中文短名", () => {
    it("四种档位各自的词", () => {
        expect(modeLabel("countUp")).toBe("正计时");
        expect(modeLabel("countdown")).toBe("倒计时");
        expect(modeLabel("perQuestion")).toBe("逐题");
        expect(modeLabel("none")).toBe("不计时");
    });

    it("未知/缺省档位落「不计时」（旧记录不崩）", () => {
        expect(modeLabel(undefined as never)).toBe("不计时");
        expect(modeLabel("whatever" as never)).toBe("不计时");
    });
});
