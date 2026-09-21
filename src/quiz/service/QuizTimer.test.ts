import { describe, expect, it } from "vitest";
import { QuestionTimer } from "./QuizTimer";

/**
 * 单题计时（Issue #182 / 设计稿 v6）纯逻辑红测试。
 *
 * 语义来源：设计稿 `design/UI/单题计时/wengu-focus-timer-redesign.html`
 * 的 `Clock`（acc/since/submitted/frozen）+ 任务书 R1/R3/R4/R5/R7：
 *   - 点击即切：切焦点＝旧题停表、新题开表（切换时刻＝新题计时起点）；
 *   - 提交即结算：sec = 提交时刻 − 本题计时起点，向上取整（<1s 记 1s）；
 *   - 结算后冻结：改答只改对错、不动 sec；brief 的 await 不计入；
 *   - 后台/隐藏不计：`setRun(false)` 停表，恢复后锚点重置（墙钟不计）；
 *   - 同一秒连答两步/两空各记 1 秒。
 */

const T0 = 1_000_000;

describe("QuestionTimer（Issue #182 R1/R3/R4/R5/R7）", () => {
    it("R1 点击即切：切换时刻＝新题计时起点，旧题秒数停在切换点", () => {
        const q = new QuestionTimer();
        q.setRun(true);
        q.focus("q1", T0);
        expect(q.live(T0 + 2500)).toBe(2500);
        // 切换：q1 停表在 2500ms，q2 从此刻起算
        q.focus("q2", T0 + 2500);
        expect(q.secOf("q1")).toBe(3); // 向上取整
        expect(q.live(T0 + 4000)).toBe(1500);
        expect(q.live(T0 + 2500)).toBe(0); // 新题起点即切换时刻
    });

    it("R1 重复 focus 同一题不重置起点（滚动/悬停不切焦点）", () => {
        const q = new QuestionTimer();
        q.setRun(true);
        q.focus("q1", T0);
        q.focus("q1", T0 + 3000);
        expect(q.live(T0 + 5000)).toBe(5000);
    });

    it("R3 提交即结算：向上取整，<1s 记 1s", () => {
        const q = new QuestionTimer();
        q.setRun(true);
        q.focus("q1", T0);
        expect(q.freeze("q1", T0 + 1).sec).toBe(1);
        q.focus("q2", T0 + 1);
        expect(q.freeze("q2", T0 + 4000).sec).toBe(4);
        q.focus("q3", T0 + 4000);
        expect(q.freeze("q3", T0 + 60_400).sec).toBe(60);
        q.focus("q4", T0 + 60_400);
        expect(q.freeze("q4", T0 + 60_401).sec).toBe(1);
    });

    it("R3 结算后返回该题 sec，可读回（卡上静态注记渲染用）", () => {
        const q = new QuestionTimer();
        q.setRun(true);
        q.focus("q1", T0);
        const r = q.freeze("q1", T0 + 12_400);
        expect(r).toEqual({ sec: 13, frozenMs: 12_400 });
        expect(q.secOf("q1")).toBe(13);
    });

    it("R4 结算后冻结：再 focus 改答不重开表、不覆写 sec", () => {
        const q = new QuestionTimer();
        q.setRun(true);
        q.focus("q1", T0);
        q.freeze("q1", T0 + 7000);
        q.focus("q2", T0 + 7000);
        q.focus("q1", T0 + 20_000); // 回来改答案
        expect(q.live(T0 + 25_000)).toBe(0);
        expect(q.freeze("q1", T0 + 30_000).sec).toBe(7); // 仍是首次结算值
        expect(q.submitted("q1")).toBe(true);
    });

    it("R4 brief：await AI 判分前结算，等待期间不计入", () => {
        const q = new QuestionTimer();
        q.setRun(true);
        q.focus("q1", T0);
        const settled = q.freeze("q1", T0 + 9000); // 提交瞬间结算
        q.setRun(false); // AI 等待（面板仍在，但计时不参与）
        expect(settled.sec).toBe(9);
        expect(q.freeze("q1", T0 + 90_000).sec).toBe(9); // 判完再落账不变
    });

    it("R5 隐藏/后台不计：setRun(false) 停表，恢复后锚点重置（墙钟不计）", () => {
        const q = new QuestionTimer();
        q.setRun(true);
        q.focus("q1", T0);
        q.setRun(false, T0 + 3000); // 页签切走
        expect(q.live(T0 + 30_000)).toBe(3000); // 挂后台 27s 不计
        q.setRun(true, T0 + 30_000); // 恢复可见：锚点重置到此刻
        expect(q.live(T0 + 30_000)).toBe(3000);
        expect(q.live(T0 + 31_000)).toBe(4000);
    });

    it("R5 未起跑（setRun(false) 默认）时 focus 不开表，起跑后才算", () => {
        const q = new QuestionTimer();
        q.focus("q1", T0);
        expect(q.live(T0 + 10_000)).toBe(0);
        q.setRun(true, T0 + 10_000);
        expect(q.live(T0 + 11_000)).toBe(1000);
    });

    it("R7 同一秒连答两步/两空：各自 1 秒", () => {
        const q = new QuestionTimer();
        q.setRun(true);
        q.focus("q1#s1", T0);
        expect(q.freeze("q1#s1", T0 + 200).sec).toBe(1);
        q.focus("q1#s2", T0 + 200);
        expect(q.freeze("q1#s2", T0 + 400).sec).toBe(1);
        q.focus("q2#b1", T0 + 400);
        expect(q.freeze("q2#b1", T0 + 600).sec).toBe(1);
    });
});
