import { describe, expect, it } from "vitest";
import { dunnoQuestion, dunnoSteps, revealStepsCard, skipQuestion } from "./AnswerFlow";
import type { AnswerHost } from "./AnswerFlow";
import type { CardUi } from "../render/CardState";
import { buildCardInit, type CardInitCtx } from "../render/CardState";
import { CardCtl } from "../render/CardCtl";
import { QuestionType, type WenguQuestion } from "../../types";

/**
 * steps「跳过 / 不会」纯逻辑回归（Issue #21）：跳过复用 skipQuestion 的
 * 纯导航，「不会」走题级记账收口（AnswerFlow.dunnoCard）+ 全步揭示
 * （revealStepsCard/settleSteps）。此处用假 host + 真 CardCtl/真
 * buildCardInit 锁死「哪条分支写什么账、置哪几个态」——真机上写错一处
 * 就是「答完答案消失」或「重开页签泄题/半揭示」。
 */

const t = (k: string): string => k;

const stepsQ: WenguQuestion = {
    id: "s1",
    type: QuestionType.Steps,
    answer: "关键是换元",
    steps: [
        { kind: "method", stemMd: "第一步", answer: "A", optionMd: ["甲", "乙"] },
        { kind: "result", stemMd: "第二步", answer: "B", optionMd: ["丙", "丁"] },
    ],
    attempts: 0,
    wrongCount: 0,
};

interface Rec {
    qid: string;
    submitted: string;
    ok: boolean;
}

/** 作答编排的宿主假件（只实现被测分支真的会碰的方法）。 */
class FakeHost implements AnswerHost {
    readonly recs: Rec[] = [];
    readonly activeQ: number[] = [];
    list: WenguQuestion[] = [stepsQ];
    constructor(private readonly mode: "instant" | "after") {}

    t = t;
    // 材料组同显/揭示扫描走 querySelector(All)，假件给空结果即可
    container = (): HTMLElement =>
        ({ querySelector: (): null => null, querySelectorAll: (): [] => [] }) as unknown as HTMLElement;
    questions = (): WenguQuestion[] => this.list;
    currentRevealMode = (): "instant" | "after" => this.mode;
    timerController = () =>
        ({ elapsed: (): number => 0, questionSec: (): number => 3, takeQuestionSec: (): number => 3 }) as never;
    currentSession = (): never => ({ results: [] }) as never;
    aiModelId = (): string => "";
    recordAnswer = (qid: string, submitted: string, ok: boolean): void => void this.recs.push({ qid, submitted, ok });
    flushTime = (): void => undefined;
    roundComplete = (): void => undefined;
    onActiveQ = (idx: number): void => void this.activeQ.push(idx);
}

/** 真 CardCtl（真 ui / 真 setGraded/setPending/reveal，别 mock 掉被测口径）。 */
function ctlOf(q: WenguQuestion, restore?: CardInitCtx["restore"]): { ctl: CardCtl; ui: CardUi } {
    const ctx: CardInitCtx = { t, interactive: true, locked: false, restore };
    const ui = buildCardInit(q, ctx);
    return { ctl: new CardCtl(new FakeHost("instant"), q, 0, ui, true), ui };
}

describe("steps「不会」· instant 模式", () => {
    it("题级记一错（空串）、全部步骤一次揭示、卡锁、dunnoMarked 文案", async () => {
        const host = new FakeHost("instant");
        const { ctl, ui } = ctlOf(stepsQ);
        await dunnoSteps(host, stepsQ, ctl);

        expect(host.recs).toEqual([{ qid: "s1", submitted: "", ok: false }]); // 题级一条
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, true, true]);
        expect(ui.resultHtml).toContain("dunnoMarked");
        expect(ui.resultHtml).toContain("关键是换元"); // 题级答案附在文案后
        expect(ui.resultStatus).toBe("wrong");
        // 全步揭示：每步可见、锁定、带结果行；不逐格写空串（不污染逐步账）
        for (const su of ui.steps!) {
            expect([su.hidden, su.locked, su.graded, su.resultOn]).toEqual([false, true, true, true]);
            expect(su.selected).toBe("");
        }
        expect(ui.stepOks).toBe("00");
    });
});

describe("steps「不会」· after 模式", () => {
    it("只记「已作答」：不揭示不锁卡，步格保持干净", async () => {
        const host = new FakeHost("after");
        const { ctl, ui } = ctlOf(stepsQ);
        await dunnoSteps(host, stepsQ, ctl);

        expect(host.recs).toEqual([{ qid: "s1", submitted: "", ok: false }]);
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, false, false]);
        expect(ui.resultHtml).toContain("dunnoMarked");
        expect(ui.resultStatus).toBe("warn"); // 不透对错、不揭答案
        expect(ui.steps!.map((s) => s.graded)).toEqual([false, false]);
    });

    it("可反悔：重交正常作答走 upsert 覆写同条题级账（不新增条目）", async () => {
        const host = new FakeHost("after");
        const { ctl } = ctlOf(stepsQ);
        await dunnoSteps(host, stepsQ, ctl);
        // 反悔后走 StepsFlow 的收口记账（题级 qid，不带到 #k）
        host.recordAnswer("s1", "AB", true);
        expect(host.recs.map((r) => r.qid)).toEqual(["s1", "s1"]);
        expect(host.recs[1]).toEqual({ qid: "s1", submitted: "AB", ok: true });
    });
});

describe("steps「不会」· 守卫", () => {
    it("已揭示的卡再点「不会」零动作", async () => {
        const host = new FakeHost("instant");
        const { ctl, ui } = ctlOf(stepsQ);
        ui.revealed = true;
        await dunnoSteps(host, stepsQ, ctl);
        expect(host.recs).toEqual([]);
    });

    it("锁定的卡（收卷后）再点「不会」零动作", async () => {
        const host = new FakeHost("after");
        const { ctl, ui } = ctlOf(stepsQ);
        ui.locked = true;
        await dunnoSteps(host, stepsQ, ctl);
        expect(host.recs).toEqual([]);
    });
});

describe("普通卡「不会」共用同一收口（收口重构回归）", () => {
    it("after：仍只置 graded、只记一条题级账", async () => {
        const host = new FakeHost("after");
        const q: WenguQuestion = { ...stepsQ, type: QuestionType.Single, steps: undefined };
        const { ctl, ui } = ctlOf(q);
        await dunnoQuestion(host, q, ctl);
        expect(host.recs).toEqual([{ qid: "s1", submitted: "", ok: false }]);
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, false, false]);
    });

    it("instant：揭示 + 题级答案行 + 卡锁", async () => {
        const host = new FakeHost("instant");
        const q: WenguQuestion = { ...stepsQ, type: QuestionType.Single, steps: undefined };
        const { ctl, ui } = ctlOf(q);
        await dunnoQuestion(host, q, ctl);
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, true, true]);
        expect(ui.resultHtml).toContain("dunnoMarked");
        expect(ui.resultHtml).toContain("关键是换元"); // 客观题答案不许被文案盖掉
        expect(ui.resultStatus).toBe("wrong");
    });
});

describe("steps「跳过」", () => {
    it("纯导航：不记账不锁卡不揭示，滚到下一题", () => {
        const host = new FakeHost("instant");
        const { ui } = ctlOf(stepsQ);
        host.list = [stepsQ, { ...stepsQ, id: "s2" }];
        skipQuestion(host, stepsQ);
        expect(host.recs).toEqual([]);
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([false, false, false]);
        expect(host.activeQ).toEqual([1]);
    });

    it("末题零动作（没有下一题可去）", () => {
        const host = new FakeHost("instant");
        skipQuestion(host, stepsQ);
        expect(host.activeQ).toEqual([]);
    });
});

describe("revealStepsCard · 全步揭示收口", () => {
    it("按作答快照揭示（三态一起置 + 逐格落格锁定）", () => {
        const host = new FakeHost("instant");
        const { ctl, ui } = ctlOf(stepsQ);
        revealStepsCard(host, stepsQ, ctl, "A", false);
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, true, true]);
        expect(ui.submitted).toBe("A");
        for (const su of ui.steps!) expect([su.hidden, su.locked, su.graded]).toEqual([false, true, true]);
    });
});
