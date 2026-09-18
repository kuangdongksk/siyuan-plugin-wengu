import type { WenguSession } from "./HistoryStore";
import { baseQid } from "../../types";

/**
 * 「未完成轮」候选查找（Issue #169，20260918）：**全仓唯一实现**——
 * 桌面开刷面板（`quiz/render/StartPanel` 的 `buildStartPanelModel` 与
 * `startRound` 两处）与移动端恢复探测链（`mobile/core/MobileRound`）都取它。
 *
 * 判据（与 Issue #12 B3 口径同）：**有作答且未收卷**——`answered > 0`
 * （防空轮，空轮无内容可续）且 `endedAt` 未写（after 模式答满不自动收卷，
 * 答满却未交卷的轮仍要能「继续上次」改答案）。
 *
 * ⚠️ **原坑：候选只看数组最后一轮**。开轮即 upsert，用户「开了轮没答题
 * 就离开」会往库里留一条 `answered:0` 的空轮（弃轮无 `endedAt`；倒计时
 * 归零收卷/切卷收卷的空轮有 `endedAt`）——空轮占住末位后，即使前面存在
 * 「有作答且未收卷」的轮，恢复入口也被**永久埋掉**（20260918 真机报障）。
 * 故候选一律**从尾向前找第一个命中判据的轮**，判据本身不变（纯空轮库
 * 仍不出恢复入口，与现行设计一致）。
 *
 * 纯读侧逻辑：不改存储格式、不迁移存量、不擦历史空轮（Issue #169 验收）。
 */

/** 一轮里已作答的题目数（多步题的 `qid#k` 条目按块 id 去重）。 */
export function answeredQuestionCount(s: WenguSession | undefined): number {
    return new Set((s?.results ?? []).map((r) => baseQid(r.qid))).size;
}

/** 「未完成轮」判据（有作答且未收卷）。 */
export function isUnfinishedRound(s: WenguSession | undefined): boolean {
    return !!s && !s.endedAt && answeredQuestionCount(s) > 0;
}

/** 未完成轮候选：**从尾向前第一个命中判据的轮**（尾随空轮/已收卷轮跳过）。
 *  全都不命中返回 `undefined`（面板不出「继续上次」，不造幽灵入口）。 */
export function lastUnfinishedRound(rounds: readonly WenguSession[] | undefined): WenguSession | undefined {
    const list = rounds ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
        if (isUnfinishedRound(list[i])) return list[i];
    }
    return undefined;
}

/** 「弃轮」判据（Issue #169 调查项，20260918）：**零作答且未收卷**
 *  ——一轮「留库还是擦掉」的擦除侧判据（留库侧＝{@link isUnfinishedRound}）。
 *
 *  弃轮＝**不可恢复**：零作答的记录谁都续不了（探测只收有作答的轮），
 *  留库只占位（统计总览的轮次数/趋势图凭空多一轮）。已收卷的轮**不在
 *  此判据内**（有报告可看，归收卷链管）。
 *
 *  ⚠️ **有作答的轮一律不在此判据内**——那是进度的依托，擦掉就是静默丢
 *  进度（比多一条空轮严重得多）。故两个计数**都要为 0** 才算弃轮，方向
 *  一律取**保守**（宁可留一条无害的空轮，不可删一条有内容的轮）：
 *  - `answeredQuestionCount(s) === 0`——`results` 为**恢复与报告的真相**
 *    （多步题 `qid#k` 按块 id 归并；`results` 非空即「有内容可续」）；
 *  - `s.answered <= 0`——记账字段，与 `RoundReport.emptyRound`（收卷闸的
 *    空轮判据）同口径。旧形态两者可能不同步（`answered` 缺计），故双条件
 *    与「只用其一」相比只会更保守。
 *
 *  存量历史沿用「纯读侧兼容」：本判据只作用于**正在处置**的那一轮
 *  （切卷/刷新/退屏/卸载），历史里的旧空轮不迁移、不擦，由面板/探测跳过。 */
export function isAbandonedRound(s: WenguSession | undefined): boolean {
    return !!s && !s.endedAt && s.answered <= 0 && answeredQuestionCount(s) === 0;
}
