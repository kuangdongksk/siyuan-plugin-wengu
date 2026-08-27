import type { QuizView } from "../index";
import { bindRailFor, renderRailHtml } from "./RailHtml";
import { renderCompanionPanelInto } from "../../companion/core/CompanionPanel";
import { renderCollectionPanelInto } from "../../bank/ui/CollectionPanel";
import { renderKnowledgePanelInto } from "../../bank/ui/KnowledgePanel";

/**
 * 工作区分支渲染（workspace !== "drill" 时由 renderQuizShellFor 早退到
 * 这里）：rail + 空主区骨架，再把面板内容填进去。各面板自带数据拉取
 * 与绑定；全量重绘（renderList）时面板随之重建，局部更新由面板自理。
 */
export function renderWorkspaceFor(v: QuizView): void {
    v.el.innerHTML = `${renderRailHtml(v.t, v.workspace)}<div class="wengu-main wengu-ws-main" data-ws-root></div>`;
    bindRailFor(v);
    const root = v.el.querySelector<HTMLElement>("[data-ws-root]");
    if (!root) return;
    if (v.workspace === "companion") renderCompanionPanelInto(v, root);
    else if (v.workspace === "collection") void renderCollectionPanelInto(v, root);
    else renderKnowledgePanelInto(v, root);
}
