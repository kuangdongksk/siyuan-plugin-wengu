import { describe, expect, it } from "vitest";
import type { AnswerHost } from "./AnswerFlow";
import { submitQuestion } from "./AnswerFlow";
import { CardCtl } from "../render/CardCtl";
import { buildCardInit, type CardInitCtx } from "../render/CardState";
import { QuestionType, type WenguQuestion } from "../../types";

/**
 * 无 key 时的判分行为（Issue #187 验收 1）：**与现状逐字节一致**。
 * 宿主刻意不实现复核三件（`gate` / `gapReview`）——这正是「没配 Jev」的
 * 宿主形态；断言盯结果行与记账，任何 Jev 痕迹（在途提示、判同标记）都
 * 不许出现。判对/判错两条路都覆盖（判对路径本就不该进复核）。
 */
class PlainHost implements AnswerHost {
    list: WenguQuestion[] = [];
    recs: { qid: string; submitted: string; ok: boolean }[] = [];
    results: string[] = [];
    t = (k: string): string => k;
    container = (): HTMLElement =>
        ({ querySelector: (): null => null, querySelectorAll: (): [] => [] }) as unknown as HTMLElement;
    questions = (): WenguQuestion[] => this.list;
    currentRevealMode = (): "instant" | "after" => "instant";
    timerController = (): never => ({ elapsed: () => 0, questionSec: () => 0, takeQuestionSec: () => 0 }) as never;
    currentSession = (): undefined => undefined;
    aiModelId = (): string => "";
    recordAnswer = (qid: string, submitted: string, ok: boolean): void => void this.recs.push({ qid, submitted, ok });
    flushTime = (): void => undefined;
    roundComplete = (): void => undefined;
    // 刻意不实现 gate/gapReview —— 「没配 Jev」的宿主形态
}

function mk(q: WenguQuestion): { host: PlainHost; ctl: CardCtl } {
    const host = new PlainHost();
    host.list = [q];
    const ctx: CardInitCtx = { t: host.t, interactive: true, locked: false };
    return { host, ctl: new CardCtl(host, q, 0, buildCardInit(q, ctx), true) };
}

describe("无 key 时判分行为零变化", () => {
    it("填空失配：判错、结果行与改造前同形（无任何 Jev 痕迹）", async () => {
        const q: WenguQuestion = {
            id: "f1",
            type: QuestionType.Fill,
            answer: "光合作用(photosynthesis)",
            stemMd: "名称",
            attempts: 0,
            wrongCount: 0,
        };
        const { host, ctl } = mk(q);
        ctl.ui.mine = "光合作用";
        await submitQuestion(host, q, ctl);
        expect(host.recs).toEqual([{ qid: "f1", submitted: "光合作用", ok: false }]);
        expect(ctl.ui.resultHtml).toBe("wronganswerLabel光合作用(photosynthesis)");
        expect(ctl.ui.resultStatus).toBe("wrong");
        expect(ctl.ui.note).toBe(""); // 不写「复核中」之类的在途提示
        // 也没有「Jev 判同」标记
        expect(ctl.ui.resultHtml).not.toContain("jevSameMark");
    });

    it("填空命中：判对，结果行逐字同旧（correct）", async () => {
        const q: WenguQuestion = {
            id: "f2",
            type: QuestionType.Fill,
            answer: "1|2",
            attempts: 0,
            wrongCount: 0,
        };
        const { host, ctl } = mk(q);
        ctl.ui.mine = "2";
        await submitQuestion(host, q, ctl);
        expect(host.recs[0].ok).toBe(true);
        expect(ctl.ui.resultHtml).toBe("correct");
    });
});
