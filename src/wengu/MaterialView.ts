import { renderCardHtml } from "./CardHtml";
import type { CardHtmlModel } from "./CardHtml";
import { svgIcon } from "./FormHtml";
import type { WenguMaterial, WenguQuestion } from "./types";
import { esc } from "./ui";

/**
 * 材料面板（E0 退化视图，docs/english-question-review.md M1/M3 前置）：
 * 卡片流里在「组内第一题」前渲染共享材料块（内嵌 Protyle，见
 * ProtyleHost），可折叠；参考译文（part="trans"）与 cloze 的 slot-*
 * 子块由 CSS 防剧透——组内题目全部判分后才揭示（syncMaterialReveal）。
 * E1 分栏壳落地后本模块退位为上栏数据源。
 */

/** 单个材料面板 HTML（正文由 ProtyleHost 挂载到 data-mprotyle）。 */
export function renderMaterialHtml(mat: WenguMaterial, t: (k: string) => string): string {
    return `<div class="wengu-material" data-mid="${esc(mat.id)}">
      <button class="wengu-material-toggle" data-act="material-toggle" title="${esc(t("materialToggle"))}">${svgIcon(
          "iconRight"
      )}<span>${esc(t("materialTitle"))}</span></button>
      <div class="wengu-material-body" data-mprotyle><span class="wengu-muted">…</span></div>
    </div>`;
}

/** 题卡列表 + 组头材料面板（每个材料只在其组内第一题前出现一次；
 *  单卡渲染失败给占位卡，不拖垮整个列表——与 renderCardsHtml 同策）。 */
export function renderCardsWithMaterials(list: WenguQuestion[], m: CardHtmlModel, materials: WenguMaterial[]): string {
    const byId = new Map(materials.map((x) => [x.id, x] as const));
    const shown = new Set<string>();
    const out: string[] = [];
    for (let i = 0; i < list.length; i++) {
        const q = list[i];
        const mat = q.group ? byId.get(q.group) : undefined;
        if (mat && !shown.has(mat.id)) {
            shown.add(mat.id);
            out.push(renderMaterialHtml(mat, m.t));
        }
        try {
            out.push(renderCardHtml(q, i, m));
        } catch (e) {
            out.push(
                `<div class="wengu-card"><div class="wengu-status wengu-status-err">${esc(
                    String((e as Error)?.message ?? e)
                )}</div></div>`
            );
        }
    }
    return out.join("");
}

/** 材料面板折叠开关（重渲染后由 QuizView 重绑）。 */
export function bindMaterialPanels(el: HTMLElement): void {
    for (const btn of el.querySelectorAll<HTMLElement>("[data-act='material-toggle']")) {
        btn.addEventListener("click", () => {
            btn.closest<HTMLElement>(".wengu-material")?.toggleAttribute("data-collapsed");
        });
    }
}

/** 组内题目全部判分后揭示材料译文（revealCard / 恢复已答 / 统一揭示
 *  之后调用；组没凑齐或材料无对应题则保持隐藏）。 */
export function syncMaterialReveal(el: HTMLElement, list: WenguQuestion[]): void {
    const panels = [...el.querySelectorAll<HTMLElement>(".wengu-material")];
    if (panels.length === 0) return;
    const graded = new Set(
        [...el.querySelectorAll<HTMLElement>(".wengu-card[data-graded='1']")].map((c) => c.dataset.qid ?? "")
    );
    for (const panel of panels) {
        const mid = panel.dataset.mid ?? "";
        const group = list.filter((q) => q.group === mid);
        if (group.length > 0 && group.every((q) => graded.has(q.id))) {
            panel.classList.add("wengu-mat-graded");
        }
    }
}
