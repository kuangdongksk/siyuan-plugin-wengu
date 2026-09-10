import { describe, expect, it } from "vitest";
import { buildCardInit, restoreContextFor, type CardInitCtx } from "./CardState";
import type { WenguSession } from "../service/HistoryStore";
import { QuestionType, type WenguQuestion } from "../../types";

/**
 * 卡初始态回归（Issue #12 B2③/B4）：**揭示态与锁定态是两件事**——
 * after 模式（收卷后揭示）提交只置 graded（记账），locked 保持 false
 * 直到收卷 revealAll → lockAllCards；恢复路径同口径。
 * 这两条是「提交后还能不能改答案」与「答案/解析泄不泄露」的唯一判据，
 * 改错一处即整项功能失效（旧实现两者都挂在 graded 上）。
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

function sessionWith(qid: string, submitted: string, ok: boolean): WenguSession {
    return {
        id: "s1",
        docId: "doc1",
        startedAt: 1,
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

    it("after 模式已收卷（答满）：locked=true 且 revealed=true（答案显现）", () => {
        const s = sessionWith("q1", "A", false);
        const restore = restoreContextFor([choiceQ], s, "after");
        // 单题卷答满即全 graded → revealNow=true（收卷语义）
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
