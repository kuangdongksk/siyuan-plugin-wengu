import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentChatContinued, agentChatOnce } from "./client";
import { aiSlotUsage, setAiSlotCapacity } from "./queue";
import { aiSessions, initAiSessions } from "./data/AiSessions";

/** 内核通道整体打桩：验证「两条对外通道都过全局在途闸」只需计数，
 *  不必真建 SSE（siyuan-stub 的 fetchSyncPost 抛错即 IO 覆盖不当）。 */
vi.mock("../ui/Notify", () => ({
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
    initNotify: (): void => undefined,
}));

const state = { inFlight: 0, peak: 0, releaseAll: false, seq: [] as string[] };

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        async start(c) {
            for (const t of chunks) {
                c.enqueue(enc.encode(`event: content\ndata: ${JSON.stringify({ token: t })}\n\n`));
                // 在途期间挂住，直到用例放行——把「同时几笔在跑」钉死
                await new Promise((r) => setTimeout(r, 5));
            }
            c.close();
        },
    });
}

beforeEach(() => {
    state.inFlight = 0;
    state.peak = 0;
    state.releaseAll = false;
    state.seq = [];
    setAiSlotCapacity(2);
    initAiSessions({
        load: async (): Promise<unknown> => ({}),
        save: async (): Promise<unknown> => undefined,
    });
    vi.stubGlobal("window", { siyuan: { config: { lang: "zh_CN" } } } as unknown as typeof window);
    vi.stubGlobal("fetch", async (url: string): Promise<Response> => {
        if (String(url).includes("saveSession") || String(url).includes("removeSession")) {
            return new Response(JSON.stringify({ code: 0 }), { status: 200 });
        }
        state.inFlight++;
        state.peak = Math.max(state.peak, state.inFlight);
        state.seq.push(`+${state.inFlight}`);
        const body = sseBody(["a", "b"]);
        const stream = new ReadableStream<Uint8Array>({
            async start(c) {
                const reader = body.getReader();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    c.enqueue(value);
                }
                c.close();
                state.inFlight--;
            },
        });
        return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    });
});

describe("全局在途闸接线（Issue #76：两条对外通道都取槽）", () => {
    it("agentChatOnce：容量 2 时并发在途数峰值 ≤ 2", async () => {
        const calls = ["m1", "m2", "m3", "m4"].map((m) => agentChatOnce(m, "", 30_000));
        const out = await Promise.all(calls);
        expect(out).toEqual(["ab", "ab", "ab", "ab"]);
        expect(state.peak).toBeLessThanOrEqual(2);
        expect(aiSlotUsage()).toMatchObject({ used: 0, waiting: 0 });
    });

    it("agentChatContinued 与 agentChatOnce 竞争同一组槽位（重试不再直发第 N+1 笔）", async () => {
        const once = ["m1", "m2"].map((m) => agentChatOnce(m, "", 30_000));
        const cont = agentChatContinued([{ role: "user", text: "old" }], "retry", "", 30_000);
        const [a, b, c] = await Promise.all([...once, cont]);
        expect([a, b, c]).toEqual(["ab", "ab", "ab"]);
        expect(state.peak).toBeLessThanOrEqual(2);
        expect(aiSlotUsage()).toMatchObject({ used: 0, waiting: 0 });
    });

    it("排队中的调用可被 signal 中止（出队不残留，槽账不留残影）", async () => {
        const ctrl = new AbortController();
        const held = [agentChatOnce("m1", "", 30_000), agentChatOnce("m2", "", 30_000)];
        const queued = agentChatOnce("m3", "", 30_000, ctrl.signal);
        ctrl.abort();
        await expect(queued).rejects.toThrowError(/aborted/i);
        await Promise.all(held);
        expect(aiSlotUsage()).toMatchObject({ used: 0, waiting: 0 });
        expect(state.peak).toBeLessThanOrEqual(2);
    });

    it("排队可见性：满载时记录标 queued（面板显示「等待空闲通道…」），取到槽即清", async () => {
        const held = [agentChatOnce("m1", "", 30_000, undefined, { kind: "judge" }), agentChatOnce("m2", "", 30_000)];
        const queued = agentChatOnce("m3", "", 30_000, undefined, { kind: "convert" });
        // 第三笔已登记且排着队——面板详情据此显示「等待空闲通道…」
        const rec = aiSessions()
            ?.list()
            .find((r) => r.kind === "convert");
        expect(rec?.status).toBe("running");
        expect(rec?.queued).toBe(true);
        await Promise.all([...held, queued]);
        // 取到槽（乃至收口）后标记清掉：不留「已完成 · 等待中」的矛盾组合
        const done = aiSessions()
            ?.list()
            .find((r) => r.kind === "convert");
        expect(done?.status).toBe("done");
        expect(done?.queued).toBeUndefined();
    });
});
