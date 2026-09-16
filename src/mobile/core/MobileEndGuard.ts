import type { MobileDrill } from "./MobileDrill";
import { closeEmptyRound } from "./MobileRound";
import { isPickedUnconfirmed, submitPickedUnconfirmed } from "./MobileAnswering";

/**
 * 移动端**收卷守卫**（Issue #164；函数式友元，接 drill 实例读写 `d.ui`，
 * 与 `MobileAnswering` / `MobileRound` 同口径）。
 *
 * ## 为什么单开一片
 * 本单的根因是**两套口径各自为政**：#105 两段式确认（点选只落选择态、
 * 提交一律由「确认答案」触发，见 `MobileAnswering.isPickedUnconfirmed`）
 * × #158 空轮判据只认 `answered`（`start` 开轮 upsert → `closeEmptyRound`
 * 静默抹除）——用户按「点选项=已答」的心智刷完直接交卷，整轮被判空轮、
 * 作答无痕丢失（history 零记录、题库零镜像）。
 *
 * 修法两条：**判据收口**（「已选未确认」只有 `isPickedUnconfirmed` 一份
 * 实现，本文件只消费不重写）+ **交卷给明确去向**（弹层二态，「去确认」/
 * 「按当前已选交卷」，绝不允许静默丢弃）。守卫连同说明整体落在此处，既
 * 让 `MobileDrill.ts`（无豁免、500 行红线）退回编排职责，也让
 * `RoundReport.contract.test.ts` 的移动端唯一性断言有个稳定落点。
 */

/**
 * 本轮「已选未确认」的题数（判据取 `MobileAnswering.isPickedUnconfirmed`
 * **唯一实现**；此处不得再写第二份选择态判定）。
 */
export function pickedCount(d: MobileDrill): number {
    return d.ui.list.reduce((n, q, i) => n + (d.ui.cards[i] && isPickedUnconfirmed(q, d.ui.cards[i]) ? 1 : 0), 0);
}

/**
 * 收卷入口（即时模式恒可交；收卷模式给确认弹层；「已选未确认」给第二态弹层）。
 *
 * 分流次序**不许挪**：
 * 1. **已选未确认**（>0）→ 第二态弹层（`ui.endPickedN`，两模式同口径）：
 *    这批题在用户眼里就是「已答」，交卷必须给明确去向——不能静默丢弃
 *    （Issue #164），也不能直接被后面的空轮分支吞掉；
 * 2. `answered <= 0` 且无已选 → **静默关轮**（Issue #158，对齐桌面
 *    `RoundReport.closeEmptyRound`；「不会」记 ok=false 且已计入
 *    `answered`，故不属空轮）——真·空轮语义**零回归**；
 * 3. 正常收卷：收卷模式给确认弹层，即时模式直接收卷。
 *
 * ⚠️ `answered <= 0` 只作「全空」的快速放行，**别再合并成第三个表达式**：
 * 本仓「空轮判据唯一性」由 `quiz/render/RoundReport.contract.test.ts` 源级
 * 锁死（桌面一处 + 移动端一处，两处是有意的重复——本域拿不到桌面 `ctx`）。
 */
export function requestEnd(d: MobileDrill): void {
    const s = d.ui.session;
    if (!s) return;
    const picked = pickedCount(d);
    if (picked > 0) {
        d.ui.endPickedN = picked;
        return;
    }
    if (s.answered <= 0) {
        d.ui.endPickedN = null; // 兜底清态：别把陈旧弹层留在关轮后（执行体不碰它）
        closeEmptyRound(d);
        return;
    }
    if (d.ui.setup.reveal === "after") d.ui.confirmEnd = true;
    else d.endRound();
}

/** 「去确认」：收起弹层并**定位到第一道**「已选未确认」的题（选择态原样保留）。 */
export function goConfirmEndPicked(d: MobileDrill): void {
    const idx = d.ui.list.findIndex((q, i) => !!d.ui.cards[i] && isPickedUnconfirmed(q, d.ui.cards[i]));
    d.ui.endPickedN = null;
    d.ui.confirmEnd = false;
    if (idx >= 0) d.goto(idx);
}

/**
 * 「按当前已选交卷」：把这批已选按**既有提交链**补记（
 * `MobileAnswering.submitPickedUnconfirmed` → `submit`：判分 / 会话 upsert /
 * 题库镜像全在那条链上），随后收卷出报告——**不许静默丢弃**（Issue #164 验收 2）。
 *
 * 收卷直调 `endRound`（不再回 `requestEnd`）：用户已在第二态弹层上明确点头，
 * 再走一次守卫会在收卷模式下多弹一次确认弹层，等于把「已表态」当没表态。
 * 补记过的卡都已 `graded`，`endRound` 的揭示/镜像编排照旧能收口。
 */
export async function endNowPicked(d: MobileDrill): Promise<void> {
    if (d.ui.endPickedN === null) return;
    const wait = submitPickedUnconfirmed(d);
    d.ui.endPickedN = null;
    await wait;
    // 即时模式下补记末题会触发 `checkAllDone` → 自动收卷（已在报告屏），
    // 此时别重复收卷；收卷模式不会自动收，故走这一句出报告。
    if (!d.ui.session?.endedAt) d.endRound();
}
