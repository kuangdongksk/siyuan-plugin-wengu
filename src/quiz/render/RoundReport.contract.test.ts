import { describe, expect, it } from "vitest";
import { emptyRound } from "./RoundReport";
import type { WenguSession } from "../service/HistoryStore";
import ROUND_REPORT from "./RoundReport.ts?raw";
import QUIZ_INDEX from "../index.ts?raw";
import TIMER_BINDER from "../service/TimerBinder.ts?raw";
import ZH from "../../i18n/zh-CN.json";
import EN from "../../i18n/en.json";

/**
 * 空轮收卷闸（Issue #147）的**唯一性**契约。
 *
 * 收卷入口有两个（头部「结束本次」`endRound` / 倒计时归零时间条「结束本轮」
 * `finishNow`），原实现各写一份判定、`finishNow` 那份**漏写** —— 开倒计时的
 * 用户时间到点按「结束本轮」（`TimerBinder.showTimeUpBar` 的 `onFinish` →
 * `host.finishNow()`），一题没答也收卷出报告，且不报任何错。
 *
 * 闸已收口到 `RoundReport.finishRoundGuarded`，但「收口」本身是**易漂移的
 * 约定**：加第三个收卷入口、或某路绕过守卫直调实现体，功能照旧静默回退。
 * CI 无 jsdom（`vitest.config` environment=node），故行为断言落在纯判定
 * `emptyRound` 上，链路与唯一性用**源级断言**锁死（同 `ClueMarkDom.test.ts`
 * / `SubheadHtml.test.ts` 口径；`?raw` 而非 `node:fs`——本仓无 @types/node）。
 */

const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

const session = (answered: number): WenguSession => ({
    id: "s1",
    docId: "d1",
    startedAt: 1,
    mode: "countUp",
    elapsedSec: 0,
    answered,
    correct: 0,
    results: [],
});

describe("空轮判定（Issue #147）", () => {
    it("answered=0 ⇒ 空轮（两条收卷路都拦）", () => {
        expect(emptyRound(session(0))).toBe(true);
    });

    it("answered>0 ⇒ 非空轮（原有收卷行为不变）", () => {
        expect(emptyRound(session(1))).toBe(false);
        expect(emptyRound(session(20))).toBe(false);
    });

    it("无会话 ⇒ 不算空轮（不在收卷路径上拦「未开轮」，交实现体早退）", () => {
        expect(emptyRound(undefined)).toBe(false);
    });
});

describe("闸下沉收口为唯一出口（Issue #147 · 源码级）", () => {
    it("收卷实现体 manualFinishRound 全仓只有 1 个调用方 —— 守卫体内", () => {
        // 定义 1 次（`export function manualFinishRound`）+ 调用 1 次 = 2
        expect(count(ROUND_REPORT, "manualFinishRound(")).toBe(2);
        // 调用点紧跟在守卫的空轮早退之后（顺序漂了就是「某路绕过闸」）
        expect(ROUND_REPORT).toMatch(
            /export function finishRoundGuarded[\s\S]*?emptyRound\(ctx\.session\)[\s\S]*?return;[\s\S]*?\n {4}manualFinishRound\(ctx\);/
        );
    });

    it("两路入口都只调守卫，谁都不许直调收卷实现体", () => {
        expect(QUIZ_INDEX).not.toMatch(/manualFinishRound\(/);
        // 两处（endRound + finishNow）字面同形，改一路就少一处
        expect(count(QUIZ_INDEX, "finishRoundGuarded(roundFinishCtx(this))")).toBe(2);
    });

    it("倒计时归零时间条那条链确实落在 finishNow 上（漏闸的原始路径）", () => {
        // 链路：showTimeUpBar 的 onFinish → host.finishNow()；换了出口这条就红
        expect(TIMER_BINDER).toMatch(/onFinish:\s*\(\)\s*=>\s*this\.host\.finishNow\(\)/);
        expect(QUIZ_INDEX).toMatch(/readonly finishNow = \(\): void => finishRoundGuarded\(roundFinishCtx\(this\)\)/);
    });

    it("空轮判定 `answered <= 0` 的收卷落点全仓唯一（Head 与 timer 共用一份）", () => {
        expect(count(ROUND_REPORT, "s.answered <= 0")).toBe(1); // 只在 emptyRound 里
        // index.ts 侧不许再有第二份（原泄漏点就在这）
        expect(QUIZ_INDEX).not.toMatch(/answered\s*<=\s*0/);
    });

    it("空轮通知仍是既有 i18n 键 endRoundEmpty（本单不加新键）", () => {
        expect(ROUND_REPORT).toMatch(/notifyInfo\(\{ key: "endRoundEmpty" \}\)/);
        expect(Object.keys(ZH as Record<string, string>)).toContain("endRoundEmpty");
        expect(Object.keys(EN as Record<string, string>)).toContain("endRoundEmpty");
    });
});
