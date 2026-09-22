import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BankData, QuestionBank } from "../../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../../bank/data/QuestionBank";

/**
 * 切片预筛（Issue #186 A2）的**端到端接线**（整卷链）：
 *  - 无 key / 总开关关 → 零请求、零跳过（现状行为）；
 *  - 配了 key → 判定发生在**生成之前**：被判「没料」的窗口一次生成调用都不烧。
 *
 * 内核 IO 全 mock、题库用内存实现；Jev 走注入 transport，**不碰真网络**。
 * 预筛与质检共用同一条传输，故 mock 按 payload 区分两者（见下）。
 *
 * 增量链侧的同名用例随旧代增量路径退役（Issue #212，20260922）——
 * 当时的口径是「被判没料的块在进生成 AI 之前拦下、`screened` 与 `empty`
 * 分账」，那两处分账字段都已不存在。
 */

(globalThis as { window?: unknown }).window ??= globalThis;

const jev = { screen: 0, gen: 0, body: "", skips: -1 };

/** 是否预筛请求：`state` 带片号标记（质检的 state 是题目 + 材料）。 */
const isScreenReq = (p: string): boolean => p.includes("【第 1 片】");

/** 一批里有几片（`state` 的片号标记数）。 */
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
            // 一批一次问完：批内前 `skips` 片判「没料」
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
                docStats: {},
                sets: {},
                materials: {},
            } as BankData),
        async (v) => {
            cache = v;
        }
    );
}

beforeEach(() => {
    jev.screen = 0;
    jev.gen = 0;
});

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

describe("切片预筛端到端接线（Issue #186 A2）", () => {
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
