import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerHost } from "./AnswerFlow";
import { CardCtl } from "../render/CardCtl";
import { buildCardInit, type CardInitCtx, type CardUi } from "../render/CardState";
import { registerCard, unregisterCard } from "../render/CardRegistry";
import { bindStepsMode, nextStep } from "./StepsFlow";
import { QuestionType, type WenguQuestion } from "../../types";

/**
 * steps 挂载分派 bindStepsMode（Issue #115）：StepsDunno.test.ts 锁的是
 * 「不会/跳过/收口」主链，分派这一层**全无测试**——它是「AI 实时模式」
 * 唯一的入口，判错一处就是两种真机事故：
 *  ① 进错分支：已有作答的恢复卡被 startRealtime 清空步骤区重问（用户
 *     上次的作答凭空消失，20260828 二轮审查修的那条）；
 *  ② 漏进分支：ai 模式静默退化成离线静态步骤，用户拿不到实时引导。
 * 故这里只锁分派判据（answered / answeredBefore / stepsMode 三项）与
 * 进入实时后的即时副作用；实时主链本身（逐步提交/收口）不在本文件。
 */

/** 实时步骤出口替身：默认回一步可渲染的步骤，可按需改回放。 */
const rt = {
    reply: () => Promise.resolve({ done: false, step: stepOf("第一步") }) as Promise<unknown>,
    calls: 0,
};
vi.mock("../service/AiJudge", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../service/AiJudge")>();
    return {
        ...orig,
        nextRealtimeStep: vi.fn(async () => {
            rt.calls++;
            return rt.reply();
        }),
    };
});

function stepOf(stem: string): { kind: "method"; stemMd: string; optionMd: string[]; answer: string } {
    return { kind: "method", stemMd: stem, optionMd: ["甲", "乙"], answer: "A" };
}

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

/** 分派只碰 host 的会话与 t/modelId（其余给最小实现）。 */
class FakeHost implements AnswerHost {
    session: { results: { qid: string; submitted: string; ok: boolean }[]; stepsMode?: "offline" | "ai" } | undefined =
        {
            results: [],
            stepsMode: "ai",
        };
    t = t;
    container = (): HTMLElement => ({ querySelector: (): null => null }) as unknown as HTMLElement;
    questions = (): WenguQuestion[] => [stepsQ];
    currentRevealMode = (): "instant" | "after" => "instant";
    timerController = (): never => ({ elapsed: (): number => 0 }) as never;
    currentSession = () => this.session as never;
    aiModelId = (): string => "";
    recordAnswer = (): void => undefined;
    flushTime = (): void => undefined;
    roundComplete = (): void => undefined;
}

function ctlOf(): { ctl: CardCtl; ui: CardUi; host: FakeHost } {
    const host = new FakeHost();
    const ctx: CardInitCtx = { t, interactive: true, locked: false };
    const ui = buildCardInit(stepsQ, ctx);
    const ctl = new CardCtl(host, stepsQ, 0, ui, true);
    registerCard(ctl);
    return { ctl, ui, host };
}

/** 让实时链的 await 全部落地（mock 出口是同步 resolve）。 */
const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

beforeEach(() => {
    rt.calls = 0;
    rt.reply = () => Promise.resolve({ done: false, step: stepOf("第一步") });
});

afterEach(() => unregisterCard({ q: stepsQ } as unknown as CardCtl));

describe("bindStepsMode · 分流判据", () => {
    it("ai 模式 + 零作答痕迹：进入实时（置 rtMode、清静态步骤、拉第一步）", async () => {
        const { ctl, ui, host } = ctlOf();
        expect(ui.steps).toHaveLength(2); // 静态步骤先由 buildCardInit 建好
        bindStepsMode(host, stepsQ, ctl);
        expect(ui.rtMode).toBe(true);
        expect(ui.steps).toHaveLength(0); // 实时模式丢弃静态原型
        expect(ui.note).toBe("aiStepLoading"); // 同步就先给「AI 生成中」提示
        await settle();
        expect(rt.calls).toBe(1);
        expect(ui.steps).toHaveLength(1); // 第一步已追加
        expect(ui.steps![0].stemHtml).toContain("第一步");
        expect(ui.stepCur).toBe(1);
    });

    it("卡上已有已答步骤（恢复回来的卡）：不进实时——不许清空重问", () => {
        const { ctl, ui, host } = ctlOf();
        ui.steps![0].graded = true;
        ui.steps![0].selected = "A";
        bindStepsMode(host, stepsQ, ctl);
        expect(ui.rtMode).toBe(false);
        expect(ui.steps).toHaveLength(2); // 静态步骤原样留着
        expect(rt.calls).toBe(0);
    });

    it("会话里已有逐步账（继续上次）：不进实时", () => {
        const { ctl, ui, host } = ctlOf();
        host.session = { results: [{ qid: "s1#0", submitted: "A", ok: true }], stepsMode: "ai" };
        bindStepsMode(host, stepsQ, ctl);
        expect(ui.rtMode).toBe(false);
        expect(ui.steps).toHaveLength(2);
        expect(rt.calls).toBe(0);
    });

    it("只有题级账（认输过、逐步账为空）：判**未答过**，仍可进实时", () => {
        const { ctl, ui, host } = ctlOf();
        host.session = { results: [{ qid: "s1", submitted: "", ok: false }], stepsMode: "ai" };
        bindStepsMode(host, stepsQ, ctl);
        expect(ui.rtMode).toBe(true);
        expect(ui.steps).toHaveLength(0);
    });

    it("他题的逐步账不算「答过本题」（前缀匹配不漏不误）", () => {
        const { ctl, ui, host } = ctlOf();
        host.session = { results: [{ qid: "s10#0", submitted: "A", ok: true }], stepsMode: "ai" };
        bindStepsMode(host, stepsQ, ctl);
        expect(ui.rtMode).toBe(true);
    });

    it("stepsMode=offline：不进实时，静态步骤保持原样", () => {
        const { ctl, ui, host } = ctlOf();
        host.session = { results: [], stepsMode: "offline" };
        bindStepsMode(host, stepsQ, ctl);
        expect(ui.rtMode).toBe(false);
        expect(ui.steps).toHaveLength(2);
        expect(rt.calls).toBe(0);
    });

    it("无会话（预览/首次挂载）：不进实时", () => {
        const { ctl, ui, host } = ctlOf();
        host.session = undefined;
        bindStepsMode(host, stepsQ, ctl);
        expect(ui.rtMode).toBe(false);
        expect(ui.steps).toHaveLength(2);
    });
});

describe("bindStepsMode · 进入实时后的失败与收口", () => {
    it("拉首步失败：note 收起、rtError 落文案（不把异常抛给挂载链）", async () => {
        rt.reply = () => Promise.reject(new Error("AI 掉线"));
        const { ctl, ui, host } = ctlOf();
        bindStepsMode(host, stepsQ, ctl);
        await settle();
        expect(ui.rtError).toBe("AI 掉线");
        expect(ui.note).toBe("");
        expect(ui.steps).toHaveLength(0);
    });

    it("AI 直接判 DONE：不再追加步骤，走收口（整卡三态 + 实时态不平栈）", async () => {
        rt.reply = () => Promise.resolve({ done: true });
        const { ctl, ui, host } = ctlOf();
        bindStepsMode(host, stepsQ, ctl);
        await settle();
        expect(ui.steps).toHaveLength(0);
        expect([ui.graded, ui.locked, ui.revealed]).toEqual([true, true, true]);
        expect(ui.rtMode).toBe(true); // 实时模式标记保持（收口不清）
    });

    it("已到第一步的卡提交：向 AI 要下一步（实时链真的接上）", async () => {
        const { ctl, ui, host } = ctlOf();
        bindStepsMode(host, stepsQ, ctl);
        await settle();
        expect(rt.calls).toBe(1);
        ui.steps![0].selected = "A";
        await nextStep(host, stepsQ, ctl, 0);
        await settle();
        expect(rt.calls).toBe(2); // 逐步提交接下一次请求
    });

    it("揭示/锁定后实时链冻结：已到步的卡再提交不再向 AI 要下一步", async () => {
        const { ctl, ui, host } = ctlOf();
        bindStepsMode(host, stepsQ, ctl);
        await settle();
        const before = rt.calls;
        ui.revealed = true;
        ui.locked = true;
        ui.steps![0].selected = "A";
        await nextStep(host, stepsQ, ctl, 0);
        await settle();
        expect(rt.calls).toBe(before);
    });
});
