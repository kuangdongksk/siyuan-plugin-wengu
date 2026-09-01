import type { QuizView } from "../index";
import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";
import RailApp from "../components/RailApp.svelte";

/**
 * 左侧工作区导航栏（三栏格局的第一栏）：刷题/专题/知识/AI 会话/学伴
 * 五个图标钮（20260901 拆分：专题管理与知识文档回两个独立工作区，
 * 20260831 □4 曾收敛四钮）。Svelte 化（20260830）：渲染在
 * components/RailApp.svelte，本文件是挂载编排——四处壳拼接（做题主壳/
 * 错误兜底/工作区分支/复习分支）都在 innerHTML 最前放 RAIL_ANCHOR_HTML
 * 锚，mountRailFor 以 anchor 法把组件根插到 v.el 直下后删锚（rail 的
 * flex:none 三栏布局依赖直接子元素，不能包宿主 div，CSS 零改动）。rail
 * 随壳重绘，每次渲染重挂。
 */

/** 工作区（rail 顶层的视图维度；mode 是刷题工作区内部的渲染模式）。 */
export type WenguWorkspace = "drill" | "collection" | "knowledge" | "ai" | "companion";

/** prefs 读入规整（未知值回落刷题）。 */
export function normalizeWorkspace(raw?: string): WenguWorkspace {
    return raw === "collection" || raw === "knowledge" || raw === "ai" || raw === "companion" ? raw : "drill";
}

/** rail 挂载锚（壳 innerHTML 拼接用；mountRailFor 随后删锚）。 */
export const RAIL_ANCHOR_HTML = "<div data-rail-anchor></div>";

let railApp: MountedSvelteApp | undefined;

/** 挂载 rail（壳 innerHTML 落地后调；active 高亮当前工作区）。 */
export function mountRailFor(v: QuizView): void {
    detachRail();
    const anchor = v.el.querySelector("[data-rail-anchor]");
    if (!anchor) return;
    railApp = mountSvelteApp(
        RailApp,
        v.el,
        {
            t: v.t,
            active: v.workspace,
            onSwitch: (ws: WenguWorkspace) => v.switchWorkspace(normalizeWorkspace(ws)),
        },
        { anchor }
    );
    anchor.remove();
}

/** 卸载 rail（renderQuizShellFor 整壳重建前与 QuizView.destroy 兜底）。 */
export function detachRail(): void {
    railApp?.unmount();
    railApp = undefined;
}
