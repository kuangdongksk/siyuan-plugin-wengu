import { describe, expect, it } from "vitest";
import { buildCardInit, restoreContextFor, type CardInitCtx } from "./CardState";
import type { WenguSession } from "../service/HistoryStore";
import { QuestionType, type WenguQuestion } from "../../types";

/**
 * 卡初始态回归（Issue #12 B2③/B3/B4）：**揭示态与锁定态是两件事**——
 * after 模式（收卷后揭示）提交只置 graded（记账），locked 保持 false
 * 直到收卷 revealAll → lockAllCards；恢复路径同口径。
 * 这两条是「提交后还能不能改答案」与「答案/解析泄不泄露」的唯一判据，
 * 改错一处即整项功能失效（旧实现两者都挂在 graded 上）。
 *
 * 恢复揭示的判据（B3 复审修正）= **轮次是否已封卷**（`endedAt`），
 * 不再是「是否答满」：B3「答满不自动收卷」让「答满但未收卷」成了可
 * 持久化状态，按答满判揭示就是重开页签即泄题 + 编辑窗口关死。
 */

const t = (k: string): string => k;

const baseCtx = (over: Partial<CardInitCtx> = {}): CardInitCtx => ({
    t,
    interactive: true,
    locked: false,
    ...over,
});

const choiceQ: WenguQuestion = {
    id: "q1",
    type: QuestionType.Single,
    answer: "B",
    optionMd: ["甲", "乙", "丙"],
    attempts: 0,
    wrongCount: 0,
};

function sessionWith(qid: string, submitted: string, ok: boolean, endedAt?: number): WenguSession {
    return {
        id: "s1",
        docId: "doc1",
        startedAt: 1,
        endedAt,
        mode: "countUp",
        elapsedSec: 3,
        answered: 1,
        correct: ok ? 1 : 0,
        results: [{ qid, submitted, ok }],
    };
}

describe("buildCardInit · 新卡（after 模式提交后）", () => {
    it("未作答：graded=false、locked=false（解析区靠 revealed 挡，见 card-render.scss）", () => {
        const ui = buildCardInit(choiceQ, baseCtx());
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([false, false, false]);
    });
});

describe("buildCardInit · 恢复态揭示/锁定解耦", () => {
    it("after 模式未收卷：graded=true 但 locked=false —— 重开页签仍可改答案", () => {
        const s = sessionWith("q1", "A", false);
        // 两题卷只答了一题：轮次未收卷（revealNow=false）
        const restore = restoreContextFor([choiceQ, { ...choiceQ, id: "q2" }], s, "after");
        expect(restore?.revealNow).toBe(false); // 未答满＝未收卷
        const ui = buildCardInit(choiceQ, baseCtx({ restore }));
        expect(ui.graded).toBe(true);
        expect(ui.locked).toBe(false);
        expect(ui.revealed).toBe(false);
        expect(ui.submitted).toBe("A");
        expect(ui.letters).toBe("A");
        expect(ui.resultStatus).toBe("warn"); // 「已作答」提示行，不透对错
    });

    it("after 模式**答满但未收卷**：恢复不揭示不锁 —— B3 复审回归（判据是 endedAt 不是答满）", () => {
        // 单题卷答满：B3 起不自动收卷，session 仍无 endedAt
        const s = sessionWith("q1", "A", false);
        const restore = restoreContextFor([choiceQ], s, "after");
        expect(restore?.revealNow).toBe(false); // 答满 ≠ 收卷
        const ui = buildCardInit(choiceQ, baseCtx({ restore }));
        expect(ui.graded).toBe(true);
        expect(ui.locked).toBe(false); // 编辑窗口保持
        expect(ui.revealed).toBe(false); // 答案/解析不泄
        expect(ui.resultStatus).toBe("warn"); // 只透「已作答」
    });

    it("after 模式已收卷（endedAt 已写）：locked=true 且 revealed=true（答案显现）", () => {
        const s = sessionWith("q1", "A", false, 99);
        const restore = restoreContextFor([choiceQ], s, "after");
        expect(restore?.revealNow).toBe(true);
        const ui = buildCardInit(choiceQ, baseCtx({ restore }));
        expect(ui.locked).toBe(true);
        expect(ui.revealed).toBe(true);
    });

    it("after 模式未收卷的**未答题**：恢复也不锁（能否修改不取决于是否答过）", () => {
        const s = sessionWith("q1", "A", false);
        const restore = restoreContextFor([choiceQ, { ...choiceQ, id: "q2" }], s, "after");
        const ui = buildCardInit({ ...choiceQ, id: "q2" }, baseCtx({ restore }));
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([false, false, false]);
    });

    it("instant 模式恢复：提交即锁（revealNow 恒真），语义不变", () => {
        const s = sessionWith("q1", "A", false);
        const restore = restoreContextFor([choiceQ], s, "instant");
        const ui = buildCardInit(choiceQ, baseCtx({ restore }));
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, true, true]);
    });
});

/* ── steps/slots 卡：完成即揭示（Issue #12 B4 复审回归） ──
   答案/解析区自 B4 起只认 .wengu-revealed（card-render.scss）；steps
   逐卡自判分即时揭示、slots 整卡做完即揭示，两条完成路径与恢复路径
   都必须置 revealed，否则做完多步/逐空题后解析区永久 display:none。 */

const stepsQ: WenguQuestion = {
    id: "s1",
    type: QuestionType.Steps,
    steps: [
        { kind: "method", stemMd: "第一步", answer: "A", optionMd: ["甲", "乙"] },
        { kind: "result", stemMd: "第二步", answer: "B", optionMd: ["丙", "丁"] },
    ],
    attempts: 0,
    wrongCount: 0,
};

const slotsQ: WenguQuestion = {
    id: "c1",
    type: QuestionType.Cloze,
    slots: [
        { answer: "A", optionMd: ["甲", "乙"] },
        { answer: "B", optionMd: ["丙", "丁"] },
    ],
    attempts: 0,
    wrongCount: 0,
};

function sessionOf(results: WenguSession["results"], endedAt?: number): WenguSession {
    return {
        id: "s1",
        docId: "doc1",
        startedAt: 1,
        endedAt,
        mode: "countUp",
        elapsedSec: 3,
        answered: results.length,
        correct: results.filter((r) => r.ok).length,
        results,
    };
}

describe("buildCardInit · steps 卡完成即揭示", () => {
    it("全部步作答完的恢复卡：revealed=true（解析区不隐藏）", () => {
        const s = sessionOf([
            { qid: "s1#0", submitted: "A", ok: true },
            { qid: "s1#1", submitted: "B", ok: true },
        ]);
        const restore = restoreContextFor([stepsQ], s, "after");
        const ui = buildCardInit(stepsQ, baseCtx({ restore }));
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, true, true]);
    });

    it("部分作答的恢复卡：revealed=false（未收口，解析区照旧隐藏）", () => {
        const s = sessionOf([{ qid: "s1#0", submitted: "A", ok: true }]);
        const restore = restoreContextFor([stepsQ], s, "after");
        const ui = buildCardInit(stepsQ, baseCtx({ restore }));
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([false, false, false]);
    });
});

describe("buildCardInit · slots 卡做完即揭示", () => {
    it("全部空作答完的恢复卡：revealed=true", () => {
        const s = sessionOf([
            { qid: "c1#0", submitted: "A", ok: true },
            { qid: "c1#1", submitted: "B", ok: false },
        ]);
        const restore = restoreContextFor([slotsQ], s, "after");
        const ui = buildCardInit(slotsQ, baseCtx({ restore }));
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, true, true]);
    });

    it("部分作答的恢复卡：revealed=false（未收口）", () => {
        const s = sessionOf([{ qid: "c1#0", submitted: "A", ok: true }]);
        const restore = restoreContextFor([slotsQ], s, "after");
        const ui = buildCardInit(slotsQ, baseCtx({ restore }));
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([false, false, false]);
    });
});
