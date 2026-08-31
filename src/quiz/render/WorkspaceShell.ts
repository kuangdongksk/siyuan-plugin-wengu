import type { QuizView } from "../index";
import { mountRailFor, RAIL_ANCHOR_HTML } from "./RailMount";
import { mountCompanionPanel } from "../../companion";
import { mountKnowledgePanel } from "../../bank";
import { mountAiSessionPanel } from "../../ai/SessionPanel";

/**
 * 工作区分支渲染（workspace !== "drill" 时由 renderQuizShellFor 早退到
 * 这里）：rail + 空主区骨架，再把面板挂进去。各面板均已 Svelte 化
 * （companion/bank/ai），数据装载在组件 onMount 里自起；全量重绘
 * （renderList）时 renderQuizShellFor 开头统一 detach 面板实例。
 * 20260831 □4 rail 合并后工作区收敛为 刷题/知识/AI 会话/学伴。
 */
export function renderWorkspaceFor(v: QuizView): void {
    v.el.innerHTML = `${RAIL_ANCHOR_HTML}<div class="wengu-main wengu-ws-main" data-ws-root></div>`;
    mountRailFor(v);
    const root = v.el.querySelector<HTMLElement>("[data-ws-root]");
    if (!root) return;
    if (v.workspace === "companion") mountCompanionPanel(v, root);
    else if (v.workspace === "ai") mountAiSessionPanel(v, root);
    else mountKnowledgePanel(v, root);
}
