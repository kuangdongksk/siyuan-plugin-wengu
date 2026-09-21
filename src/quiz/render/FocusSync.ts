import type { QuestionTimer } from "../service/QuizTimer";

/**
 * 单题计时状态同步表（Issue #182）：卡的「焦点态 / 冻结秒数 / 圈数读数」
 * 是组件内响应态，视图侧（切焦点、结算后）需要按 qid 触发一次刷新。
 *
 * 为什么不走 props：题卡由 `CardMount` 逐单元挂载（材料组内卡还多一层），
 * 把回调经 `CardInitCtx` 逐层透传会污染一整个挂载链；而 `CardRegistry`
 * 已经是「按 qid 找卡」的现成表，但它是**视图→流程**的方向。本表只做
 * 组件→视图的反向触发，单例口径与 `CardRegistry`/`NumRail` 同款。
 */

const syncs = new Map<string, Set<() => void>>();

/** 卡挂载自登记（同 qid 可多份：材料组内卡与普通卡理论上不共存，
 *  但整壳重建的卸载/重挂窗口里会短暂重叠，故用 Set 而不是单值）。 */
export function registerTimerSync(qid: string, fn: () => void): void {
    const set = syncs.get(qid) ?? new Set<() => void>();
    set.add(fn);
    syncs.set(qid, set);
}

/** 卡卸载自注销。 */
export function unregisterTimerSync(qid: string, fn: () => void): void {
    const set = syncs.get(qid);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) syncs.delete(qid);
}

/** 刷新一张卡的计时态（切焦点/结算后由视图按 qid 触发）。 */
export function syncCardTimer(qid: string): void {
    for (const fn of syncs.get(qid) ?? []) fn();
}

/**
 * 绑定「单题计时 → 卡面」的同步（视图侧一次；内部订阅焦点变化）。
 * 焦点是显式动作（点击切题），故不需要观察器——`newQuestionFor` 与
 * 结算链各自调 `syncCardTimer`；本函数只在开轮/恢复时把**全部**卡刷一遍。
 */
export function syncAllCardTimers(timer: QuestionTimer): void {
    const qids = new Set<string>([timer.active, ...[...syncs.keys()]]);
    for (const qid of qids) if (qid) syncCardTimer(qid);
}
