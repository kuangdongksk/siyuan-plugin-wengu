import { renderCardHtml } from "./CardHtml";
import type { CardHtmlModel } from "./CardParts";
import { svgIcon } from "../../ui/FormHtml";
import type { WenguMaterial, WenguQuestion } from "../../types";
import { esc } from "../../ui/shared";

/**
 * 单元化渲染（E1，english-question-review.md M3）：刷题列表按「单元」
 * 渲染——独立题=普通题卡（现行为不变）；材料组=分栏组单元（材料上栏
 * 独立滚动 + 组内题一次一题在下栏，导航由 MaterialFlow 接管）。
 * 组单元内所有题卡都渲染（非当前的 hidden），恢复/揭示/收卷等
 * 既有流程按 .wengu-card 遍历的语义全部保持。
 */

/** 组内一题（idx 为整卷题号下标，与题号导航对齐）。 */
export interface GroupUnitQ {
    q: WenguQuestion;
    idx: number;
}

/** 一个渲染单元。 */
export interface DrillUnit {
    kind: "single" | "group";
    /** single：题目与下标。 */
    q?: WenguQuestion;
    idx?: number;
    /** group：材料块 id 与材料。 */
    mid?: string;
    material?: WenguMaterial;
    qs?: GroupUnitQ[];
}

/** 组装渲染单元：有可解析 group 的题归入其材料组（材料缺失按独立题降级）。 */
export function buildDrillUnits(list: WenguQuestion[], materials: WenguMaterial[]): DrillUnit[] {
    const byId = new Map(materials.map((m) => [m.id, m] as const));
    const units: DrillUnit[] = [];
    const groupByMid = new Map<string, DrillUnit>();
    for (let i = 0; i < list.length; i++) {
        const q = list[i];
        const mat = q.group ? byId.get(q.group) : undefined;
        if (!mat) {
            units.push({ kind: "single", q, idx: i });
            continue;
        }
        let u = groupByMid.get(mat.id);
        if (!u) {
            u = { kind: "group", mid: mat.id, material: mat, qs: [] };
            groupByMid.set(mat.id, u);
            units.push(u);
        }
        u.qs!.push({ q, idx: i });
    }
    return units;
}

/** 单元列表 HTML：独立题=题卡；组单元=分栏壳（材料 + 全部题卡，非当前 hidden）。 */
export function renderUnitsHtml(units: DrillUnit[], m: CardHtmlModel): string {
    return units.map((u) => renderOneUnitHtml(u, m)).join("");
}

/** 单个单元 HTML（静态分片管线逐片插入用，与整串拼装同构）。 */
export function renderOneUnitHtml(u: DrillUnit, m: CardHtmlModel): string {
    if (u.kind === "single") {
        return tryCard(u.q!, u.idx!, m);
    }
    const cards = (u.qs ?? []).map((gq, i) => {
        const html = tryCard(gq.q, gq.idx, m);
        // 非当前题隐藏（MaterialFlow 切换时挪 hidden），恢复/揭示流程不受影响
        return i === 0 ? html : html.replace('<div class="wengu-card"', '<div class="wengu-card" hidden');
    });
    return `<div class="wengu-gunit" data-mid="${esc(u.mid ?? "")}">
      <div class="wengu-ghead">
        <button class="wengu-gmat-fold" data-act="gmat-fold" title="${esc(m.t("materialToggle"))}">${svgIcon(
            "iconRight"
        )}<span>${esc(m.t("materialTitle"))}</span></button>
        <span class="wengu-gnav">
          <button class="wengu-gnav-btn" data-act="gq-prev" title="${esc(m.t("groupPrev"))}">${svgIcon(
              "iconLeft"
          )}</button>
          <span class="wengu-gq-label" data-gq-label></span>
          <button class="wengu-gnav-btn" data-act="gq-next" title="${esc(m.t("groupNext"))}">${svgIcon(
              "iconRight"
          )}</button>
        </span>
      </div>
      <div class="wengu-gmat" data-mprotyle><span class="wengu-muted">…</span></div>
      <div class="wengu-gqs">${cards.join("")}</div>
      <div class="wengu-gclues" data-clues hidden></div>
    </div>`;
}

/** 单卡渲染失败给占位卡，不拖垮整个列表（与原 renderCardsHtml 同策）。 */
function tryCard(q: WenguQuestion, idx: number, m: CardHtmlModel): string {
    try {
        return renderCardHtml(q, idx, m);
    } catch (e) {
        return `<div class="wengu-card"><div class="wengu-status wengu-status-err">${esc(
            String((e as Error)?.message ?? e)
        )}</div></div>`;
    }
}
