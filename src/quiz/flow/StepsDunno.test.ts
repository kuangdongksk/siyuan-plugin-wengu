import { afterEach, describe, expect, it } from "vitest";
import { dunnoQuestion, dunnoSteps, revealAll, revealStepsCard, skipQuestion } from "./AnswerFlow";
import type { AnswerHost } from "./AnswerFlow";
import type { CardUi } from "../render/CardState";
import { buildCardInit, type CardInitCtx } from "../render/CardState";
import { registerCard, unregisterCard } from "../render/CardRegistry";
import { CardCtl } from "../render/CardCtl";
import { nextStep, pickStep } from "./StepsFlow";
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
    readonly mirrors: { qid: string; ok: boolean }[] = [];
    readonly overrides: { qid: string; ok: boolean }[] = [];
    /** 会话结果（revealStepsCard 的兜底快照与反悔判据都读它）。 */
    results: { qid: string; submitted: string; ok: boolean }[] = [];
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
    currentSession = (): never => ({ results: this.results }) as never;
    aiModelId = (): string => "";
    recordAnswer = (qid: string, submitted: string, ok: boolean): void => {
        this.recs.push({ qid, submitted, ok });
        // 会话 upsert（真实 HistoryStore.pushSessionAnswer 的语义：同 qid 原地覆写）
        const hit = this.results.find((r) => r.qid === qid);
        if (hit) Object.assign(hit, { submitted, ok });
        else this.results.push({ qid, submitted, ok });
    };
    bankMirror = (qid: string, _s: string, ok: boolean): void => void this.mirrors.push({ qid, ok });
    bankOverride = (qid: string, ok: boolean): void => void this.overrides.push({ qid, ok });
    flushTime = (): void => undefined;
    roundComplete = (): void => undefined;
    onActiveQ = (idx: number): void => void this.activeQ.push(idx);
}

/** 真 CardCtl（真 ui / 真 setGraded/setPending/reveal，别 mock 掉被测口径）。
 *  登记进题卡表：revealAll（收卷统一揭示）按表遍历，不登记它就测不到。 */
function ctlOf(
    q: WenguQuestion,
    mode: "instant" | "after" = "instant",
    restore?: CardInitCtx["restore"],
    host?: FakeHost
): { ctl: CardCtl; ui: CardUi; host: FakeHost } {
    const h = host ?? new FakeHost(mode);
    const ctx: CardInitCtx = { t, interactive: true, locked: false, restore };
    const ui = buildCardInit(q, ctx);
    const ctl = new CardCtl(h, q, 0, ui, true);
    registerCard(ctl);
    return { ctl, ui, host: h };
}

afterEach(() => unregisterCard({ q: stepsQ } as unknown as CardCtl));

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

/* ── 真流程回归（Issue #21 复审修复） ──
   上面几条是「单点分支」锁；这一段走**真实编排**（pickStep/nextStep/
   dunnoSteps/revealAll 串起来），锁三处真机级缺陷——它们在单点测试里
   全绿，只有在整条流程串起来时才暴露：

   1. 正常答完 steps 被 revealStepsCard 的「全错占位快照」覆盖成
      「全错 + 空选」——单测只看三态，看不到逐格被清空；
   2. after「不会」后无法反悔（守卫认 `ctl.graded`，而「不会」只置
      graded）——验收第 4 条直接失效；
   3. 没答过的步被挂上「AI 复核」申诉钮（复核「你选的这一步」无意义）。 */

describe("真流程 · 正常答完 steps（缺陷 1 回归）", () => {
    it("逐格真值落格、stepOks 真快照、整题结果行透真对错", async () => {
        const host = new FakeHost("instant");
        const { ctl, ui } = ctlOf(stepsQ, "instant", undefined, host);
        pickStep(ctl, 0, "A"); // 方法步对
        await nextStep(host, stepsQ, ctl, 0);
        pickStep(ctl, 1, "B"); // 结果步对
        await nextStep(host, stepsQ, ctl, 1);

        expect(ui.steps!.map((s) => s.selected)).toEqual(["A", "B"]);
        expect(ui.steps!.map((s) => s.ok)).toEqual([true, true]);
        expect(ui.stepOks).toBe("11"); // 申诉翻对基线（旧实现被清成 00）
        expect(ui.resultStatus).toBe("right");
    });

    it("答错也保真值：申诉钮挂答错的方法步，快照按步序记真对错", async () => {
        const host = new FakeHost("instant");
        const { ctl, ui } = ctlOf(stepsQ, "instant", undefined, host);
        pickStep(ctl, 0, "B"); // 方法步错（可行集合 A）
        await nextStep(host, stepsQ, ctl, 0);
        expect(ui.steps![0].ok).toBe(false);
        expect(ui.steps![0].appeal).toBe("idle"); // 答错的方法步可申诉
        pickStep(ctl, 1, "B");
        await nextStep(host, stepsQ, ctl, 1);
        expect(ui.stepOks).toBe("01");
        expect(ui.resultStatus).toBe("wrong");
    });
});

describe("真流程 · after「不会」可反悔（验收 4 / 缺陷 2 回归）", () => {
    it("点「不会」后仍能逐步作答并收口，题级账被覆写", async () => {
        const host = new FakeHost("after");
        const { ctl, ui } = ctlOf(stepsQ, "after", undefined, host);
        await dunnoSteps(host, stepsQ, ctl);
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, false, false]);

        pickStep(ctl, 0, "A"); // 旧实现在这里被 graded 闸打死
        expect(ui.steps![0].selected).toBe("A");
        await nextStep(host, stepsQ, ctl, 0);
        pickStep(ctl, 1, "B");
        await nextStep(host, stepsQ, ctl, 1);

        expect(ui.steps!.map((s) => s.ok)).toEqual([true, true]);
        expect(ui.stepOks).toBe("11");
        // 逐步账照记（#k），题级账在收口时**原地覆写**（同 qid 不新增条目）
        expect(host.recs.map((r) => r.qid)).toEqual(["s1", "s1#0", "s1#1", "s1"]);
        expect(host.recs.at(-1)).toEqual({ qid: "s1", submitted: "AB", ok: true });
        // 覆写走 override 口径（不动 attempts），整题不再按「曾认输」计错
        expect(host.overrides).toEqual([{ qid: "s1", ok: true }]);
        expect(host.mirrors).toEqual([]); // 覆写走 override，不重复记 attempts
    });

    it("未认输过的正常作答不写题级条目（轮次 answered 不翻倍）", async () => {
        const host = new FakeHost("after");
        const { ctl } = ctlOf(stepsQ, "after", undefined, host);
        pickStep(ctl, 0, "A");
        await nextStep(host, stepsQ, ctl, 0);
        pickStep(ctl, 1, "B");
        await nextStep(host, stepsQ, ctl, 1);
        expect(host.recs.map((r) => r.qid)).toEqual(["s1#0", "s1#1"]); // 逐步账，无题级条目
        expect(host.mirrors).toEqual([{ qid: "s1", ok: true }]);
    });
});

describe("真流程 · 收卷统一揭示（验收 5 回归）", () => {
    it("「不会」的卡全步展开，未答步不挂申诉钮（缺陷 3 回归）", async () => {
        const host = new FakeHost("after");
        const { ctl, ui } = ctlOf(stepsQ, "after", undefined, host);
        await dunnoSteps(host, stepsQ, ctl);
        void ctl;
        revealAll(host);

        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, true, true]);
        for (const su of ui.steps!) {
            expect([su.hidden, su.locked, su.graded, su.resultOn]).toEqual([false, true, true, true]);
            expect(su.selected).toBe(""); // 不伪装成「答错 A/B」
            expect(su.appeal).toBe(""); // 没答过的步无从复核
        }
    });

    it("已作答的卡收卷揭示：真值不被兜底快照覆盖（缺陷 1 回归）", async () => {
        const host = new FakeHost("after");
        const { ctl, ui } = ctlOf(stepsQ, "after", undefined, host);
        pickStep(ctl, 0, "A");
        await nextStep(host, stepsQ, ctl, 0);
        pickStep(ctl, 1, "B");
        await nextStep(host, stepsQ, ctl, 1);
        revealAll(host);
        expect(ui.steps!.map((s) => s.selected)).toEqual(["A", "B"]);
        expect(ui.steps!.map((s) => s.ok)).toEqual([true, true]);
        expect(ui.stepOks).toBe("11");
        expect(ui.resultHtml).toContain("stepAllCorrect");
    });
});
