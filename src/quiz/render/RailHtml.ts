import type { QuizView } from "../index";
import { svgIcon } from "../../ui/FormHtml";
import { esc } from "../../ui/shared";

/**
 * 左侧工作区导航栏（三栏格局的第一栏）：刷题/专题管理/知识文档/
 * 学伴管理四个图标钮（学伴收尾，20260828 用户调整）。rail 是「随壳
 * 重绘」的一部分——renderMainShell、renderReviewFor、工作区分支与
 * 错误兜底都在 innerHTML 最外层拼一次，bindRailFor 在每次渲染后
 * 重新绑定（与头部绑定同生命周期）。
 */

/** 工作区（rail 顶层的视图维度；mode 是刷题工作区内部的渲染模式）。 */
export type WenguWorkspace = "drill" | "companion" | "collection" | "knowledge";

/** prefs 读入规整（未知值回落刷题）。 */
export function normalizeWorkspace(raw?: string): WenguWorkspace {
    return raw === "companion" || raw === "collection" || raw === "knowledge" ? raw : "drill";
}

/** rail HTML（active 高亮当前工作区）。 */
export function renderRailHtml(t: (k: string) => string, active: WenguWorkspace): string {
    const btn = (ws: WenguWorkspace, icon: string, label: string) =>
        `<button type="button" class="wengu-rail-btn${active === ws ? " wengu-rail-active" : ""}" data-ws="${ws}" title="${esc(
            label
        )}" aria-label="${esc(label)}">${svgIcon(icon)}</button>`;
    return `<div class="wengu-rail">${btn("drill", "iconWengu", t("railDrill"))}${btn(
        "collection",
        "iconList",
        t("railCollection")
    )}${btn("knowledge", "iconInfo", t("railKnowledge"))}${btn("companion", "iconStar", t("railCompanion"))}</div>`;
}

/** 绑定 rail 按钮（data-ws → QuizView.switchWorkspace）。 */
export function bindRailFor(v: QuizView): void {
    for (const b of v.el.querySelectorAll<HTMLElement>("[data-ws]")) {
        b.addEventListener("click", () => v.switchWorkspace(normalizeWorkspace(b.dataset.ws)));
    }
}
