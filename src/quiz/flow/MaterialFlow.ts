import type { AnswerHost } from "./AnswerFlow";
import type { DrillUnit } from "../render/DrillUnits";
import type { WenguQuestion } from "../../types";
import { esc } from "../../ui/shared";

/**
 * 材料组交互（E1，M3 分栏壳的组内编排）：组单元一次一题（上材料下题），
 * 导航按钮/题号导航联动、材料滚动位置按组记忆（重渲染后恢复）、
 * 材料折叠、译文随组内全判分揭示（syncGroupReveal）。
 * 题卡渲染与判分全部复用既有流程（卡都在 DOM，非当前 hidden）。
 */

/** 组内导航回调：切题后同步 activeQIdx/逐题计时（QuizView 传入）。 */
export interface GroupFlowOpts {
    onActive(idx: number): void;
    /** 切换后新显示的卡需要挂 Protyle（QuizView 触发增量 mount）。 */
    onShown(): void;
}

/** 组运行态：当前题下标与材料滚动位置（跨重渲染存活）。 */
const qiByMid = new Map<string, number>();
const scrollByMid = new Map<string, number>();

/** 渲染后绑定全部组单元（QuizView.renderListInner 在 bindAll 里调用）。 */
export function bindGroupUnits(root: HTMLElement, units: DrillUnit[], host: AnswerHost, opts: GroupFlowOpts): void {
    for (const unit of root.querySelectorAll<HTMLElement>(".wengu-gunit")) {
        const u = units.find((x) => x.kind === "group" && x.mid === unit.dataset.mid);
        if (!u?.qs?.length) continue;
        const cur = clampQi(qiByMid.get(u.mid ?? "") ?? 0, u.qs.length);
        showQuestion(unit, u, cur, opts, false);
        unit.querySelector("[data-act='gq-prev']")?.addEventListener("click", () => {
            stepQuestion(unit, u, -1, opts);
        });
        unit.querySelector("[data-act='gq-next']")?.addEventListener("click", () => {
            stepQuestion(unit, u, 1, opts);
        });
        unit.querySelector("[data-act='gmat-fold']")?.addEventListener("click", () => {
            unit.toggleAttribute("data-collapsed");
        });
        const mat = unit.querySelector<HTMLElement>(".wengu-gmat");
        mat?.addEventListener("scroll", () => {
            if (u.mid) scrollByMid.set(u.mid, mat.scrollTop);
        });
    }
}

/** 材料挂载完成（ProtyleHost.mount 之后）恢复各组滚动位置。 */
export function restoreGroupScrolls(root: HTMLElement): void {
    for (const unit of root.querySelectorAll<HTMLElement>(".wengu-gunit")) {
        const top = scrollByMid.get(unit.dataset.mid ?? "");
        const mat = unit.querySelector<HTMLElement>(".wengu-gmat");
        if (mat && top !== undefined) mat.scrollTop = top;
    }
}

/** 组内上一题/下一题。 */
function stepQuestion(unit: HTMLElement, u: DrillUnit, dir: number, opts: GroupFlowOpts): void {
    const cur = clampQi(Number(unit.dataset.qi ?? 0), u.qs!.length);
    const next = clampQi(cur + dir, u.qs!.length);
    if (next !== cur) showQuestion(unit, u, next, opts, true);
}

/** 显示组内第 qi 题：挪 hidden、更新标签、联动 activeQIdx/计时/挂载。 */
function showQuestion(unit: HTMLElement, u: DrillUnit, qi: number, opts: GroupFlowOpts, scrollCard: boolean): void {
    const qs = u.qs!;
    const cards = [...unit.querySelectorAll<HTMLElement>(".wengu-gqs .wengu-card")];
    cards.forEach((c, i) => {
        if (i === qi) c.removeAttribute("hidden");
        else c.setAttribute("hidden", "");
    });
    unit.dataset.qi = String(qi);
    if (u.mid) qiByMid.set(u.mid, qi);
    const label = unit.querySelector<HTMLElement>("[data-gq-label]");
    if (label) label.textContent = `${qi + 1}/${qs.length}`;
    const active = cards[qi];
    if (active) {
        opts.onActive(qs[qi].idx);
        opts.onShown();
        if (scrollCard) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
}

/** 题号导航/滚动跟踪入口：idx 属于某组时切到该题并滚到组单元。 */
export function focusQuestion(root: HTMLElement, units: DrillUnit[], list: WenguQuestion[], idx: number): void {
    for (const unit of root.querySelectorAll<HTMLElement>(".wengu-gunit")) {
        const u = units.find((x) => x.kind === "group" && x.mid === unit.dataset.mid);
        const hit = u?.qs?.find((gq) => gq.idx === idx);
        if (!hit || !u) continue;
        const qi = u.qs!.indexOf(hit);
        if (Number(unit.dataset.qi ?? 0) !== qi) {
            // 直接操作 DOM（不触发 onActive 回环），再滚动到组单元
            const cards = [...unit.querySelectorAll<HTMLElement>(".wengu-gqs .wengu-card")];
            cards.forEach((c, i) => {
                if (i === qi) c.removeAttribute("hidden");
                else c.setAttribute("hidden", "");
            });
            unit.dataset.qi = String(qi);
            if (u.mid) qiByMid.set(u.mid, qi);
            const label = unit.querySelector<HTMLElement>("[data-gq-label]");
            if (label) label.textContent = `${qi + 1}/${u.qs!.length}`;
        }
        unit.scrollIntoView({ block: "start", behavior: "smooth" });
        return;
    }
    // 非组题：滚到普通题卡
    root.querySelector<HTMLElement>(`.wengu-card[data-idx="${idx}"]`)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
    });
}

/** 组内题目全部判分后揭示材料译文（判分/恢复/统一揭示路径都会调）。 */
export function syncGroupReveal(root: HTMLElement, list: WenguQuestion[]): void {
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

function clampQi(qi: number, n: number): number {
    return Math.max(0, Math.min(n - 1, qi));
}
