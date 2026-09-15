import type { QuizView } from "../quiz";
import { mountSvelteApp, type MountedSvelteApp } from "../ui/mountApp";
import { fitTargetOf, toggleFit, workspaceFits, type FitEl } from "./core/PanelFit";
import SessionPanelApp from "./components/SessionPanelApp.svelte";

/**
 * AI 会话工作区面板的挂载编排（同 bank/index.ts mountKnowledgePanel
 * 模式；ai 域按惯例无 index.ts，挂载点放本命名模块）：WorkspaceShell
 * 的 "ai" 分支调 mountAiSessionPanel，QuizView.destroy 兜底
 * detachAiSessionPanel。数据装载在组件 onMount 里自起（订阅
 * data/AiSessions 登记簿），挂载方无需传存储。
 */

let sessionPanelApp: MountedSvelteApp | undefined;

/** 本面板开过档的那一份宿主主区（卸载时按它收起——**只碰这一份**，
 *  判定与越界防线见 core/PanelFit 的文件头注）。 */
let fitTarget: FitEl | undefined;

/** 打开/关闭**本面板宿主**的「收内滚」档（Issue #96）：挂载前打开、卸载后
 *  收起。开/关在本文件的挂载/卸载处**配对**，别散落。
 *  ⚠️ 只动本面板那一份骨架（挂载时记下的 fitTarget），**禁 document 级
 *  全选**——同文档里别的页签/面板也有 `.wengu-ws-main`，全局开关会把它们
 *  的主区一并改掉（内容被 overflow:hidden 切掉且滚不到），20260915 复审修正。 */
function fitHost(on: boolean, root?: HTMLElement): void {
    if (on) {
        fitTarget = fitTargetOf(root);
        toggleFit(fitTarget, true);
        return;
    }
    toggleFit(fitTarget, false);
    fitTarget = undefined;
}

/** 挂载 AI 会话面板（rail 的 "ai" 工作区主区）。 */
export function mountAiSessionPanel(v: QuizView, root: HTMLElement): void {
    detachAiSessionPanel();
    // 整页不滚动（Issue #96）：本面板收内滚 ⇒ 宿主主区改 flex 列 + 隐藏
    // 溢出，高度链才传得到卡（规则与理由见 rail.scss 那一档）。判定走纯
    // 函数 workspaceFits（带单测），别在这里写死 "ai"。
    fitHost(workspaceFits("ai"), root);
    sessionPanelApp = mountSvelteApp(SessionPanelApp, root, { v });
}

/** 卸载（renderQuizShellFor 整壳重建前与 QuizView.destroy 兜底）。 */
export function detachAiSessionPanel(): void {
    sessionPanelApp?.unmount();
    sessionPanelApp = undefined;
    fitHost(false);
}
