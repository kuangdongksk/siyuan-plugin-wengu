import { afterEach, describe, expect, it } from "vitest";
import type { AnswerHost } from "./AnswerFlow";
import { CardCtl } from "../render/CardCtl";
import { buildCardInit, fillClozeCur, type CardInitCtx, type CardUi } from "../render/CardState";
import { cardOf, registerCard, unregisterCard } from "../render/CardRegistry";
import { gotoSlot, pickMatch, pickSlotOpt, submitMatch, submitSlot } from "./SlotFlow";
import { QuestionType, type WenguQuestion } from "../../types";

/**
 * slots 题作答流程（Issue #115）：本模块 111 行全无测试，而它是 cloze/match
 * 逐空判分与整题收口的唯一落点。StepsFlow 主链已有 StepsDunno.test.ts 20
 * 用例，这里只补**真缺口**：
 *  ① 状态未就绪/已判分/未选/空不存在的守卫（守卫错一处就是静默吞作答或
 *     重复记账）；
 *  ② 逐空提交的判分描色 + 记账口径（qid#k，不写题级账）；
 *  ③ 自愈推进（跳已答空）；match 与 cloze 两条支路的分流；
 *  ④ 全部作答完的整题收口（一次 bankMirror + 三态一把置齐）。
 * 用假 host + 真 CardCtl/真 buildCardInit（同 StepsDunno.test.ts 口径）。
 */

const t = (k: string): string => k;

const clozeQ: WenguQuestion = {
    id: "s1",
    type: QuestionType.Cloze,
    answer: "",
    slots: [
        { optionMd: ["甲", "乙"], answer: "A" },
        { optionMd: ["丙", "丁"], answer: "B" },
    ],
    attempts: 0,
    wrongCount: 0,
};

const matchQ: WenguQuestion = {
    id: "m1",
    type: QuestionType.Match,
    answer: "",
    slots: [
        { optionMd: ["甲", "乙"], answer: "A" },
        { optionMd: ["丙", "丁"], answer: "B" },
    ],
    attempts: 0,
    wrongCount: 0,
};

interface Rec {
    qid: string;
    submitted: string;
    ok: boolean;
}

/** 作答编排宿主假件（只实现被测分支真的会碰的方法）。 */
class FakeHost implements AnswerHost {
    readonly recs: Rec[] = [];
    readonly mirrors: { qid: string; submitted: string; ok: boolean }[] = [];
    list: WenguQuestion[] = [];
    notes: string[] = [];
    currentSession = (): undefined => undefined;
    t = t;
    container = (): HTMLElement => ({ querySelector: (): null => null }) as unknown as HTMLElement;
    questions = (): WenguQuestion[] => this.list;
    currentRevealMode = (): "instant" | "after" => "instant";
    timerController = (): never =>
        ({ elapsed: (): number => 0, questionSec: (): number => 0, takeQuestionSec: (): number => 0 }) as never;
    aiModelId = (): string => "";
    recordAnswer = (qid: string, submitted: string, ok: boolean): void => void this.recs.push({ qid, submitted, ok });
    bankMirror = (qid: string, submitted: string, ok: boolean): void => void this.mirrors.push({ qid, submitted, ok });
    flushTime = (): void => undefined;
    roundComplete = (): void => undefined;
    onActiveQ = (): void => undefined;
}

/** 挂一张真卡（**每题 id 只挂一次**——题卡表按 qid 登记，重复登记会让
 *  revealAll 之类的视图级遍历看到两张同 id 的卡）。 */
function ctlOf(q: WenguQuestion): { ctl: CardCtl; ui: CardUi; host: FakeHost } {
    expect(cardOf(q.id)).toBeUndefined();
    const host = new FakeHost();
    host.list = [q];
    const ctx: CardInitCtx = { t, interactive: true, locked: false };
    const ui = buildCardInit(q, ctx);
    const ctl = new CardCtl(host, q, 0, ui, true);
    registerCard(ctl);
    return { ctl, ui, host };
}

afterEach(() => {
    // 登记表是模块级单例，用例之间必须清干净（否则下一例 ctlOf 的
    // 「只挂一次」断言会误报）
    for (const q of [clozeQ, matchQ]) {
        const c = cardOf(q.id);
        if (c) unregisterCard(c);
    }
});

describe("cloze · 空切换与点选", () => {
    it("挂载即灌首空（引导语 + 选项快照），点选互斥写入 curSelected", () => {
        const { ctl, ui } = ctlOf(clozeQ);
        expect(ui.slots!.cur).toBe(0);
        expect(ui.slots!.curStem).toBe("slotNO");
        expect(ui.slots!.curOpts.map((o) => o.letter)).toEqual(["A", "B"]);
        pickSlotOpt(ctl, "B");
        expect(ui.slots!.curSelected).toBe("B");
        pickSlotOpt(ctl, "A"); // 重选覆盖（单选互斥）
        expect(ui.slots!.curSelected).toBe("A");
    });

    it("锁定空 / 已判分卡上的点选零动作（curSelected 不被改）", () => {
        const { ctl, ui } = ctlOf(clozeQ);
        ui.slots!.curLocked = true;
        pickSlotOpt(ctl, "B");
        expect(ui.slots!.curSelected).toBe("");
        ui.slots!.curLocked = false;
        ui.slots!.curSelected = "A";
        ui.graded = true;
        pickSlotOpt(ctl, "B");
        expect(ui.slots!.curSelected).toBe("A");
    });
});

describe("cloze · 提交本空", () => {
    it("未选即提交：只提示不记账不动态", () => {
        const { ctl, host } = ctlOf(clozeQ);
        submitSlot(host, clozeQ, ctl);
        expect(host.recs).toEqual([]);
        expect(ctl.ui.note).toBe("noAnswer");
    });

    it("判分描色 + 逐空记账（qid#k）+ 结果行 + 推进下一空", () => {
        const { ctl, ui, host } = ctlOf(clozeQ);
        pickSlotOpt(ctl, "A");
        submitSlot(host, clozeQ, ctl);
        expect(host.recs).toEqual([{ qid: "s1#0", submitted: "A", ok: true }]);
        expect(host.mirrors).toEqual([]); // 未答完不写整题账
        expect(ui.slots!.marks[0]).toEqual({ answered: true, letter: "A", ok: true });
        expect(ui.note).toBe("correct");
        expect(ui.slots!.cur).toBe(1); // 自愈推进（推进即灌新空：锁定/描色随快照换走）
        expect(ui.slots!.curLocked).toBe(false);
        expect(ui.slots!.curSelected).toBe(""); // 新空重置选择
        expect(ui.slots!.curStem).toBe("slotNO"); // 取词桩只回键名（n 占位符不参与断言）
        expect(ui.slots!.curOpts.map((o) => o.letter)).toEqual(["A", "B"]);
        expect(ui.slots!.curOpts.every((o) => o.mark === 0)).toEqual(true);
        expect(ui.graded).toBe(false); // 未答完不揭示
    });

    it("答错：结果行带 slotWrong 填答案、当前空选项按 slotOptionIsRight 描色", () => {
        const { ctl, ui, host } = ctlOf(clozeQ);
        pickSlotOpt(ctl, "B"); // 正确项 A
        submitSlot(host, clozeQ, ctl);
        expect(host.recs).toEqual([{ qid: "s1#0", submitted: "B", ok: false }]);
        expect(ui.slots!.marks[0].ok).toBe(false);
        expect(ui.note).toBe("slotWrong"); // 模板 {L} 已替换（t 原样返回键名）
        // 描色在**提交那一刻**落格（推进后快照已换到下一空）：A 是真正确项，
        // 所选的 B 不是 → 只描 A。这里用末空提交复验「错选项不写 2」的口径
        ctl.ui.slots!.cur = 1;
        fillClozeCur(clozeQ, ui, t);
        pickSlotOpt(ctl, "A"); // 第二空正确项 B
        submitSlot(host, clozeQ, ctl);
        expect(ui.slots!.marks[1].ok).toBe(false);
        expect(host.recs[1]).toEqual({ qid: "s1#1", submitted: "A", ok: false });
    });

    it("点击已答空不回头（gotoSlot 守卫），当前空不变", () => {
        const { ctl, ui, host } = ctlOf(clozeQ);
        pickSlotOpt(ctl, "A");
        submitSlot(host, clozeQ, ctl);
        gotoSlot(ctl, 0);
        expect(ui.slots!.cur).toBe(1);
        expect(ui.slots!.cur).toBe(1);
        gotoSlot(ctl, 1); // 跳到当前空=灌一次空（选项快照重建）
        expect(ui.slots!.cur).toBe(1);
        expect(ui.slots!.curOpts.map((o) => o.letter)).toEqual(["A", "B"]);
        expect(ui.slots!.curStem).toBe("slotNO");
    });

    it("越过末尾的 gotoSlot：cur 落位但灌空停手（不越界读 slots）", () => {
        const { ctl, ui } = ctlOf(clozeQ);
        gotoSlot(ctl, 5);
        expect(ui.slots!.cur).toBe(5);
        expect(ui.slots!.curStem).toBe("slotNO"); // 首空引导语仍在，越界不重灌
        expect(ui.slots!.curOpts.map((o) => o.letter)).toEqual(["A", "B"]);
    });

    it("空不存在（越界下标）提交零动作", () => {
        const { ctl, ui, host } = ctlOf(clozeQ);
        ui.slots!.cur = 9;
        ui.slots!.curSelected = "A";
        submitSlot(host, clozeQ, ctl);
        expect(host.recs).toEqual([]);
    });

    it("已判分（整卡收口后）提交零动作", () => {
        const { ctl, ui, host } = ctlOf(clozeQ);
        ui.graded = true;
        ui.slots!.curSelected = "A";
        submitSlot(host, clozeQ, ctl);
        expect(host.recs).toEqual([]);
        expect(ui.slots!.marks[0].answered).toBe(false);
        ui.graded = false;
        ui.slots!.kind = "match";
        submitSlot(host, clozeQ, ctl);
        expect(host.recs).toEqual([]);
    });
});

describe("cloze · 全部作答完的整题收口", () => {
    function answerAll(letters: [string, string]): { ctl: CardCtl; ui: CardUi; host: FakeHost } {
        const { ctl, ui, host } = ctlOf(clozeQ);
        pickSlotOpt(ctl, letters[0]);
        submitSlot(host, clozeQ, ctl);
        pickSlotOpt(ctl, letters[1]);
        submitSlot(host, clozeQ, ctl);
        return { ctl, ui, host };
    }

    it("全对：整题账（拼串+全对）+ setGraded 一把三态 + 结果行", async () => {
        const { ui, host } = answerAll(["A", "B"]);
        await Promise.resolve();
        expect(host.recs.map((r) => r.qid)).toEqual(["s1#0", "s1#1"]); // 不写题级账
        expect(host.mirrors).toEqual([{ qid: "s1", submitted: "AB", ok: true }]);
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, true, true]);
        expect(ui.resultHtml).toBe("correct");
        expect(ui.resultStatus).toBe("right");
    });

    it("有错：整题账记错 + slotsSummary 结果行", async () => {
        const { ui, host } = answerAll(["A", "A"]);
        await Promise.resolve();
        expect(host.mirrors).toEqual([{ qid: "s1", submitted: "AA", ok: false }]);
        expect(ui.resultStatus).toBe("wrong");
        expect(ui.resultHtml).toBe("slotsSummary");
        expect(ui.graded).toBe(true);
    });

    it("收口后（已判分）再提交本空零动作——整题账不重复写", () => {
        const { ctl, ui, host } = answerAll(["A", "B"]);
        gotoSlot(ctl, 0);
        pickSlotOpt(ctl, "A");
        submitSlot(host, clozeQ, ctl);
        expect(host.mirrors.length).toBe(1);
        expect(ui.slots!.cur).toBe(2); // 全答完后 cur 停在末尾之外的收口位
    });
});

describe("match · 下拉草稿与逐行提交", () => {
    it("新卡不灌 cloze 引导语（match 无当前空概念）", () => {
        const { ui } = ctlOf(matchQ);
        expect(ui.slots!.kind).toBe("match");
        expect(ui.slots!.curOpts).toEqual([]);
        expect(ui.slots!.curStem).toBe("");
    });

    it("pickMatch 草稿大写化；未选提交只提示", () => {
        const { ctl, ui, host } = ctlOf(matchQ);
        pickMatch(ctl, 0, "a");
        expect(ui.slots!.marks[0].letter).toBe("A");
        ui.slots!.marks[0].letter = "";
        submitMatch(host, matchQ, ctl, 0);
        expect(host.recs).toEqual([]);
        expect(ui.note).toBe("noAnswer");
    });

    it("单行提交：判分锁定 + 逐空记账（不动其他行）", () => {
        const { ctl, ui, host } = ctlOf(matchQ);
        pickMatch(ctl, 0, "b"); // 错
        submitMatch(host, matchQ, ctl, 0);
        expect(host.recs).toEqual([{ qid: "m1#0", submitted: "B", ok: false }]);
        expect(ui.slots!.marks[0]).toEqual({ answered: true, letter: "B", ok: false });
        expect(ui.slots!.marks[1]).toEqual({ answered: false, letter: "", ok: false });
        expect(host.mirrors).toEqual([]); // 未答完不写整题账
        pickMatch(ctl, 0, "A"); // 已答行不可改
        expect(ui.slots!.marks[0].letter).toBe("B");
    });

    it("已答行 pickMatch 草稿被守卫拦下（不重复记账）", () => {
        const { ctl, host } = ctlOf(matchQ);
        pickMatch(ctl, 1, "B");
        submitMatch(host, matchQ, ctl, 1);
        pickMatch(ctl, 1, "A"); // 已答行不可改草稿
        expect(ctl.ui.slots!.marks[1].letter).toBe("B");
        expect(host.recs).toEqual([{ qid: "m1#1", submitted: "B", ok: true }]);
    });

    it("已判分卡提交零动作（收口后不再记账）", () => {
        const { ctl, ui, host } = ctlOf(matchQ);
        ui.graded = true;
        pickMatch(ctl, 0, "A");
        submitMatch(host, matchQ, ctl, 0);
        expect(host.recs).toEqual([]);
    });

    it("两行答完收口：整题账 + 三态 + 结果行", async () => {
        const { ctl, ui, host } = ctlOf(matchQ);
        pickMatch(ctl, 0, "A");
        submitMatch(host, matchQ, ctl, 0);
        pickMatch(ctl, 1, "B");
        submitMatch(host, matchQ, ctl, 1);
        await Promise.resolve();
        expect(host.mirrors).toEqual([{ qid: "m1", submitted: "AB", ok: true }]);
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, true, true]);
        expect(ui.resultStatus).toBe("right");
    });
});

describe("守卫 · 状态缺失", () => {
    it("slots 未构建（非 slots 题）时全部入口零动作", () => {
        const q: WenguQuestion = { ...clozeQ, type: QuestionType.Single, slots: undefined };
        const { ctl, ui, host } = ctlOf(q);
        expect(ui.slots).toBeUndefined();
        gotoSlot(ctl, 0);
        pickSlotOpt(ctl, "A");
        submitSlot(host, q, ctl);
        pickMatch(ctl, 0, "A");
        submitMatch(host, q, ctl, 0);
        expect(host.recs).toEqual([]);
        expect(host.mirrors).toEqual([]);
    });

    it("cloze 全部答完后 fillClozeCur 停在末尾（不越界）", () => {
        const { ctl, ui, host } = ctlOf(clozeQ);
        pickSlotOpt(ctl, "A");
        submitSlot(host, clozeQ, ctl);
        pickSlotOpt(ctl, "B");
        submitSlot(host, clozeQ, ctl);
        fillClozeCur(clozeQ, ui, t);
        expect(ui.slots!.cur).toBe(2); // 停在末尾
        expect(ui.slots!.curOpts.map((o) => o.letter)).toEqual(["A", "B"]); // 快照停在末空（越界即 return）
    });
});
