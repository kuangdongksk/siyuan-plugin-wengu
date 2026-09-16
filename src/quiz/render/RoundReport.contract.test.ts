import { describe, expect, it } from "vitest";
import { emptyRound } from "./RoundReport";
import type { WenguSession } from "../service/HistoryStore";
import ROUND_REPORT from "./RoundReport.ts?raw";
import QUIZ_INDEX from "../index.ts?raw";
import TIMER_BINDER from "../service/TimerBinder.ts?raw";
import MOBILE_DRILL from "../../mobile/core/MobileDrill.ts?raw";
import MOBILE_ROUND from "../../mobile/core/MobileRound.ts?raw";
import ZH from "../../i18n/zh-CN.json";
import EN from "../../i18n/en.json";

/**
 * 空轮收卷闸（Issue #147）与**静默关轮**（Issue #155 块 A）的**唯一性**契约。
 *
 * 收卷入口有两个（头部「结束本次」`endRound` / 倒计时归零时间条「结束本轮」
 * `finishNow`），原实现各写一份判定、`finishNow` 那份**漏写** —— 开倒计时的
 * 用户时间到点按「结束本轮」（`TimerBinder.showTimeUpBar` 的 `onFinish` →
 * `host.finishNow()`），一题没答也收卷出报告，且不报任何错。
 *
 * 闸已收口到 `RoundReport.finishRoundGuarded`，但「收口」本身是**易漂移的
 * 约定**：加第三个收卷入口、或某路绕过守卫直调实现体，功能照旧静默回退。
 * **#155 块 A 反转语义**：用户走查原话「我可以就进来然后关掉」——空轮点
 * 「结束本次」被 #147 的通知挡住是**错的**，改为**静默关轮**（不落库、不出
 * 报告、清会话态回可开新轮），故 #147 的「不收卷 + 通知」两条断言全部反转。
 *
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

describe("空轮判定（Issue #147 / #155 块 A）", () => {
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

    it("「不会」（记 ok=false 的作答）算已作答，不属空轮", () => {
        // answered 在记账时已 +1（AnswerFlow.recordAnswer），故只需断言
        // 判定只看 answered、不看 correct：「全错」也不是空轮
        expect(emptyRound(session(1))).toBe(false);
        expect(emptyRound({ ...session(3), correct: 0 })).toBe(false);
    });
});

describe("空轮静默关轮（Issue #155 块 A）· 源级", () => {
    it("空轮分支不再通知、改成关轮（#147 的 notifyInfo 必须已摘）", () => {
        expect(ROUND_REPORT).not.toMatch(/notifyInfo\(\{ key: "endRoundEmpty" \}\)/);
        expect(ROUND_REPORT).not.toContain("notifyInfo");
        expect(ROUND_REPORT).toMatch(/emptyRound\(ctx\.session\)[\s\S]*?closeEmptyRound\(ctx\);\s*return;/);
    });

    it("空轮执行体 `closeEmptyRound` 全仓只有 1 个调用方 —— 收卷守卫体内", () => {
        expect(count(ROUND_REPORT, "closeEmptyRound(")).toBe(2); // 定义 1 + 调用 1
        // 关轮三件：不落库清会话 → 停表（started=false） → 收态重画头部
        const body = /export function closeEmptyRound[\s\S]*?\n}/.exec(ROUND_REPORT)?.[0] ?? "";
        expect(body).not.toBe("");
        expect(body).toContain("ctx.discardSession()");
        expect(body).toContain("ctx.stopRound()");
        expect(body).toContain("exitSummaryView(ctx.el)");
        expect(body).toContain("onSummaryToggle?.()");
        // ⚠️ stopRound 只翻 started、**不重画**：不补这一次重画，用户看到的
        // 是「一题没答 + 题卡锁死」的原状（既没回开刷面板、钮也不消失）
        expect(body).toContain("ctx.rerenderView()");
        // 开轮即 upsert 的 0 作答记录必须真删掉（只清内存 ⇒ 统计总览多一轮）
        expect(body).toContain("ctx.history?.removeSession(dropped)");
        expect(body).toContain("const dropped = ctx.session?.id;");
        expect(ROUND_REPORT).toMatch(/rerenderView: \(\) => view\.rerenderView\(\)/);
        // 不许借道「收卷」那两条落库路（finishSession 会 upsert、showRoundReportNow
        // 会出报告）——空轮的核心承诺就是 history 里不留该轮、界面无报告
        expect(body).not.toContain("finishSession");
        expect(body).not.toContain("showRoundReportNow");
        expect(body).not.toContain("manualFinishRound");
    });

    it("视图侧 discardSessionNow 不落库不进 finished（唯一实现点）", () => {
        // 访问器区一行式（与 finishNow 同风格）；**不 upsert、不置 finished**
        expect(QUIZ_INDEX).toMatch(/discardSessionNow = \(\): void => void \(this\.session = undefined\)/);
        // 唯一的「空轮清会话」落点：别的入口沿 finishSession（收卷/切卷要落库）
        expect(count(QUIZ_INDEX, "this.session = undefined")).toBe(2); // finishSession + discardSessionNow
        // ctx 组装把视图能力递进编排层（RoundFinishCtx.discardSession）
        expect(ROUND_REPORT).toMatch(/discardSession: \(\) => view\.discardSessionNow\(\)/);
        // 落库删除能力同样只经 ctx 组装递进来（视图侧 historyStore 即满足）
        expect(ROUND_REPORT).toMatch(/history: view\.historyStore\?\.\(\),/);
    });

    it("两路收卷入口仍共用同一守卫（#147 的唯一性不许破）", () => {
        expect(count(QUIZ_INDEX, "finishRoundGuarded(roundFinishCtx(this))")).toBe(2);
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

    it("移动端空轮同样静默关轮（Issue #158）：键已删、全仓零引用", () => {
        // 移动端有**独立的收卷守卫**（不经桌面 finishRoundGuarded）：#155 只改了
        // 桌面，移动端原样停在 #147 的「通知 endRoundEmpty + 不收卷」⇒ #158 对齐。
        // 对齐后此键才满足「全仓零引用」，故两语言同删（design-spec §8.4 死键口径）。
        expect(ROUND_REPORT).not.toContain("endRoundEmpty");
        expect(QUIZ_INDEX).not.toContain("endRoundEmpty");
        expect(Object.keys(ZH as Record<string, string>)).not.toContain("endRoundEmpty");
        expect(Object.keys(EN as Record<string, string>)).not.toContain("endRoundEmpty");
        // ⚠️ 注释里复述键名不算引用：按 §8.4 口径剥注释后再判（源码文本）
        const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        expect(code(MOBILE_DRILL)).not.toContain("endRoundEmpty");
        expect(code(MOBILE_ROUND)).not.toContain("endRoundEmpty");
    });

    it("移动端空轮分支落在 closeEmptyRound 上（不再 notifyInfo）", () => {
        expect(MOBILE_DRILL).not.toContain("notifyInfo");
        expect(MOBILE_DRILL).toMatch(/closeEmptyRound\(this\)/);
        // 空轮判据仍只在 requestEnd 一处（不许第二份入口判定）：注释里复述写法
        // 不算引用，故先剥注释再数（同上面 §8.4 的口径）
        const drillCode = MOBILE_DRILL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        expect(drillCode.split("answered <= 0").length - 1).toBe(1);
    });

    it("移动端空轮执行体与桌面同四步：抹落盘记录 → 停表 → 退态 → 回开刷面板", () => {
        const body = /export function closeEmptyRound[\s\S]*?\n}/.exec(MOBILE_ROUND)?.[0] ?? "";
        expect(body).not.toBe("");
        expect(body).toContain("history?.removeSession(dropped)");
        expect(body).toContain("d.stopTicker()");
        expect(body).toContain('d.ui.screen = "home"');
        expect(body).toContain("selectSet(d.ui.home.activeSetId, { silent: true })");
        // 判据不在这里再写一份
        expect(body).not.toContain("answered <= 0");
    });
});
