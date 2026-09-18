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
