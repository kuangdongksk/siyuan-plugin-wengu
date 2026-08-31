import type { QuizView } from "../quiz";
import { mountSvelteApp, type MountedSvelteApp } from "../ui/mountApp";
import SessionPanelApp from "./components/SessionPanelApp.svelte";

/**
 * AI 会话工作区面板的挂载编排（同 bank/index.ts mountKnowledgePanel
 * 模式；ai 域按惯例无 index.ts，挂载点放本命名模块）：WorkspaceShell
 * 的 "ai" 分支调 mountAiSessionPanel，QuizView.destroy 兜底
 * detachAiSessionPanel。数据装载在组件 onMount 里自起（订阅
 * data/AiSessions 登记簿），挂载方无需传存储。
 */

let sessionPanelApp: MountedSvelteApp | undefined;

/** 挂载 AI 会话面板（rail 的 "ai" 工作区主区）。 */
export function mountAiSessionPanel(v: QuizView, root: HTMLElement): void {
    detachAiSessionPanel();
    sessionPanelApp = mountSvelteApp(SessionPanelApp, root, { v });
}

/** 卸载（renderQuizShellFor 整壳重建前与 QuizView.destroy 兜底）。 */
export function detachAiSessionPanel(): void {
    sessionPanelApp?.unmount();
    sessionPanelApp = undefined;
}
