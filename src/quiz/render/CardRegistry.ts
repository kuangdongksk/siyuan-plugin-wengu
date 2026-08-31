import type { CardCtl } from "./CardCtl";

/**
 * 题卡登记表（6-4b）：组件 onMount 自登记/自注销（单卡与材料组内卡
 * 同一条路），收卷锁卡/思路快照/收口检查/统一揭示等视图级操作按表
 * 遍历——替代旧的 DOM 扫描（.wengu-card [data-graded] 等）。
 * 模块级单例与 NumRail/Rail 同款口径（页签级互斥，多开不支持）。
 */

const cards = new Map<string, CardCtl>();

/** 组件挂载自登记（onMount）。 */
export function registerCard(ctl: CardCtl): void {
    cards.set(ctl.q.id, ctl);
}

/** 组件卸载自注销（onMount cleanup）。 */
export function unregisterCard(ctl: CardCtl): void {
    if (cards.get(ctl.q.id) === ctl) cards.delete(ctl.q.id);
}

/** 按题找卡（块引用跳转/恢复等定点操作）。 */
export function cardOf(qid: string): CardCtl | undefined {
    return cards.get(qid);
}

/** 全部在册卡（revealAll 等遍历用，快照防遍历中增删）。 */
export function allCards(): CardCtl[] {
    return [...cards.values()];
}

/** 收口检查：一卡未判完即未齐（旧 checkAllDone 的 DOM 扫描语义）。 */
export function allCardsGraded(): boolean {
    if (cards.size === 0) return false;
    for (const c of cards.values()) if (!c.graded) return false;
    return true;
}

/** 收卷锁卡：锁全部作答位（旧 lockAllCards 的 DOM disable）。 */
export function lockAllCards(): void {
    for (const c of cards.values()) c.ui.locked = true;
}

/** 思路随卷快照（qid→非空思路；旧 collectCardThoughts）。 */
export function collectThoughts(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const c of cards.values()) {
        const v = c.thought();
        if (v) out[c.q.id] = v;
    }
    return out;
}
