import { beforeEach, describe, expect, it } from "vitest";
import { aiFlowSnapshot, resetAiFlow } from "../../ai/core/FlowRegistry";
import { runOutlineFlow, OUTLINE_FLOW_ID } from "./KnowOutlineFlow";

/**
 * AI 索引的流级横幅（Issue #77 各流接线 3）：逐篇串行执行体与横幅的
 * begin/progress/end 咬合——**收口在 finally**（正常/中止/失败/异常四条
 * 路径横幅都不残留），中止（ctrl.abort）逐篇与篇间都退出。
 */
const t = (k: string): string => k;

beforeEach(() => resetAiFlow());

describe("AI 索引的流级横幅", () => {
    it("单流态载体：bar + 富统计「已索引 i/n 篇」随进度推进（设计稿单流屏）", async () => {
        const ctrl = new AbortController();
        const { subscribeAiFlow } = await import("../../ai/core/FlowRegistry");
        const seen: { bar?: number; fields?: unknown }[] = [];
        const off = subscribeAiFlow(() => {
            const s = aiFlowSnapshot();
            if (s?.id === OUTLINE_FLOW_ID) seen.push({ bar: s.bar?.pct, fields: s.stats?.fields });
        });
        await runOutlineFlow(t, ["a", "b"], ctrl, async () => 1);
        off();
        // 起流（begin 那次只带 title）后立刻推 bar=0，逐篇推进到 50（i/n）
        expect(seen.some((x) => x.bar === 0)).toBe(true);
        expect(seen.some((x) => x.bar === 50)).toBe(true);
        const first = seen.find((x) => x.bar === 0);
        expect(first?.fields).toEqual([{ hint: "aiFlowStatIndexed", value: "0", tail: "/2 aiFlowUnitItem" }]);
        expect(aiFlowSnapshot()).toBeUndefined();
    });

    it("单篇索引不硬凑推进量（无可报的 i/n，只剩流名 + 停止钮）", async () => {
        const ctrl = new AbortController();
        let withBar = false;
        const { subscribeAiFlow } = await import("../../ai/core/FlowRegistry");
        const off = subscribeAiFlow(() => {
            const s = aiFlowSnapshot();
            if (s?.id === OUTLINE_FLOW_ID && s.bar) withBar = true;
        });
        await runOutlineFlow(t, ["a"], ctrl, async () => 1);
        off();
        expect(withBar).toBe(false);
    });

    it("跑动中在场，收口后清空（end 必达）", async () => {
        const ctrl = new AbortController();
        let seenDuring = false;
        const run = await runOutlineFlow(t, ["d1"], ctrl, async () => {
            seenDuring = aiFlowSnapshot()?.id === OUTLINE_FLOW_ID;
            return 3;
        });
        expect(seenDuring).toBe(true);
        expect(run).toMatchObject({ ok: 1, count: 3 });
        expect(aiFlowSnapshot()).toBeUndefined();
    });

    it("多篇：进度摘要「已索引 i/n 篇」；失败不打断、空文档计入跳过", async () => {
        const ctrl = new AbortController();
        const progress: string[] = [];
        const { subscribeAiFlow } = await import("../../ai/core/FlowRegistry");
        const off = subscribeAiFlow(() => {
            const p = aiFlowSnapshot()?.progress;
            if (p) progress.push(p);
        });
        const run = await runOutlineFlow(t, ["a", "b", "c"], ctrl, async (id) => {
            if (id === "b") throw new Error("doc has no content");
            if (id === "c") throw new Error("boom");
            return 2;
        });
        off();
        expect(run).toMatchObject({ ok: 1, skip: 1, fail: 1, lastErr: "boom" });
        expect(progress.length).toBeGreaterThan(0);
        expect(aiFlowSnapshot()).toBeUndefined();
    });

    it("中止：ctrl.abort 后不再跑后续篇，横幅同样收口", async () => {
        const ctrl = new AbortController();
        const visited: string[] = [];
        await runOutlineFlow(t, ["a", "b", "c"], ctrl, async (id) => {
            visited.push(id);
            ctrl.abort();
            return 1;
        });
        expect(visited).toEqual(["a"]);
        expect(aiFlowSnapshot()).toBeUndefined();
    });

    it("异常路径也收口（worker 抛的是非「空文档」的相对未知错误）", async () => {
        const ctrl = new AbortController();
        await expect(
            runOutlineFlow(t, ["a"], ctrl, async () => {
                throw new Error("kernel down");
            })
        ).resolves.toMatchObject({ fail: 1, lastErr: "kernel down" });
        expect(aiFlowSnapshot()).toBeUndefined();
    });
});
