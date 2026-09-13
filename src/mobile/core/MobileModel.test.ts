import { describe, expect, it } from "vitest";
import {
    answeredPct,
    countChoices,
    countLabel,
    drawerCells,
    lettersOf,
    reportStats,
    typeLabelKey,
    wrongRows,
} from "./MobileModel";
import type { WenguQuestion } from "../../types";
import { QuestionType } from "../../types";
import type { WenguSession } from "../../quiz/service/HistoryStore";

/**
 * 移动端刷题纯逻辑（Issue #59）：抽屉格子（材料组整组连格 + 最差聚合）、
 * 报告统计（答对/答错/未答/得分）、错题清单、题数候选。
 *
 * 关键口径：多步与逐空题在会话里记的是 `qid#k` 条目——**必须先按块 id
 * 归并**才能和题数对上（不归并会把一道多步题算成 N 道）。
 */

const t = (k: string): string => k;
/** 抽屉格子的副标签取题型标签（编排层传 t(typeLabelKey(q))）。 */
const typeLabel = (q: WenguQuestion): string => t(typeLabelKey(q));

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

function session(
    results: { qid: string; ok: boolean; submitted?: string }[],
    over: Partial<WenguSession> = {}
): WenguSession {
    return {
        id: "s1",
        docId: "set1",
        startedAt: 1,
        mode: "countUp",
        elapsedSec: 10,
        answered: results.length,
        correct: results.filter((r) => r.ok).length,
        results: results.map((r) => ({ qid: r.qid, ok: r.ok, submitted: r.submitted ?? "A" })),
        ...over,
    };
}

describe("drawerCells 题号抽屉", () => {
    it("逐题一格；材料组整组连成一格并带副标签", () => {
        const list = [q("a"), q("b", { group: "m1" }), q("c", { group: "m1" }), q("d", { group: "m1" }), q("e")];
        const cells = drawerCells(list, undefined, false, () => "");
        expect(cells).toHaveLength(3);
        expect(cells[0]).toMatchObject({ idx: 0, end: 0 });
        expect(cells[1]).toMatchObject({ idx: 1, end: 3 });
        expect(cells[2]).toMatchObject({ idx: 4, end: 4 });
    });

    it("组格取组内最差状态（错 > 已答 > 未答 > 对）", () => {
        const list = [q("a", { group: "m1" }), q("b", { group: "m1" })];
        // 一组内一题对、一题错 → 组格=bad
        const s = session([
            { qid: "a", ok: true },
            { qid: "b", ok: false },
        ]);
        expect(drawerCells(list, s, false, typeLabel)[0].state).toBe("bad");
        // 全对 → ok
        const ok = session([
            { qid: "a", ok: true },
            { qid: "b", ok: true },
        ]);
        expect(drawerCells(list, ok, false, typeLabel)[0].state).toBe("ok");
        // 一题未答（组格=未答优先于「对」）
        const half = session([{ qid: "a", ok: true }]);
        expect(drawerCells(list, half, false, typeLabel)[0].state).toBe("none");
    });

    it("收卷模式不揭对错：已答一律中性态", () => {
        const list = [q("a"), q("b")];
        const s = session([
            { qid: "a", ok: true },
            { qid: "b", ok: false },
        ]);
        const cells = drawerCells(list, s, true, typeLabel);
        expect(cells.map((c) => c.state)).toEqual(["answered", "answered"]);
    });

    it("多步题的 qid#k 条目按块 id 归并，不撑出多余格子", () => {
        const list = [q("a"), q("b")];
        const s = session([
            { qid: "a#0", ok: true },
            { qid: "a#1", ok: false },
            { qid: "b", ok: true },
        ]);
        const cells = drawerCells(list, s, false, typeLabel);
        expect(cells).toHaveLength(2);
        expect(cells[0].state).toBe("bad"); // 任一步错即错
    });
});

describe("reportStats 报告统计", () => {
    it("答对/答错/未答 + 得分（未答 0 分）", () => {
        const list = [q("a"), q("b"), q("c"), q("d")];
        const s = session([
            { qid: "a", ok: true },
            { qid: "b", ok: false },
        ]);
        const st = reportStats(list, s);
        expect(st).toMatchObject({ total: 4, right: 1, wrong: 1, none: 2, answered: 2, score: 25 });
    });

    it("空卷除零兜底", () => {
        expect(reportStats([], undefined).score).toBe(0);
    });
});

describe("wrongRows 错题清单", () => {
    it("只列错题，答对与未答都不进清单", () => {
        const list = [q("a"), q("b"), q("c")];
        const s = session([
            { qid: "a", ok: true },
            { qid: "b", ok: false, submitted: "B" },
        ]);
        const rows = wrongRows(list, s, t);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ idx: 1, typeKey: "mobileTypeSingle" });
    });

    it("客观题副文案＝你的答案 → 正解（字母集合转顿号）", () => {
        const list = [q("a", { type: QuestionType.Multiple, answer: "AC", optionMd: ["甲", "乙", "丙"] })];
        const s = session([{ qid: "a", ok: false, submitted: "AB" }]);
        expect(wrongRows(list, s, t)[0].detail).toBe("A、B → A、C");
    });

    it("简答题副文案带 AI 评语", () => {
        const list = [q("a", { type: QuestionType.Essay, answer: "略" })];
        const s = session([{ qid: "a", ok: false, submitted: "我的推导" }]);
        s.results[0].comment = "缺少条件说明";
        expect(wrongRows(list, s, t)[0].detail).toContain("缺少条件说明");
    });
});

describe("题型标签与题数候选", () => {
    it("组题与多步题的标签优先于底层题型", () => {
        expect(typeLabelKey(q("a", { group: "m1" }))).toBe("mobileTypeGroup");
        expect(
            typeLabelKey(
                q("a", {
                    type: QuestionType.Steps,
                    steps: [{ kind: "result", stemMd: "第一步", optionMd: [], answer: "A" }],
                })
            )
        ).toBe("mobileTypeSteps");
        expect(typeLabelKey(q("a", { type: QuestionType.Judge }))).toBe("mobileTypeJudge");
    });

    it("题数候选：不足时裁剪，恒带「全部」", () => {
        expect(countChoices(35)).toEqual([10, 20, 0]);
        expect(countChoices(15)).toEqual([10, 0]);
        expect(countChoices(5)).toEqual([0]);
    });

    it("题数标签与进度百分比", () => {
        expect(countLabel(0, 35, t)).toBe("35 mobileCountSuffix · mobileCountAll");
        expect(countLabel(10, 35, t)).toBe("10 mobileCountSuffix");
        expect(answeredPct(12, 35)).toBe(34);
        expect(answeredPct(0, 0)).toBe(0);
    });

    it("选项字母按位生成", () => {
        expect(lettersOf(q("a", { optionMd: ["甲", "乙", "丙"] }))).toEqual(["A", "B", "C"]);
    });
});
