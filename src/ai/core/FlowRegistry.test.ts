import { describe, expect, it, beforeEach } from "vitest";
import {
    aiFlowSnapshot,
    beginAiFlow,
    chooseAiFlow,
    endAiFlow,
    progressAiFlow,
    resetAiFlow,
    setAiFlowStop,
    stopAiFlow,
    subscribeAiFlow,
} from "./FlowRegistry";
import { bannerViewOf } from "./FlowBannerUi";

/**
 * 流级横幅注册表（Issue #77）：begin/progress/end 生命周期、**单条横幅
 * 约束**（后来者不顶掉在跑的流）、end 后面板清空、停止经注册的句柄透传，
 * 外加「end 必达」的 finally 语义锁（launchAiFlow 侧）。
 */
describe("AI 流注册表", () => {
    beforeEach(() => resetAiFlow());

    it("begin → progress → end 生命周期：快照逐态推进、end 后清空", () => {
        expect(aiFlowSnapshot()).toBeUndefined();
        expect(beginAiFlow({ id: "a", title: "转换" })).toBe(true);
        expect(aiFlowSnapshot()).toMatchObject({ id: "a", title: "转换", phase: "running" });
        progressAiFlow("a", "已读 30% · 累计 12 题", "3 篇完成");
        expect(aiFlowSnapshot()).toMatchObject({ progress: "已读 30% · 累计 12 题", extra: "3 篇完成" });
        endAiFlow("a");
        expect(aiFlowSnapshot()).toBeUndefined();
    });

    it("单条横幅约束：在跑时不覆盖（先到先得），同 id 重复 begin 幂等刷新", () => {
        expect(beginAiFlow({ id: "a", title: "转换" })).toBe(true);
        expect(beginAiFlow({ id: "b", title: "匹配" })).toBe(false); // 被拒
        expect(aiFlowSnapshot()).toMatchObject({ id: "a", title: "转换" });
        // 同 id 重复 begin = 刷新（不改变归属），仍返回 true
        expect(beginAiFlow({ id: "a", title: "转换·改名" })).toBe(true);
        endAiFlow("a");
        expect(beginAiFlow({ id: "b", title: "匹配" })).toBe(true); // 槽空后放行
    });

    it("不属本流的 progress/end 静默忽略（幂等，不误伤在跑的流）", () => {
        beginAiFlow({ id: "a", title: "转换" });
        progressAiFlow("b", "别的流");
        endAiFlow("b");
        expect(aiFlowSnapshot()).toMatchObject({ id: "a", title: "转换", progress: undefined });
    });

    it("停止经注册句柄透传；无 stop 的流不可停（返回 false 零动作）", () => {
        let calls = 0;
        beginAiFlow({ id: "a", title: "匹配", stop: () => calls++ });
        expect(stopAiFlow()).toBe(true);
        expect(calls).toBe(1);
        // 触发后流仍在（由业务体收口时 end）——停止不自动 end
        expect(aiFlowSnapshot()).toMatchObject({ id: "a" });
        endAiFlow("a");
        beginAiFlow({ id: "b", title: "判分" }); // 单调用流：不挂 stop
        expect(stopAiFlow()).toBe(false);
        expect(calls).toBe(1);
    });

    it("晚期挂 stop（句柄在业务体里才拿得到时补挂）", () => {
        beginAiFlow({ id: "a", title: "转换" });
        expect(stopAiFlow()).toBe(false);
        let calls = 0;
        setAiFlowStop("a", () => calls++);
        expect(stopAiFlow()).toBe(true);
        expect(calls).toBe(1);
    });

    it("待抉择态：转 choice 后出保留/丢弃、停止钮撤下", () => {
        beginAiFlow({ id: "a", title: "转换", stop: (): void => undefined });
        let kept = 0;
        let dropped = 0;
        chooseAiFlow("a", "已生成的 12 题要保留吗", {
            keep: () => kept++,
            discard: () => dropped++,
        });
        const snap = aiFlowSnapshot();
        expect(snap).toMatchObject({ phase: "choice", stop: undefined });
        const view = bannerViewOf(snap, false);
        expect(view).toMatchObject({ choosing: true, stopping: false });
        snap?.choice?.keep();
        snap?.choice?.discard();
        expect([kept, dropped]).toEqual([1, 1]);
        endAiFlow("a"); // 抉择落定 → 横幅消失
        expect(aiFlowSnapshot()).toBeUndefined();
    });

    it("订阅：每次变更通知一次，退订后不再收", () => {
        let n = 0;
        const off = subscribeAiFlow(() => n++);
        beginAiFlow({ id: "a", title: "转换" });
        progressAiFlow("a", "x");
        endAiFlow("a");
        expect(n).toBe(3);
        off();
        beginAiFlow({ id: "b", title: "匹配" });
        expect(n).toBe(3);
    });

    it("视图模型：running 出停止钮（两击确认文案随 armed 变）、待抉择出保留/丢弃", () => {
        expect(bannerViewOf(undefined, false)).toBeUndefined();
        const snap = { id: "a", title: "转换", phase: "running" as const, stop: (): void => undefined };
        expect(bannerViewOf(snap, false)).toMatchObject({ stopping: true, stopKey: "aiFlowStop" });
        expect(bannerViewOf(snap, true)).toMatchObject({ stopping: true, stopKey: "aiFlowStopConfirm" });
        // 不可停的流不出停止钮（单调用流/未接线业务体），但横幅照常显示流名
        expect(bannerViewOf({ id: "b", title: "x", phase: "running" }, false)).toMatchObject({ stopping: false });
    });
});

describe("launchAiFlow 的流级登记与 end 必达", () => {
    beforeEach(() => resetAiFlow());

    it("正常收口：成功路径 end（finally），横幅不残留", async () => {
        const { launchAiFlow } = await import("../flow");
        const { aiFlowEnd, aiFlowBegin } = await import("../client");
        // 独占单飞闸（launchAiFlow 内部依赖它；测试里直接调保证前后干净）
        aiFlowBegin();
        aiFlowEnd();
        const done = new Promise<void>((resolve) => {
            launchAiFlow({ title: "匹配知识文档" }, async (stop) => {
                expect(stop.stop).toBeTypeOf("function"); // 流句柄带总闸（横幅停止用）
                resolve();
            });
        });
        await done;
        await new Promise((r) => setTimeout(r, 0)); // 让 finally 跑完
        expect(aiFlowSnapshot()).toBeUndefined();
    });

    it("异常路径 end 必达：业务体抛错横幅同样清空", async () => {
        const { launchAiFlow } = await import("../flow");
        launchAiFlow({ title: "生成标签" }, async () => {
            throw new Error("boom");
        });
        await new Promise((r) => setTimeout(r, 0));
        expect(aiFlowSnapshot()).toBeUndefined();
    });

    it("流中可见：业务体在跑时横幅在场且有停止句柄", async () => {
        const { launchAiFlow } = await import("../flow");
        let seen: string | undefined;
        let armed = false;
        const p = new Promise<void>((resolve) => {
            launchAiFlow({ title: "变式重练" }, async () => {
                seen = aiFlowSnapshot()?.title;
                armed = bannerViewOf(aiFlowSnapshot(), false)?.stopping === true;
                resolve();
            });
        });
        await p;
        expect(seen).toBe("变式重练");
        expect(armed).toBe(true);
    });

    it("单飞闸占用时不起流（横幅不登记）——防第二份任务顶掉停止钮", async () => {
        const { launchAiFlow } = await import("../flow");
        const { aiFlowBegin } = await import("../client");
        expect(aiFlowBegin()).toBe(true); // 模拟已有流在跑
        launchAiFlow({ title: "收集补题" }, async () => undefined);
        expect(aiFlowSnapshot()).toBeUndefined();
        (await import("../client")).aiFlowEnd();
    });
});
