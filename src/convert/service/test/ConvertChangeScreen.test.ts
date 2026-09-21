import { beforeEach, describe, expect, it, vi } from "vitest";
import { read } from "../../../testkit/readSource";
import type { IncrementChoice } from "../../ui/IncrementDialog";
import type { IncrementPlan, StructChunk } from "../source/SrcChunk";

/**
 * 增量「变更块实质判定」精修（Issue #186 A3）的接线单测：
 * 省费模式的选择如何被改写（实质块 → 重转；措辞块 → 保留旧题），
 * 以及**失败回落**两条：判定层抛错＝保持原选择；「不确定」＝当实质。
 *
 * 全 mock transport，不碰真网络；旧题读取注入（免碰题库）。
 */

const jev = { calls: 0, bodies: [] as string[], status: 200 };

/** 是否 A3 请求（`state` 带处号标记——预筛/质检的 state 不是这个形状）。 */
const isChangeReq = (p: string): boolean => p.includes("【第 1 处修改】");

vi.mock("../../../ai/jev/transport", async (importOriginal) => {
    const mod = (await importOriginal()) as Record<string, unknown>;
    return {
        ...mod,
        kernelProxyTransport: async (req: { payload: string }) => {
            if (!isChangeReq(req.payload)) return { status: 200, body: JSON.stringify({ answers: {} }) };
            if (jev.status !== 200) return { status: jev.status, body: "上游不可用" };
            const i = jev.calls++;
            const body = jev.bodies[i] ?? jev.bodies[jev.bodies.length - 1] ?? "";
            return { status: 200, body };
        },
    };
});

import { changeItemsOf, refineKeepOldChoice } from "../run/ConvertChangeScreen";

/** 一批判定的响应体：按块给概率（noul 按名对象）。 */
const body = (ps: number[]): string =>
    JSON.stringify({ answers: Object.fromEntries(ps.map((p, i) => [`q${i}`, { noul: p }])) });

const chunk = (key: string, text: string): StructChunk => ({ key, hash: `h-${key}`, text }) as unknown as StructChunk;

/** 一个变更块（新块 + 一组旧记录 id）。 */
const plan: IncrementPlan = {
    same: 0,
    fresh: [],
    changed: [
        { chunk: chunk("H:a", "新源文 A：结论改为 x=2"), old: { key: "H:a", hash: "old-a", blocks: ["q1"] } },
        { chunk: chunk("H:b", "新源文 B：仅错别字"), old: { key: "H:b", hash: "old-b", blocks: ["q2"] } },
    ],
    removed: [],
};

/** 省费模式的原选择（= keepOldChoice 的口径：全保留）。 */
const base: IncrementChoice = {
    chunks: [],
    deleteQids: [],
    staleQids: ["q1", "q2"],
};

/** 旧题读取注入：按 qid 给 rkramdown 文本。 */
const readOld = async (blocks: string[]): Promise<string> =>
    blocks.map((b) => (b === "q1" ? "第 1 题 求 x 的值，答案 1" : b === "q2" ? "第 2 题 填空题" : "")).join("\n");

beforeEach(() => {
    jev.calls = 0;
    jev.bodies = [];
    jev.status = 200;
});

describe("变更实质判定精修（Issue #186 A3）", () => {
    it("无 key：判定层回「全部当实质」（逐块保守默认值）", async () => {
        // ⚠️ 这是**判定层**的默认值，不是生产行为：生产路径上 `DocOps` 以
        // `isJevEnabled` 为闸（无 key/关开关 ⇒ 根本不挂 `refine`），故无 key
        // 时不会走到这里 —— 见本文件末组「调用侧能力闸」。
        const { choice, summary } = await refineKeepOldChoice(plan, base, { readOldQuestions: readOld });
        expect(summary.substantive).toBe(2);
        expect(choice.chunks.map((c) => c.key)).toEqual(["H:a", "H:b"]);
        expect(choice.deleteQids).toEqual(["q1", "q2"]);
        expect(choice.staleQids).toEqual([]);
    });

    it("两档决策：实质块重转、措辞块保留旧题", async () => {
        jev.bodies = [body([0.95, 0.1])]; // A 实质、B 措辞
        const { choice, summary } = await refineKeepOldChoice(plan, base, {
            readOldQuestions: readOld,
            apiKey: "sk-test",
        });
        expect(summary.checked).toBe(2);
        expect(summary.substantive).toBe(1);
        expect(choice.chunks.map((c) => c.key)).toEqual(["H:a"]); // 只有实质块重转
        expect(choice.deleteQids).toEqual(["q1"]);
        expect(choice.staleQids).toEqual(["q2"]); // 措辞块照旧保留旧题
    });

    it("低置信（0.5）当实质：两块都进重转（与 A2 相反方向的硬口径）", async () => {
        jev.bodies = [body([0.5, 0.5])];
        const { choice, summary } = await refineKeepOldChoice(plan, base, {
            readOldQuestions: readOld,
            apiKey: "sk-test",
        });
        expect(summary.substantive).toBe(2);
        expect(choice.deleteQids).toEqual(["q1", "q2"]);
        expect(choice.staleQids).toEqual([]);
    });

    it("上游 5xx：判定层内部回落成「当实质」⇒ 两块都进重转（宁可多转）", async () => {
        jev.status = 500;
        const { choice, summary } = await refineKeepOldChoice(plan, base, {
            readOldQuestions: readOld,
            apiKey: "sk-test",
        });
        expect(summary.substantive).toBe(2);
        expect(choice.deleteQids).toEqual(["q1", "q2"]);
    });

    it("读旧题抛错：保持原选择（保守，不误删旧题）", async () => {
        const { choice, summary } = await refineKeepOldChoice(plan, base, {
            readOldQuestions: async () => {
                throw new Error("bank 读失败");
            },
            apiKey: "sk-test",
        });
        expect(summary).toEqual({ checked: 0, substantive: 0 });
        expect(choice).toEqual(base);
    });

    it("新增块（fresh）与消失块（removed）不受精修影响：照旧全生成", async () => {
        const p2: IncrementPlan = { ...plan, fresh: [chunk("H:c", "新增")], changed: [plan.changed[0]] };
        jev.bodies = [body([0.1])]; // 明确措辞
        const withFresh: IncrementChoice = { chunks: [chunk("H:c", "新增")], deleteQids: [], staleQids: ["q1"] };
        const { choice } = await refineKeepOldChoice(p2, withFresh, { readOldQuestions: readOld, apiKey: "sk-test" });
        expect(choice.chunks.map((c) => c.key)).toEqual(["H:c"]); // fresh 照旧在
        expect(choice.staleQids).toEqual(["q1"]); // 措辞块保留旧题
    });

    it("旧题取不到的块**仍在清单里**（不许在组装层剔除——那会静默落回「保留旧题」）", async () => {
        const items = await changeItemsOf(plan, async (blocks) => (blocks.includes("q1") ? "旧题" : ""));
        expect(items.map((i) => i.key)).toEqual(["H:a", "H:b"]);
        expect(items[1].oldQuestions).toBe("");
    });

    it("旧题读不到的块按实质处置（宁可多转不漏转），且不占请求位序", async () => {
        const p3: IncrementPlan = {
            ...plan,
            changed: [
                { chunk: chunk("H:a", "新源文 A"), old: { key: "H:a", hash: "old-a", blocks: ["q1"] } },
                { chunk: chunk("H:b", "新源文 B"), old: { key: "H:b", hash: "old-b", blocks: ["gone"] } },
            ],
        };
        jev.bodies = [body([0.1])]; // 唯一可判的那块：明确措辞
        const base3: IncrementChoice = { chunks: [], deleteQids: [], staleQids: ["q1", "gone"] };
        const { choice } = await refineKeepOldChoice(p3, base3, { readOldQuestions: readOld, apiKey: "sk-test" });
        // H:a 措辞 ⇒ 保留旧题；H:b 读不到旧题 ⇒ 当实质 ⇒ 重转
        expect(choice.chunks.map((c) => c.key)).toEqual(["H:b"]);
        expect(choice.deleteQids).toEqual(["gone"]);
        expect(choice.staleQids).toEqual(["q1"]);
    });
});

/**
 * **调用侧能力闸**（源码级回归，Issue #186 验收 1）：
 * `judgeChanges` 无 key 时回「全部当实质」只是**逐块保守默认值**，而 A3 的
 * 「实质」＝先删旧记录再重转 —— 若调用侧无条件采用，无 key 时就会**静默删
 * 数据 + 烧生成调用**。故 `DocOps` 必须以 `isJevEnabled` 为闸、**不挂** `refine`。
 *
 * 纯逻辑测不到这里（`DocOps` 真机链走内核 IO），故按本仓既有口径用
 * `testkit/readSource` 做源码级契约断言（先例：`JevQcReport.test.ts` 末组）。
 */
describe("调用侧能力闸（源码级）", () => {
    it("DocOps 挂 refine 必须同时过 isJevEnabled 闸", async () => {
        const src = await read("/src/quiz/service/DocOps.ts");
        expect(src).toContain("import { isJevEnabled }");
        expect(src).toContain("const refineOn = isJevEnabled(v.settingsOf())");
        expect(src).toContain("compact && refineOn && plan.changed.length > 0");
    });
});
