import type { QuizView } from "../quiz";
import { mountSvelteApp, type MountedSvelteApp } from "../ui/mountApp";
import { WS_FIT_CLS, workspaceFits } from "./core/PanelFit";
import SessionPanelApp from "./components/SessionPanelApp.svelte";

/**
 * AI 会话工作区面板的挂载编排（同 bank/index.ts mountKnowledgePanel
 * 模式；ai 域按惯例无 index.ts，挂载点放本命名模块）：WorkspaceShell
 * 的 "ai" 分支调 mountAiSessionPanel，QuizView.destroy 兜底
 * detachAiSessionPanel。数据装载在组件 onMount 里自起（订阅
 * data/AiSessions 登记簿），挂载方无需传存储。
 */

let sessionPanelApp: MountedSvelteApp | undefined;

/** 打开/关闭宿主的「收内滚」档（Issue #96）：挂载前打开、卸载后收起。
 *  主区容器是**共享骨架**（renderWorkspaceFor 四分支共用一个
 *  `<div data-ws-root>`，随整壳重建），不收起会把本面板的档留给下一块
 *  面板——开了档而那块面板不收内滚，内容会被 overflow:hidden 切掉且滚不
 *  到。开/关都在本文件的挂载/卸载配对处，别散落。 */
function fitHost(on: boolean): void {
    for (const el of document.querySelectorAll<HTMLElement>(".wengu-ws-main")) el.classList.toggle(WS_FIT_CLS, on);
}

/** 挂载 AI 会话面板（rail 的 "ai" 工作区主区）。 */
export function mountAiSessionPanel(v: QuizView, root: HTMLElement): void {
    detachAiSessionPanel();
    // 整页不滚动（Issue #96）：本面板收内滚 ⇒ 宿主主区改 flex 列 + 隐藏
    // 溢出，高度链才传得到卡（规则与理由见 rail.scss 那一档）。判定走纯
    // 函数 workspaceFits（带单测），别在这里写死 "ai"。
    fitHost(workspaceFits("ai"));
    sessionPanelApp = mountSvelteApp(SessionPanelApp, root, { v });
}

/** 卸载（renderQuizShellFor 整壳重建前与 QuizView.destroy 兜底）。 */
export function detachAiSessionPanel(): void {
    sessionPanelApp?.unmount();
    sessionPanelApp = undefined;
    fitHost(false);
}
