import { baseQid } from "../../types";
import { newSessionId } from "../../quiz/service/HistoryStore";
import { shuffleListForDisplay } from "../../quiz/render/CardDisplayShuffle";
import { initCardState, type MobileDrill } from "./MobileDrill";

/**
 * 移动端**收卷生命周期**（Issue #158；函数式友元，接 drill 实例读写
 * `d.ui`，同 `MobileAnswering` / `BankRegen` 口径）。
 *
 * ## 为什么单开一片
 * 空轮静默关轮（对齐桌面 `RoundReport.closeEmptyRound`）的说明一写就长，
 * 而 `MobileDrill.ts` 是**无豁免、500 行红线**的编排文件。按语义机械拆
 * 「收卷」这一域，并顺带把 `retryWrong`（错题再练开新轮）也收进来——
 * 它同样是「起一轮」的生命周期动作。
 *
 * ⚠️ 状态写入仍只经 `d.ui`（Svelte 5 `$state` 深代理），别在别处另存一份。
 */

/** 本轮会话计时起点（秒粒度由 startedAt 推）的唯一机关。 */
type Ticker = {
    startTicker(): void;
    stopTicker(): void;
};

/**
 * 空轮静默关轮（Issue #158）：与桌面 `RoundReport.closeEmptyRound` **四步
 * 同语义**，按移动端状态机落地——不落库、不出报告、清会话回可开新轮。
 *
 * 1. **抹 + 清会话**：`start` 一开轮就 `history.upsert`（那是「未完成轮可
 *    继续」的依托，`restoreResumeFor` 只收有作答的轮），空轮必须把它
 *    `removeSession` **删掉**才算「history 里不留该轮」——只清内存那条仍
 *    留在盘上（桌面同款教训：不删，统计总览轮次数虚增）；
 * 2. **停表**：不停走秒的 interval 会把已关轮的秒数继续写进旧会话对象；
 * 3. **退态**：关确认弹层 + 清本轮卡片态（报告屏/题号抽屉都按 `cards` 渲染，
 *    残留旧态会在下一轮开刷前被画出来）；
 * 4. **回开刷面板**：`screen = "home"`，并重探测未完成轮——上面那条已被删，
 *    不会再被认成「可继续」。
 *
 * ⚠️ 空轮判据（`answered <= 0`）由调用方 `MobileDrill.requestEnd` 持有；
 * 本函数只管执行体。移动端收卷入口**只有 `requestEnd` 一个**，别在别处再写
 * 一份 `answered <= 0`（桌面那笔：入口各写一份必漏，`finishNow` 就是漏的）。
 */
export function closeEmptyRound(d: MobileDrill & Ticker): void {
    const dropped = d.ui.session?.id;
    d.ui.session = undefined;
    d.ui.resume = undefined;
    // ⚠️ 光清内存删不掉 `start` 已 upsert 的那条 0 作答记录（`restoreResumeFor`
    // 只收有作答的轮，故它落到真实库就是统计多一轮）
    if (dropped) void d.deps.history?.removeSession(dropped);
    d.stopTicker();
    d.ui.confirmEnd = false;
    d.ui.cards = [];
    d.ui.list = [];
    d.ui.qIdx = 0;
    d.ui.elapsedSec = 0;
    d.ui.drawer = false;
    d.ui.matOpen = false;
    d.ui.screen = "home";
    // 回开刷面板：重探测本轮题集的未完成轮（口径与 backHome 同——silent 不闪屏）
    void d.selectSet(d.ui.home.activeSetId, { silent: true }).catch((): void => undefined);
}

/**
 * 「错题再练一轮」（报告屏入口）：以本轮错题为范围**开新轮**。
 *
 * 与 `MobileDrill.start("fresh")` 同口径的两条：**现洗副本**
 * （`shuffleListForDisplay`，Issue #131——死形态下正确项恒在首位＝剧透）、
 * **scope 传新会话 id**（排列同轮恒定，否则恢复的字母指错项）。
 * 记账仍按 id 走（`scope: "wrong"` + `scopeIds` 快照）。
 */
export function retryWrongRound(d: MobileDrill & Ticker): void {
    const s = d.ui.session;
    if (!s) return;
    const wrong = new Set(s.results.filter((r) => !r.ok).map((r) => baseQid(r.qid)));
    if (wrong.size === 0) return;
    const subset = d.ui.list.filter((q) => wrong.has(q.id));
    const sessionId = newSessionId();
    d.ui.list = shuffleListForDisplay(subset, { scope: sessionId });
    d.ui.setup.reveal = "instant";
    d.ui.session = {
        id: sessionId,
        docId: d.ui.home.activeSetId,
        startedAt: Date.now(),
        mode: d.ui.setup.timing,
        revealMode: "instant",
        stepsMode: "offline",
        scope: "wrong",
        scopeIds: subset.map((q) => q.id),
        elapsedSec: 0,
        answered: 0,
        correct: 0,
        results: [],
    };
    d.ui.cards = subset.map(() => initCardState());
    d.ui.qIdx = 0;
    d.ui.confirmEnd = false;
    d.ui.drawer = false;
    d.ui.matOpen = false;
    d.ui.screen = "drill";
    d.ui.elapsedSec = 0;
    void d.deps.history?.upsert(d.ui.session);
    d.startTicker();
}
