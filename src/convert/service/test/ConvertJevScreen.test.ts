import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BankData, QuestionBank } from "../../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../../bank/data/QuestionBank";
import { SetWriter } from "../output/SetWriter";
import type { StructChunk } from "../source/SrcChunk";

/**
 * 切片预筛（Issue #186 A2）的**端到端接线**：
 *  - 无 key / 总开关关 → 零请求、零跳过、`screened` 恒 0（现状行为）；
 *  - 配了 key → 判定发生在**生成之前**：被判「没料」的块一次生成调用都不烧
 *    （机械证明：生成通道调用数比块数少），且 `screened` 单独计数（与
 *    `empty` 分账）。
 *
 * 内核 IO 全 mock、题库用内存实现；Jev 走注入 transport，**不碰真网络**。
 * 预筛与质检共用同一条传输，故 mock 按 payload 区分两者（见下）。
 */

(globalThis as { window?: unknown }).window ??= globalThis;

const jev = { screen: 0, gen: 0, body: "", skips: -1 };

/** 是否预筛请求：`state` 带片号标记（质检的 state 是题目 + 材料）。 */
const isScreenReq = (p: string): boolean => p.includes("【第 1 片】");

/** 一批里有几片（`state` 的片号标记数——增量链一次请求问完一批）。 */
const countSlices = (payload: string): number => (payload.match(/【第 \d+ 片】/g) ?? []).length;

/** 预筛响应：批内前 `skips` 片判「没料」（noul 0.05 + score 1），其余「有料」。 */
function screenBody(total: number, skips: number): string {
    const answers: Record<string, unknown> = {};
    for (let i = 0; i < total; i++) {
        const skip = i < skips;
        answers[`q${i * 2}`] = { noul: skip ? 0.05 : 0.95 };
        answers[`q${i * 2 + 1}`] = { score: skip ? 1 : 5, confidence: 0.9 };
    }
    return JSON.stringify({ answers });
}

vi.mock("../../../ai/jev/transport", async (importOriginal) => {
    const mod = (await importOriginal()) as Record<string, unknown>;
    return {
        ...mod,
        kernelProxyTransport: async (req: { payload: string }) => {
            if (!isScreenReq(req.payload)) return { status: 200, body: jev.body };
            jev.screen++;
            // 增量链一次请求问完一批：批内前 `skips` 片判「没料」
            const total = countSlices(req.payload);
            return { status: 200, body: screenBody(total, jev.skips) };
        },
    };
});

vi.mock("../../../ai/client", () => ({
    newAiGroupId: () => "g-test",
    aiStopHandle: (signal: AbortSignal) => ({ signal, onSid: (): void => undefined }),
    agentChatOnce: vi.fn(async () => {
        jev.gen++;
        return REPLY;
    }),
}));

const REPLY = `@@Q type=single
@@P stem
求 $\\lim_{x \\to 0}\\frac{\\sin x}{x}$。
@@P opt
$1$
@@P opt
$0$
@@P ans
A
@@P sol
等价无穷小。
@@END`;

function newBank(): QuestionBank {
    let cache: BankData | undefined;
    return new Bank(
        async () =>
            (cache ??= {
                version: 1,
                records: {},
                collections: [],
                migratedDocs: [],
                hashed: {},
                knowRoots: [],
                folders: [],
                knowHidden: [],
                docStats: {},
                sets: {},
                materials: {},
            } as BankData),
        async (v) => {
            cache = v;
        }
    );
}

import { convertIncremental } from "../run/ConvertIncrement";

const chunk = (key: string): StructChunk =>
    ({ key, hash: `h-${key}`, text: "块正文：" + "内容-".repeat(40) }) as unknown as StructChunk;

beforeEach(() => {
    jev.screen = 0;
    jev.gen = 0;
    jev.body = JSON.stringify({ answers: {} }); // 质检侧协议错 ⇒ 本单不掺存疑
    jev.skips = 0;
});

async function runIncr(n: number, settings?: { jevKey?: string; jevEnabled?: boolean }) {
    const bank = newBank();
    const setId = await new SetWriter(bank).openSet({ title: "题集", srcId: "doc-1" });
    await bank.flush();
    const chunks = [chunk("H:a"), chunk("H:b"), chunk("H:c")];
    const res = await convertIncremental({
        deleteQids: [],
        staleQids: [],
        chunks,
        setId,
        bank,
        modelId: "m",
        fillToChoice: false,
        bigToSteps: false,
        ...(settings ? { settingsOf: () => settings } : {}),
    });
    return { res, bank, n };
}

describe("增量链切片预筛（Issue #186 A2）", () => {
    it("无 key：零预筛请求、`screened` 为 0、生成调用数 = 块数（现状行为）", async () => {
        const { res } = await runIncr(0);
        expect(jev.screen).toBe(0);
        expect(res.screened).toBe(0);
        expect(jev.gen).toBe(3); // 三块都照旧烧生成调用
        expect(res.added).toBeGreaterThan(0);
    });

    it("总开关显式关：同样零请求、零跳过", async () => {
        const { res } = await runIncr(0, { jevKey: "sk-test", jevEnabled: false });
        expect(jev.screen).toBe(0);
        expect(res.screened).toBe(0);
        expect(jev.gen).toBe(3);
    });

    it("配了 key：被判「没料」的块**一次生成调用都没烧**，且计入 `screened`", async () => {
        jev.skips = 1; // 批内第一片被判「没料」⇒ 第一块被跳
        const { res } = await runIncr(1, { jevKey: "sk-test" });
        expect(res.screened).toBe(1);
        expect(jev.screen).toBe(1); // 一次请求问完一批（不是逐块发）
        expect(jev.gen).toBe(2); // 只剩两块进生成（省下的就是这一笔）
        expect(res.added).toBeGreaterThan(0);
    });

    it("`screened` 与 `empty` 分账：跳过的块不计入零产物块数", async () => {
        jev.skips = 2;
        const { res } = await runIncr(2, { jevKey: "sk-test" });
        expect(res.screened).toBe(2);
        expect(res.empty).toBe(0); // 跳过 ≠ 烧了调用却没有产物
        expect(jev.gen).toBe(1);
    });

    it("预筛失败（协议错）：一个都不跳，生成调用数照旧 = 块数", async () => {
        jev.skips = 0;
        jev.body = JSON.stringify({ answers: {} });
        const { res } = await runIncr(0, { jevKey: "sk-test" });
        expect(jev.gen).toBe(3);
        expect(res.screened).toBe(0);
    });
});

/* ── 整卷链的端到端接线（Issue #186 A2） ── */

vi.mock("../../../siyuan/query", () => ({
    KernelQuery: {
        rows: vi.fn(async () => [{ id: "20260910000000-abcdefg", box: "nb", content: "测试卷" }] as unknown[]),
        rowsAll: vi.fn(async (): Promise<unknown[]> => []),
    },
}));
vi.mock("../../../siyuan/doc", () => ({
    KernelDoc: { hPath: vi.fn(async () => ({ code: 0, data: "/讲义/测试卷" })) },
}));
const DOC = ["# 第一章 极限", "", "本节讲极限定义与等价无穷小。" + "正文-".repeat(120), ""].join("\n");
vi.mock("../../../siyuan/block", () => ({
    KernelBlock: { kramdown: vi.fn(async () => ({ code: 0, data: { kramdown: DOC } })) },
}));

import { convertDocBatched } from "../run/ConvertBatch";

async function runWhole(settings?: { jevKey?: string; jevEnabled?: boolean }) {
    const bank = newBank();
    const r = await convertDocBatched("20260910000000-abcdefg", {
        t: (k) => k,
        modelId: "m",
        fillToChoice: false,
        bigToSteps: false,
        parallel: 1,
        bank,
        onProgress: () => undefined,
        ...(settings ? { settingsOf: () => settings } : {}),
    });
    return r;
}

describe("整卷链切片预筛（Issue #186 A2）", () => {
    it("无 key：零预筛请求、完成消息里没有预筛字样（现状行为）", async () => {
        jev.screen = 0;
        jev.gen = 0;
        const r = await runWhole();
        expect(r.status).toBe("done");
        expect(jev.screen).toBe(0);
        expect(r.message).not.toContain("jevScreen");
        expect(jev.gen).toBeGreaterThan(0);
    });

    it("总开关关：同上（零请求、零留痕）", async () => {
        jev.screen = 0;
        const r = await runWhole({ jevKey: "sk-test", jevEnabled: false });
        expect(jev.screen).toBe(0);
        expect(r.message).not.toContain("jevScreen");
    });

    it("配了 key 且判「没料」：不进生成 AI，完成消息带「跳过 N 块」计数", async () => {
        jev.screen = 0;
        jev.gen = 0;
        jev.skips = 1; // 首个窗口判「没料」
        const r = await runWhole({ jevKey: "sk-test" });
        expect(jev.screen).toBeGreaterThan(0);
        expect(r.message).toContain("jevScreenSkipped");
    });
});
