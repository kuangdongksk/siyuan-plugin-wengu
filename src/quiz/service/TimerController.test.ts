import { describe, expect, it } from "vitest";
import { TimerController } from "./TimerController";

/** 计时状态机不变量（20260828 审查修复：elapsed 单调性锁死）。 */
describe("TimerController", () => {
    it("consume 并入 base：每 15s flush 后 elapsed 单调不塌缩", () => {
        const t = new TimerController(() => {});
        t.start("countUp", 20, 100); // 继续上轮 base=100
        const seen: number[] = [];
        for (let i = 1; i <= 40; i++) {
            t.tick();
            seen.push(t.elapsed());
            if (t.pending % 15 === 0) t.consume(); // TimerBinder 自动 flush 同款节奏
        }
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
        expect(t.elapsed()).toBe(140); // 100 + 40，无重复累计
        expect(t.consume()).toBe(10); // 尾段余量；再读 elapsed 仍 140
        expect(t.elapsed()).toBe(140);
    });

    it("consume 返回本段增量供 total-time 落库，逐次取走不重不漏", () => {
        const t = new TimerController(() => {});
        t.start("countUp", 20);
        for (let i = 0; i < 10; i++) t.tick();
        expect(t.consume()).toBe(10);
        for (let i = 0; i < 5; i++) t.tick();
        expect(t.consume()).toBe(5);
        expect(t.elapsed()).toBe(15);
    });

    it("逐题秒数：setQuestion 切换后各记各的，takeQuestionSec 不清零", () => {
        const t = new TimerController(() => {});
        t.start("perQuestion", 5);
        t.setQuestion("q1");
        for (let i = 0; i < 3; i++) t.tick();
        t.setQuestion("q2");
        for (let i = 0; i < 4; i++) t.tick();
        expect(t.takeQuestionSec("q1")).toBe(3);
        expect(t.takeQuestionSec("q2")).toBe(4);
    });
});
