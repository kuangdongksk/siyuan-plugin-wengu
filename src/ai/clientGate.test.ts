import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentChatContinued, agentChatOnce } from "./client";
import { aiSlotUsage, setAiSlotCapacity } from "./queue";
import { AI_STOPPED, aiSessions, initAiSessions } from "./data/AiSessions";

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

    it("用户中止 → 记录记「停止」哨兵（不是红色失败）", async () => {
        // 满载时排队的那笔被 signal 中止 ⇒ 走确定性中止路径（替身 fetch
        // 不认信号，直发那条不会真断——排队中止才可复现）
        const held = [agentChatOnce("m1", "", 30_000), agentChatOnce("m2", "", 30_000)];
        const ctrl = new AbortController();
        const stopped = agentChatOnce("m3", "", 30_000, ctrl.signal, { kind: "convert", title: "转换 · 卷名" });
        // 用户停止 = 带 AI_STOPPED 理由的中止（裸 abort() 是不带理由的收口，
        // 一律按失败处置——见 client 的 isUserStopOf）
        ctrl.abort(AI_STOPPED);
        await expect(stopped).rejects.toThrowError(/aborted/i);
        const rec = aiSessions()
            ?.list()
            .find((r) => r.kind === "convert");
        expect(rec?.status).toBe("error");
        expect(rec?.error).toBe(AI_STOPPED); // 面板据此出停止态而非失败态
        await Promise.all(held);
    });

    it("不带理由的中止（被兄弟失败连坐断掉）记失败，不误标「停止」", async () => {
        const held = [agentChatOnce("m1", "", 30_000), agentChatOnce("m2", "", 30_000)];
        const ctrl = new AbortController();
        const cut = agentChatOnce("m3", "", 30_000, ctrl.signal, { kind: "convert", title: "转换 · 卷名" });
        ctrl.abort(); // 裸 abort：等同「不是用户点的停止」
        await expect(cut).rejects.toThrowError(/aborted/i);
        const rec = aiSessions()
            ?.list()
            .find((r) => r.kind === "convert");
        expect(rec?.status).toBe("error");
        expect(rec?.error).not.toBe(AI_STOPPED);
        await Promise.all(held);
    });

    it("真失败（服务端报错）仍记错误正文，不误记「停止」哨兵", async () => {
        // 覆写替身 fetch：非 SSE 响应 + msg ⇒ agentChat 抛错，且此时流
        // signal 未断（没有被中止）——必须走 fail 而不是 aborted。
        vi.stubGlobal("fetch", async (url: string): Promise<Response> => {
            if (String(url).includes("saveSession") || String(url).includes("removeSession")) {
                return new Response(JSON.stringify({ code: 0 }), { status: 200 });
            }
            return new Response(JSON.stringify({ msg: "模型返回超时" }), { status: 200 });
        });
        const failed = agentChatOnce("m1", "", 30_000, undefined, { kind: "convert", title: "转换 · 卷名" });
        await expect(failed).rejects.toThrowError(/模型返回超时/);
        const rec = aiSessions()
            ?.list()
            .find((r) => r.kind === "convert");
        expect(rec?.status).toBe("error");
        expect(rec?.error).toBe("模型返回超时");
        expect(rec?.error).not.toBe(AI_STOPPED);
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
