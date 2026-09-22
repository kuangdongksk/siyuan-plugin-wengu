import { describe, expect, it } from "vitest";
import {
    buildScreenState,
    planScreenBatches,
    screenChunks,
    screenQuestions,
    SCREEN_BATCH_CHARS,
    type ScreenItem,
} from "./chunkScreen";
import { screenShouldSkip } from "./policy";
import type { JevHttpResponse } from "./transport";

/**
 * 切片预筛（Issue #186 A2）的**纯判定层**单测：全 mock transport，不碰真网络。
 * 断言的四个面：阈值边界 / 批组装（一次请求问一批）/ 失败与缺值回落 /
 * 无 key 一个都不跳。
 */

/** 可注入 mock：按脚本逐次回响应，记录每次 payload。 */
function mockTransport(script: JevHttpResponse[]) {
    const payloads: string[] = [];
    let i = 0;
    const fn = async (req: { payload: string }) => {
        payloads.push(req.payload);
        const res = script[Math.min(i, script.length - 1)];
        i++;
        return res;
    };
    return { fn, payloads };
}

/** 批响应体：每片两项（noul, score）。 */
const body = (pairs: [number, number][], conf = 0.9): string => {
    const answers: Record<string, unknown> = {};
    pairs.forEach(([p, s], idx) => {
        answers[`q${idx * 2}`] = { noul: p };
        answers[`q${idx * 2 + 1}`] = { score: s, confidence: conf };
    });
    return JSON.stringify({ answers });
};

const items: ScreenItem[] = [
    { key: "H:a", text: "第一节 目录…" },
    { key: "H:b", text: "定义与例题…" },
];

describe("会话登记（Issue #201）：判定层把 track 原样递给 judgeJev", () => {
    it("track 不进线上请求体（它只服务登记，判定请求逐字节不变）", async () => {
        const { fn, payloads } = mockTransport([{ status: 200, body: body([[0.1, 1]]) }]);
        await screenChunks([{ key: "k", text: "一小段内容" }], {
            apiKey: "sk-test",
            transport: fn,
            track: { title: "Jev 预筛 · 高等数学" },
        });
        expect(JSON.parse(payloads[0])).not.toHaveProperty("track");
    });

    it("带 track：判定结果与不带时逐字相同（登记只是旁听面）", async () => {
        const withTrack = await screenChunks([{ key: "k", text: "一小段内容" }], {
            apiKey: "sk-test",
            transport: mockTransport([{ status: 200, body: body([[0.1, 1]]) }]).fn,
            track: { title: "Jev 预筛 · 高等数学" },
        });
        const without = await screenChunks([{ key: "k", text: "一小段内容" }], {
            apiKey: "sk-test",
            transport: mockTransport([{ status: 200, body: body([[0.1, 1]]) }]).fn,
        });
        expect(withTrack).toEqual(without);
        expect(withTrack.skipped).toBe(1);
    });

    it("不带 track：判定照跑（登记是可选的旁听面）", async () => {
        const { fn } = mockTransport([{ status: 200, body: body([[0.1, 1]]) }]);
        const r = await screenChunks([{ key: "k", text: "一小段内容" }], { apiKey: "sk-test", transport: fn });
        expect(r.skipped).toBe(1);
    });
});

describe("预筛阈值（policy.screenShouldSkip）", () => {
    it("两个条件都明确成立才跳（noul ≤0.2 且 score ≤2 且置信足够）", () => {
        expect(screenShouldSkip(0.1, 1, 0.9)).toBe(true);
        expect(screenShouldSkip(0.2, 2, 0.7)).toBe(true);
    });

    it("边界：noul 0.21 不跳、score 3 不跳、score 置信 <0.7 不跳", () => {
        expect(screenShouldSkip(0.21, 1, 0.9)).toBe(false);
        expect(screenShouldSkip(0.1, 3, 0.9)).toBe(false);
        expect(screenShouldSkip(0.1, 1, 0.69)).toBe(false);
        expect(screenShouldSkip(0.1, 1, undefined)).toBe(false); // 置信缺失 = 不可用
    });

    it("不确定档（0.2~0.8）与缺值一律不跳", () => {
        expect(screenShouldSkip(0.5, 1, 0.9)).toBe(false);
        expect(screenShouldSkip(Number.NaN, 1, 0.9)).toBe(false);
        expect(screenShouldSkip(undefined, 1, 0.9)).toBe(false);
        expect(screenShouldSkip(0.1, Number.NaN, 0.9)).toBe(false);
    });
});

describe("预筛判定（screenChunks）", () => {
    it("无 key：不判、一个都不跳、零请求", async () => {
        const { fn, payloads } = mockTransport([]);
        const r = await screenChunks(items, { apiKey: "", transport: fn });
        expect(r.skipped).toBe(0);
        expect(r.checked).toBe(0);
        expect(r.verdicts.map((v) => v.skip)).toEqual([false, false]);
        expect(payloads.length).toBe(0);
    });

    it("一次请求问完一片（不是逐片发请求），两题都在同一个 payload 里", async () => {
        const { fn, payloads } = mockTransport([
            {
                status: 200,
                body: body([
                    [0.95, 5],
                    [0.9, 4],
                ]),
            },
        ]);
        const r = await screenChunks(items, { apiKey: "sk-test", transport: fn });
        expect(payloads.length).toBe(1);
        const sent = JSON.parse(payloads[0]) as { questions: Record<string, unknown>; state: string };
        // 两片 × 两问 = 四条，按名对象（q0..q3）
        expect(Object.keys(sent.questions)).toEqual(["q0", "q1", "q2", "q3"]);
        expect(sent.state).toContain("【第 1 片】");
        expect(sent.state).toContain("【第 2 片】");
        expect(r.checked).toBe(2);
        expect(r.skipped).toBe(0);
    });

    it("明确「没料」的片被点名跳过，`checked` 含未跳的片（两者分账）", async () => {
        const { fn } = mockTransport([
            {
                status: 200,
                body: body([
                    [0.05, 1],
                    [0.95, 5],
                ]),
            },
        ]);
        const r = await screenChunks(items, { apiKey: "sk-test", transport: fn });
        expect(r.checked).toBe(2); // 判定成功的片数（含不跳的）
        expect(r.skipped).toBe(1); // 只有第一片被跳
        expect(r.verdicts).toEqual([
            { key: "H:a", judged: true, skip: true },
            { key: "H:b", judged: true, skip: false },
        ]);
    });

    it("不确定档（0.5）不跳——保守是硬口径", async () => {
        const { fn } = mockTransport([
            {
                status: 200,
                body: body([
                    [0.5, 1],
                    [0.5, 1],
                ]),
            },
        ]);
        const r = await screenChunks(items, { apiKey: "sk-test", transport: fn });
        expect(r.skipped).toBe(0);
        expect(r.checked).toBe(2);
    });

    it("响应缺值（回壳没回值）：整批弃掉、一个都不跳", async () => {
        const { fn } = mockTransport([{ status: 200, body: JSON.stringify({ answers: { q0: { noul: null } } }) }]);
        const r = await screenChunks(items, { apiKey: "sk-test", transport: fn });
        expect(r.skipped).toBe(0);
        expect(r.checked).toBe(0);
    });

    it("判定抛错（协议错 / 网络）：静默回落，一个都不跳", async () => {
        const { fn } = mockTransport([{ status: 0, body: "断网" }]);
        const r = await screenChunks(items, { apiKey: "sk-test", transport: fn });
        expect(r.skipped).toBe(0);
        expect(r.checked).toBe(0);
        expect(r.verdicts.every((v) => !v.skip && !v.judged)).toBe(true);
    });

    it("⚠️ 空 key 且**空白片夹在中间**：结论仍按位序落位（不许按 key 归并）", async () => {
        // 真机口径：整卷链的 `ScreenAcc` 传空 key（`key: ""`）——
        // 按 key 归并会把「空白片的未判定」与「真判定的跳过」错配到别的片，
        // 表现为「报告说跳了 1 片，实际跳的是另一片（真没料的片照样烧生成调用）」。
        const withBlank: ScreenItem[] = [
            { key: "", text: "有料的内容" },
            { key: "", text: "   " }, // 空白片夹在中间
            { key: "", text: "又一料" },
        ];
        const { fn } = mockTransport([
            {
                status: 200,
                body: body([
                    [0.05, 1], // 第 1 个非空片：判没料
                    [0.95, 5],
                ]),
            },
        ]);
        const r = await screenChunks(withBlank, { apiKey: "sk-test", transport: fn });
        expect(r.verdicts.map((v) => v.skip)).toEqual([true, false, false]);
        expect(r.verdicts.map((v) => v.judged)).toEqual([true, false, true]);
        expect(r.skipped).toBe(1);
        expect(r.checked).toBe(2); // 空白片不计入判定数
        expect(r.verdicts.length).toBe(withBlank.length); // 与入参严格同长同序
    });

    it("⚠️ 空 key 且跨批（预算断批）时位序不错位", async () => {
        const items2: ScreenItem[] = [
            { key: "", text: "x".repeat(4000) },
            { key: "", text: "   " },
            { key: "", text: "y".repeat(4000) },
        ];
        // 4000 + 空白 + 4000：第一片自成一批、后两片一批 ⇒ 两次请求
        const { fn, payloads } = mockTransport([
            { status: 200, body: body([[0.95, 5]]) },
            { status: 200, body: body([[0.05, 1]]) },
        ]);
        const r = await screenChunks(items2, { apiKey: "sk-test", transport: fn });
        expect(payloads.length).toBe(2);
        expect(r.verdicts.map((v) => v.skip)).toEqual([false, false, true]);
        expect(r.skipped).toBe(1);
    });

    it("结论顺序与入参一致（key 回填）", async () => {
        const mixed: ScreenItem[] = [
            { key: "k1", text: "材料一" },
            { key: "k2", text: "材料二" },
            { key: "k3", text: "材料三" },
        ];
        const { fn } = mockTransport([
            {
                status: 200,
                body: body([
                    [0.9, 5],
                    [0.1, 1],
                    [0.9, 4],
                ]),
            },
        ]);
        const r = await screenChunks(mixed, { apiKey: "sk-test", transport: fn });
        expect(r.verdicts.map((v) => v.key)).toEqual(["k1", "k2", "k3"]);
        expect(r.verdicts[1].skip).toBe(true);
    });
});

describe("批组装", () => {
    it("按字符预算断批（顺序不变、连续覆盖）", () => {
        const long = (n: number): ScreenItem => ({ key: `k${n}`, text: "x".repeat(4000) });
        const batches = planScreenBatches([long(1), long(2), long(3)]);
        expect(batches.map((b) => b.length)).toEqual([1, 1, 1]); // 4000+4000 > 6000 ⇒ 各占一批
        expect(batches.flat().map((b) => b.key)).toEqual(["k1", "k2", "k3"]);
        // 恰好吃满预算的两片仍同批（4000 + 2000 = 6000，不 > 预算）
        const edge = planScreenBatches([
            { key: "a", text: "x".repeat(4000) },
            { key: "b", text: "x".repeat(2000) },
        ]);
        expect(edge.map((b) => b.length)).toEqual([2]);
    });

    it("短切片攒进同一批", () => {
        const batches = planScreenBatches([
            { key: "a", text: "短" },
            { key: "b", text: "短" },
        ]);
        expect(batches.length).toBe(1);
        expect(SCREEN_BATCH_CHARS).toBeGreaterThan(2);
    });

    it("单片超预算时自成一批（不切文本——切片本体是冻结面）", () => {
        const big: ScreenItem = { key: "big", text: "y".repeat(SCREEN_BATCH_CHARS + 1) };
        const batches = planScreenBatches([big, { key: "s", text: "短" }]);
        expect(batches.length).toBe(2);
        expect(batches[0][0].text.length).toBe(SCREEN_BATCH_CHARS + 1);
    });

    it("空文本片不入 state（也不占答案位序）", () => {
        expect(buildScreenState([{ key: "a", text: "  " }]).trim()).toBe("");
        expect(screenQuestions().length).toBe(2);
    });
});
