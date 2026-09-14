import { describe, expect, it } from "vitest";
import { abortAiSession, aiAbort, aiFlowBegin, aiFlowEnd, aiStopHandle } from "./client";

/**
 * 后台流的中止接线与单飞闸（20260905 弹窗去阻塞改造的机制层）：
 * onSid 注册的记录 id 能被 abortAiSession 精确触发；未注册/已收口静默
 * 返 false（转换等自带停止面的流不受影响）；单飞闸占用期间拒绝并发。
 */
describe("ai 中止接线与单飞闸", () => {
    it("aiAbort 句柄经 onSid 注册后可被 abortAiSession 触发", () => {
        const h = aiAbort();
        expect(h.signal.aborted).toBe(false);
        expect(abortAiSession("sid-x")).toBe(false); // 未注册静默
        h.onSid("sid-x");
        expect(abortAiSession("sid-x")).toBe(true);
        expect(h.signal.aborted).toBe(true);
    });
    it("同一句柄多次 onSid 覆盖、触发一次即净", () => {
        const h = aiAbort();
        h.onSid("a");
        h.onSid("b");
        expect(abortAiSession("a")).toBe(true);
        expect(abortAiSession("b")).toBe(true); // 各自的 id 各自触发
        expect(h.signal.aborted).toBe(true);
    });
    it("aiStopHandle：停止回调形态句柄（业务流自带总闸）注册后可被面板点停调用", () => {
        // Issue #72：转换族的停止语义是「等价于页内停止」整条流收口
        //（stopConvertRun → internal.abort()），不是只断当前这一笔 fetch
        // ——故句柄值放宽成「可中止句柄」，这里锁回调形态。
        const ctrl = new AbortController();
        let calls = 0;
        const h = aiStopHandle(ctrl.signal, () => {
            calls++;
            ctrl.abort();
        });
        expect(h.signal).toBe(ctrl.signal);
        expect(abortAiSession("sid-stop")).toBe(false); // 未注册静默
        h.onSid("sid-stop");
        expect(abortAiSession("sid-stop")).toBe(true);
        expect(calls).toBe(1);
        expect(ctrl.signal.aborted).toBe(true);
        // 触发一次即净：同 id 再点不重复调（防重试风暴）
        expect(abortAiSession("sid-stop")).toBe(false);
        expect(calls).toBe(1);
    });
    it("aiStopHandle 与 aiAbort 混用不互相干扰（各自形态各自触发）", () => {
        const ctrl = new AbortController();
        const stop = aiStopHandle(ctrl.signal, () => ctrl.abort());
        const generic = aiAbort();
        stop.onSid("s1");
        generic.onSid("s2");
        expect(abortAiSession("s2")).toBe(true);
        expect(generic.signal.aborted).toBe(true);
        expect(ctrl.signal.aborted).toBe(false); // 回调形态未被误 abort
        expect(abortAiSession("s1")).toBe(true);
        expect(ctrl.signal.aborted).toBe(true);
    });
    it("单飞闸：占用期间第二个 begin 拒绝，end 后放行", () => {
        expect(aiFlowBegin()).toBe(true);
        expect(aiFlowBegin()).toBe(false);
        aiFlowEnd();
        expect(aiFlowBegin()).toBe(true);
        aiFlowEnd();
    });
});
