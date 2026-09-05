import { describe, expect, it } from "vitest";
import { abortAiSession, aiAbort, aiFlowBegin, aiFlowEnd } from "./client";

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
    it("单飞闸：占用期间第二个 begin 拒绝，end 后放行", () => {
        expect(aiFlowBegin()).toBe(true);
        expect(aiFlowBegin()).toBe(false);
        aiFlowEnd();
        expect(aiFlowBegin()).toBe(true);
        aiFlowEnd();
    });
});
