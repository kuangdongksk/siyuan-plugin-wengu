import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyAiReview, defaultProgress, type WenguWordProgress } from "../core/WordStore";
import { WordAiRunner, type WordAiInput } from "./WordAi";
import { JEV_ACT_CRITERIA, type JevAct } from "./WordAiJev";
import type { JevAnswer } from "../../ai/jev/client";

/**
 * 判档供给方可插拔的单测（Issue #185 验收标准 1/2）：**全 mock**。
 *
 * 三条硬口径：
 *  1. 无 key（或总开关关）= 生成式通道原样，**现状零变化**；
 *  2. 有 key = Jev 判档供给，落盘动作仍走 `applyAiReview`（FSRS 公式不动）；
 *  3. Jev 抛错 → **整批回落生成式通道**（同上，不是静默跳过）。
 */

// defaultAgentModelId 读 window.siyuan（生成式通道的模型解析）
Reflect.set(globalThis, "window", { setTimeout, clearTimeout });

/** 生成式通道替身（`ai/client` 是它唯一出口）。 */
const chat = vi.hoisted(() => ({ calls: [] as string[], reply: "", fail: false }));
vi.mock("../../ai/client", () => ({
    agentChatOnce: async (prompt: string): Promise<string> => {
        chat.calls.push(prompt);
        if (chat.fail) throw new Error("chat boom");
        return chat.reply;
    },
}));

/** 「无 AI 会话登记」替身（aiTitle/tKey 走 Notify 的注入 i18n）。 */
vi.mock("../../ui/Notify", () => ({ tKey: (k: string): string => k }));

const T = (k: string): string => k;

/** 造一条词画像（判档只需 key/w/m 与作答信号）。 */
function input(w: string, extra: Partial<WordAiInput> = {}): WordAiInput {
    return { index: 0, key: w, w, m: `${w} 的释义`, count: 0, ...extra };
}

/** 组复盘的固定批（runGroup 直接收画像，不经词书查表）。 */
const INPUTS: WordAiInput[] = [input("alpha"), input("beta")];

/** 单批两词的进度：words 里有 FSRS 态（否则 applyAiReview 不挪档）。 */
function progress(): WenguWordProgress {
    const p = defaultProgress();
    p.words.alpha = { d: 5, s: 10, due: 0 };
    p.mistakes.alpha = { count: 1, lastTs: 0 };
    p.words.beta = { d: 5, s: 10, due: 0 };
    return p;
}

/** 高置信 choice + noul 批量答案（choice 值取「档位描述原文」= 下发选项）。 */
function answers(acts: JevAct[], noulP = 0.9): JevAnswer[] {
    const out: JevAnswer[] = [];
    for (const a of acts) {
        const opt = JEV_ACT_CRITERIA[a];
        out.push({ kind: "choice", choice: opt, probabilities: { [opt]: 0.9 }, confidence: 0.9 });
        out.push({ kind: "noul", noul: noulP });
    }
    return out;
}

/** judge 注入替身签名（收批问题清单，返回批量答案）。 */
type JudgeStub = NonNullable<Parameters<WordAiRunner["setJevDeps"]>[0]["judge"]>;

/** 注入注入面：settings + judge（组路径；手动路径另桩 pending）。 */
function runnerWith(judge: JudgeStub, settings: { jevKey?: string; jevEnabled?: boolean } = { jevKey: "sk-test" }) {
    const runner = new WordAiRunner(T);
    runner.setJevDeps({ settings: () => settings, judge });
    return runner;
}

const noopSave = async (): Promise<void> => undefined;
const noopHook = (): void => undefined;

beforeEach(() => {
    chat.calls.length = 0;
    chat.reply = "";
    chat.fail = false;
});

describe("无 key / 总开关关：生成式通道原样（验收标准 1）", () => {
    it("未填 key → 走生成式（agentChatOnce 被调、W/L 行解析落盘）", async () => {
        chat.reply = "W: alpha\nL: up";
        const p = progress();
        const runner = runnerWith(async () => [], {});
        await runner.runGroup(INPUTS, p, noopSave, noopHook);
        expect(chat.calls.length).toBe(1);
        expect(p.words.alpha.s).toBeCloseTo(14); // 10 × 1.4
    });

    it("总开关显式关掉 → 即使有 key 也走生成式（总闸唯一判据）", async () => {
        chat.reply = "W: alpha\nL: up";
        const p = progress();
        const runner = runnerWith(async () => [], { jevKey: "sk-test", jevEnabled: false });
        await runner.runGroup(INPUTS, p, noopSave, noopHook);
        expect(chat.calls.length).toBe(1);
        expect(p.words.alpha.s).toBeCloseTo(14);
    });

    it("完全不注入 deps（旧调用形态）→ 生成式通道，零感知", async () => {
        chat.reply = "W: alpha\nL: down";
        const p = progress();
        const runner = new WordAiRunner(T);
        await runner.runGroup(INPUTS, p, noopSave, noopHook);
        expect(chat.calls.length).toBe(1);
        expect(p.words.alpha.s).toBeCloseTo(5); // 10 × 0.5
    });
});

describe("有 key：Jev 判档供给，落盘口径不变（验收标准 2）", () => {
    it("Jev 判 up → 稳定度 ×1.4；生成式通道一次都不调", async () => {
        const p = progress();
        const runner = runnerWith(async () => answers(["up", "keep"]));
        await runner.runGroup(INPUTS, p, noopSave, noopHook);
        expect(chat.calls.length).toBe(0); // 没走生成式
        expect(p.words.alpha.s).toBeCloseTo(14);
        expect(p.words.beta.s).toBeCloseTo(10); // keep：不动
    });

    it("Jev 判 down → 稳定度减半且明天见（applyAiReview 公式原样）", async () => {
        const p = progress();
        const runner = runnerWith(async () => answers(["down", "down"]));
        await runner.runGroup(INPUTS, p, noopSave, noopHook);
        expect(p.words.alpha.s).toBeCloseTo(5);
        expect(p.words.beta.s).toBeCloseTo(5);
        expect(runner.msg).toBe(""); // runGroup 不写文案（现状口径）
    });

    it("手动 run 的完成文案：Jev 路生效条数照常进 wordAiDone", async () => {
        const p = progress();
        const runner = runnerWith(async () => answers(["up", "keep"]));
        runner.pending = () => INPUTS;
        await runner.run(p, noopSave, noopHook, noopHook);
        expect(runner.msg).toContain("wordAiDone");
        expect(runner.running).toBe(false);
    });

    it("低置信词跳过不动、同批高置信词照常落档（需求 2：比整批放弃更细腻）", async () => {
        const p = progress();
        const runner = runnerWith(async () => [
            { kind: "choice", choice: JEV_ACT_CRITERIA.down, probabilities: {}, confidence: 0.3 }, // 低置信
            { kind: "noul", noul: 0.9 },
            { kind: "choice", choice: JEV_ACT_CRITERIA.up, probabilities: {}, confidence: 0.95 },
            { kind: "noul", noul: 0.9 },
        ]);
        await runner.runGroup(INPUTS, p, noopSave, noopHook);
        expect(p.words.alpha.s).toBeCloseTo(10); // 跳过：原稳定度不动
        expect(p.words.beta.s).toBeCloseTo(14); // 照常升档
    });

    it("判定结果不落盘：progress 无新字段、落盘只走 applyAiReview 既有动作（需求 5）", async () => {
        const p = progress();
        const before = Object.keys(p).sort().join(",");
        let saved = 0;
        const runner = runnerWith(async () => answers(["up", "up"]));
        await runner.runGroup(INPUTS, p, async () => void saved++, noopHook);
        expect(Object.keys(p).sort().join(",")).toBe(before); // 无新字段
        expect(saved).toBeGreaterThan(0);
    });

    it("Jev 路不产 C: 易混推断（需求 4）：confusables 不被写", async () => {
        const p = progress();
        p.mistakes.alpha = { count: 1, lastTs: 0, confused: "alfa" };
        const runner = runnerWith(async () => answers(["down", "down"]));
        await runner.runGroup(INPUTS, p, noopSave, noopHook);
        expect(p.confusables ?? []).toEqual([]);
    });
});

describe("Jev 抛错 → 整批回落生成式通道（口径钉死，验收标准 2 第三条）", () => {
    it("judge 抛 auth/网络错 → 生成式通道接手，同批词照常落档", async () => {
        chat.reply = "W: alpha\nL: up\n\nW: beta\nL: down";
        const p = progress();
        const runner = runnerWith(async () => {
            throw new Error("401 unauthorized");
        });
        await runner.runGroup(INPUTS, p, noopSave, noopHook);
        expect(chat.calls.length).toBe(1); // 回落成功
        expect(p.words.alpha.s).toBeCloseTo(14);
        expect(p.words.beta.s).toBeCloseTo(5);
    });

    it("两条路都失败 → runner 记失败文案（感叹号前缀），不抛给 UI", async () => {
        const p = progress();
        chat.fail = true; // 生成式通道也抛
        const runner = runnerWith(async () => {
            throw new Error("boom");
        });
        runner.pending = () => INPUTS;
        await runner.run(p, noopSave, noopHook, noopHook);
        expect(runner.msg.startsWith("!")).toBe(true);
        expect(runner.running).toBe(false);
    });

    it("多批（>20 词）逐批各自选择供给方：批 1 抛错回落、批 2 用 Jev", async () => {
        chat.reply = "W: w0\nL: up";
        const p = progress();
        const batch: WordAiInput[] = [];
        for (let i = 0; i < 25; i++) {
            const w = `w${i}`;
            p.words[w] = { d: 5, s: 10, due: 0 };
            batch.push(input(w));
        }
        let judgeCalls = 0;
        const runner = runnerWith(async (o) => {
            judgeCalls++;
            if (judgeCalls === 1) throw new Error("429");
            const n = o.questions.length / 2;
            return answers(Array.from({ length: n }, () => "keep" as JevAct));
        });
        await runner.runGroup(batch, p, noopSave, noopHook);
        expect(judgeCalls).toBe(2); // 两批各问一次
        expect(chat.calls.length).toBe(1); // 仅第一批回落到生成式
    });
});

describe("applyAiReview 的 FSRS 动作未被本单改动（验收标准 3）", () => {
    it("up/keep/down 与 tip 的既有语义原样（直接调纯函数锁定）", () => {
        const p = defaultProgress();
        p.words.a = { d: 5, s: 10, due: 0 };
        p.words.b = { d: 5, s: 10, due: 0 };
        p.words.c = { d: 5, s: 10, due: 0 };
        p.mistakes.c = { count: 2, lastTs: 0 };
        applyAiReview(
            p,
            [
                { key: "a", act: "up" },
                { key: "b", act: "keep" },
                { key: "c", act: "down", tip: "辨析提示" },
            ],
            1_000_000_000
        );
        expect(p.words.a.s).toBeCloseTo(14);
        expect(p.words.b.s).toBeCloseTo(10);
        expect(p.words.c.s).toBeCloseTo(5);
        expect(p.words.c.due).toBe(1_000_000_000 + 86_400_000); // down：明天见
        expect(p.mistakes.c.note).toBe("辨析提示");
    });

    it("稳定度上下限（365 / 0.3）原样", () => {
        const p = defaultProgress();
        p.words.a = { d: 5, s: 400, due: 0 };
        p.words.b = { d: 5, s: 0.5, due: 0 };
        applyAiReview(p, [
            { key: "a", act: "up" },
            { key: "b", act: "down" },
        ]);
        expect(p.words.a.s).toBe(365);
        expect(p.words.b.s).toBeCloseTo(0.3);
    });
});

describe("回落只包判定、不包落盘（#185 审查回归：防二次挪档）", () => {
    it("判定成功但 save 抛错 → 不上生成式、不二次挪档，异常按现状口径上抛", async () => {
        chat.reply = "W: alpha\nL: up"; // 若被误回落，生成式会把 alpha 再乘一次 1.4
        const p = progress();
        const runner = runnerWith(async () => answers(["up", "up"]));
        await runner.runGroup(
            INPUTS,
            p,
            async () => {
                throw new Error("disk full");
            },
            noopHook
        );
        expect(chat.calls.length).toBe(0); // 没回落
        expect(p.words.alpha.s).toBeCloseTo(14); // 只挪一次（14，不是 19.6）
        expect(runner.msg.startsWith("!")).toBe(true); // 异常上抛给 runner
    });

    it("判定抛错（进度零改动）→ 照常整批回落生成式", async () => {
        chat.reply = "W: alpha\nL: up";
        const p = progress();
        const runner = runnerWith(async () => {
            throw new Error("403");
        });
        await runner.runGroup(INPUTS, p, noopSave, noopHook);
        expect(chat.calls.length).toBe(1);
        expect(p.words.alpha.s).toBeCloseTo(14);
    });

    it("判定全低置信（0 条生效）≠ 判定失败：不回落、稳定度原样", async () => {
        chat.reply = "W: alpha\nL: up";
        const p = progress();
        const runner = runnerWith(async () => [
            { kind: "choice", choice: JEV_ACT_CRITERIA.up, probabilities: {}, confidence: 0.1 },
            { kind: "noul", noul: 0.9 },
            { kind: "choice", choice: JEV_ACT_CRITERIA.up, probabilities: {}, confidence: 0.1 },
            { kind: "noul", noul: 0.9 },
        ]);
        await runner.runGroup(INPUTS, p, noopSave, noopHook);
        expect(chat.calls.length).toBe(0); // 判定成功了，只是没一条可信
        expect(p.words.alpha.s).toBeCloseTo(10);
    });
});
