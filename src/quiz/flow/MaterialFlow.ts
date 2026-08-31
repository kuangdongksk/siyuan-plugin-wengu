import { chaseScrollIntoView } from "../render/NumRail";
import { esc } from "../../ui/shared";

/**
 * 材料组交互（E1，6-4b 状态化）：组内导航/材料折叠/滚动记忆已收进
 * component/GroupUnitApp（qi 响应态），本文件持有跨重渲染存活的组
 * 运行态（当前题下标与材料滚动位置）+ 组登记表（题号导航定位用）
 * + 组级揭示/线索行。
 */

/** 组运行态：当前题下标与材料滚动位置（跨重渲染存活）。 */
const qiByMid = new Map<string, number>();
const scrollByMid = new Map<string, number>();

export function getGroupQi(mid: string): number | undefined {
    return qiByMid.get(mid);
}

export function setGroupQi(mid: string, qi: number): void {
    qiByMid.set(mid, qi);
}

export function getGroupScroll(mid: string): number | undefined {
    return scrollByMid.get(mid);
}

export function setGroupScroll(mid: string, top: number): void {
    scrollByMid.set(mid, top);
}

export function clampGroupQi(qi: number, n: number): number {
    return Math.max(0, Math.min(n - 1, qi));
}

/* ── 组登记表（GroupUnitApp 挂载自登记，focusQuestion 消费） ── */

/** 组单元实例导出（*.svelte 实例导出类型在 ts 侧收口）。 */
export interface GroupUnitExports {
    /** 题号导航定位：idx 属本组则切到该题并返回 true。 */
    focusIdx(idx: number): boolean;
    /** 组根元素（追赶滚动目标）。 */
    unitEl(): HTMLElement | undefined;
}

const groupApps = new Map<string, GroupUnitExports>();

export function registerGroup(mid: string, e: GroupUnitExports): void {
    groupApps.set(mid, e);
}

export function unregisterGroup(mid: string): void {
    groupApps.delete(mid);
}

/** 题号导航/滚动跟踪入口：idx 属某组时切到该题并滚到组单元，
 *  否则滚到普通题卡。滚动走追赶式（NumRail）：材料渲染中持续撑高，
 *  scrollIntoView 一次定标会停在过时像素。 */
export function focusQuestion(root: HTMLElement, idx: number): void {
    const scroller = root.querySelector<HTMLElement>(".wengu-main");
    if (!scroller) return;
    for (const e of groupApps.values()) {
        if (!e.focusIdx(idx)) continue;
        const el = e.unitEl();
        if (el) chaseScrollIntoView(scroller, el, "start");
        return;
    }
    const card = root.querySelector<HTMLElement>(`.wengu-card[data-idx="${idx}"]:not([hidden])`);
    if (card) chaseScrollIntoView(scroller, card, "center");
}

/** 组内题目全部判分后揭示材料译文（判分/恢复/统一揭示路径都会调；
 *  data-graded 属性仍由卡组件按状态回写 DOM，此处照旧扫描）。 */
export function syncGroupReveal(root: HTMLElement, list: { id: string; group?: string }[]): void {
    const units = [...root.querySelectorAll<HTMLElement>(".wengu-gunit")];
    if (units.length === 0) return;
    const graded = new Set(
        [...root.querySelectorAll<HTMLElement>(".wengu-card[data-graded='1']")].map((c) => c.dataset.qid ?? "")
    );
    for (const unit of units) {
        const group = list.filter((q) => q.group === unit.dataset.mid);
        if (group.length > 0 && group.every((q) => graded.has(q.id))) {
            unit.classList.add("wengu-mat-graded");
        }
    }
}

/** 组内当前题的线索 chips（M5 线索标注，ClueFlow 渲染/刷新）。 */
export function renderClueRow(el: HTMLElement, t: (k: string) => string, clues: string[]): void {
    const row = el.querySelector<HTMLElement>("[data-clues]");
    if (!row) return;
    if (clues.length === 0) {
        row.setAttribute("hidden", "");
        row.innerHTML = "";
        return;
    }
    row.removeAttribute("hidden");
    row.innerHTML =
        `<span class="wengu-gclues-label">${esc(t("clueChips"))}</span>` +
        clues
            .map(
                (c, i) =>
                    `<span class="wengu-clue-chip" data-clue="${i}" title="${esc(c)}">${esc(c.slice(0, 40))}…</span>`
            )
            .join("") +
        `<button class="wengu-btn" data-act="clue-judge">${esc(t("clueJudge"))}</button>`;
}
