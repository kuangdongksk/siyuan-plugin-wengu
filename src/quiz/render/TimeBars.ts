/**
 * 总结页「每题用时」条形图的数据组装（Issue #155 块 B）。
 *
 * 病灶：243 题的卷子在真机 DOM 里长出 243 根 `.wengu-bar-col`，柱宽压到
 * 几像素、标签糊成一片，图完全不可读。故**按 n 题一组聚合**（自适应，
 * 保证组数 ≤ ~50），组可展开看逐题明细。
 *
 * 本模块是**纯数据组装**（无 DOM、无 i18n 取词），带单测——只算「几组、
 * 每组哪几题、组柱多高/什么色、组 title 文案」；渲染在
 * components/RoundReportApp.svelte，文案由调用方传入的格式化器提供。
 */

/** 卷长 ≤ 本值时逐题渲染（现状不变）；超过则分组。 */
export const BAR_AGG_MAX = 60;

/** 矮柱下限（与逐题图原口径一致：0 秒也留 4% 可见）。 */
const MIN_H = 4;

/** 一题的图条数据（喂给本模块的最小信息）。 */
export interface TimeBarInput {
    /** 整卷题号（1 起）。 */
    label: number;
    /** 该题用时（秒；未答传 0）。**须为有限数**：消费方按 `> 0` 判「有真
     *  用时」，0 与缺失同路；`NaN`/`Infinity` 一律按 0 收拾（见 `secOf`）。 */
    sec: number;
    /** 未作答（会话里没有该题的结果记录）。 */
    unanswered: boolean;
    /** 已答但 ok=false。 */
    wrong: boolean;
    /** brief 的方向对但有缺口（统计记错，单列黄色）。 */
    partial: boolean;
}

/** 组内一题的明细（title 复用既有逐题文案）。 */
export interface TimeBarItem {
    label: number;
    h: number;
    cls: string;
    title: string;
}

/** 一个图列：逐题卷子每列一题；长卷每列一组（可展开）。 */
export interface TimeBarCol {
    grouped: boolean;
    /** 柱下标签（逐题=题号；聚合=组序号）。 */
    label: number;
    h: number;
    cls: string;
    title: string;
    /** 组内明细（逐题列为单元素数组）。 */
    items: TimeBarItem[];
}

/** 组聚合文案的入参（文案模板由调用方 `t` 决定）。 */
export interface TimeBarGroupInfo {
    from: number;
    to: number;
    answered: number;
    total: number;
    sec: number;
}

/** 用时归一到「有限数」（Issue #177）：非有限值（`NaN`/`Infinity`/非数字）
 *  一律按 0 收拾。
 *
 *  为什么图也要防：`byBaseQid` 曾在用时缺失时漏出 `NaN`（已从源头修掉，
 *  见其注释），而 `mmss(NaN)` 显示「NaN:NaN」、`(NaN / max) * 100` 让柱高
 *  算出 `height:NaN%`——非法值被浏览器静默丢弃，**整张柱状图的相对高度
 *  集体失效**（表现是「柱子全一样高」，看不出是数据坏了）。源头修 + 出口
 *  归一，两道都留：任何新调用方传进脏值也不再坏图。 */
function secOf(x: TimeBarInput): number {
    return Number.isFinite(x.sec) ? x.sec : 0;
}

/** 逐题状态 → 语义类名（口径与原逐题图逐字一致）。 */
function clsOf(x: TimeBarInput): string {
    if (x.unanswered) return "wengu-bar-muted";
    if (x.partial) return "wengu-bar-partial";
    return x.wrong ? "wengu-bar-wrong" : "wengu-bar-right";
}

/** 一组（≥1 题）的聚合语义：**取组内最差**——含错 → wrong、含 partial →
 *  partial、全对 → right、全未答 → muted。 */
function clsOfGroup(group: TimeBarInput[]): string {
    if (group.every((x) => x.unanswered)) return "wengu-bar-muted";
    if (group.some((x) => !x.unanswered && x.wrong)) return "wengu-bar-wrong";
    if (group.some((x) => !x.unanswered && x.partial)) return "wengu-bar-partial";
    return "wengu-bar-right";
}

/** 分组粒度：卷长 ≤ {@link BAR_AGG_MAX} → 1（逐题，现状不变）；否则
 *  `ceil(len / BAR_AGG_MAX)` 题一组（243 → 5 题一组 49 组）。 */
export function barGroupSize(len: number): number {
    if (len <= BAR_AGG_MAX) return 1;
    return Math.ceil(len / BAR_AGG_MAX);
}

/** 组装图列（逐题与聚合同一函数两态）。
 *
 *  - 逐题档：柱高 ∝ 单题用时（分母 = 全卷最长用时，原口径）；
 *  - 聚合档：柱高 ∝ 组内**已答题目总用时**（分母 = 各组最大值，同一相对
 *    语义、组间可比；未答题不计入总用时）。
 *
 *  两档的矮柱下限都是 {@link MIN_H}（全 0 也留可见高度）。
 *  `fmt.fmtTitle` / `fmt.fmtGroup` 提供文案（i18n 取词留在组件侧）。
 */
export function buildTimeBars(
    list: TimeBarInput[],
    fmt: {
        fmtTitle(x: TimeBarInput): string;
        fmtGroup(g: TimeBarGroupInfo): string;
    }
): TimeBarCol[] {
    if (list.length === 0) return [];
    const size = barGroupSize(list.length);
    // ⚠️ 交给格式化器的输入**先归一**（Issue #177 出口口径）：`sec` 若是脏值，
    //    调用方一句朴素的 `mmss(x.sec)` 就印出「NaN:NaN」/「Infinity:NaN:NaN」
    //    ——本模块不能一边把 secOf 当内部实现细节、一边把脏 sec 原样递出去。
    //    归一后 `TimeBarInput.sec` 的那句「须为有限数」才是**本模块保证**的。
    const clean: TimeBarInput[] = list.map((x) => ({ ...x, sec: secOf(x) }));
    const items: TimeBarItem[] = clean.map((x) => ({
        label: x.label,
        h: MIN_H,
        cls: clsOf(x),
        title: fmt.fmtTitle(x),
    }));

    if (size === 1) {
        const max = Math.max(1, ...clean.map(secOf));
        // ⚠️ 逐题列也带 `items`（单元素）——两档的列**形状必须一致**，
        // 否则组件要按档分流取明细（#155 前逐题 title 直接挂在列上，
        // 组件里那份分叉就是下次漏改的入口）。
        return items.map((it, i) => ({
            ...it,
            grouped: false,
            h: Math.max(MIN_H, Math.round((clean[i].sec / max) * 100)),
            items: [it],
        }));
    }

    const cols: TimeBarCol[] = [];
    const groupSec: number[] = []; // 各组已答总用时（与 cols 同下标）
    for (let start = 0; start < clean.length; start += size) {
        const group = clean.slice(start, start + size);
        const sec = group.reduce((sum, x) => sum + (x.unanswered ? 0 : x.sec), 0);
        groupSec.push(sec);
        cols.push({
            grouped: true,
            label: cols.length + 1,
            h: MIN_H,
            cls: clsOfGroup(group),
            title: fmt.fmtGroup({
                from: group[0].label,
                to: group[group.length - 1].label,
                answered: group.filter((x) => !x.unanswered).length,
                total: group.length,
                sec,
            }),
            items: items.slice(start, start + size),
        });
    }
    const max = Math.max(1, ...groupSec);
    cols.forEach((c, i) => (c.h = Math.max(MIN_H, Math.round((groupSec[i] / max) * 100))));
    return cols;
}
