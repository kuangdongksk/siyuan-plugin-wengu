import type { QuizView } from "./index";
import { destroyStatsPanel } from "../stats";
import { renderReviewFor } from "../review";
import { bindCardEvents } from "./AnswerFlow";
import { renderMainShell, renderNumsHtml, renderSubheadHtml } from "./CardHtml";
import type { CardHtmlModel } from "./CardParts";
import { buildDrillUnits, renderUnitsHtml } from "./DrillUnits";
import { bindGroupUnits, focusQuestion, restoreGroupScrolls } from "./MaterialFlow";
import { bindNumRail } from "./NumRail";
import { decoratePreview } from "./PreviewFlow";
import { PROTYLE_INLINE_MAX } from "./ProtyleHost";
import { bindRailFor } from "./RailHtml";
import { beginDrillFor, bindStartPanel, renderStartPanel } from "./StartPanel";
import { bindHeadFor } from "./ViewBindings";
import { renderWorkspaceFor } from "./WorkspaceShell";
import { esc } from "../ui/shared";

/**
 * 主区渲染与视图级绑定（自 QuizView 拆出压 500 行红线）：
 * renderListInner 的多模式路由（复习/预览/做题）+ bindAll 的
 * 头部/题号/开刷面板/材料组/题卡绑定。纯编排，状态全在 QuizView。
 */

/** renderListInner 主体（QuizView.renderList 调；错误兜底留在视图）。 */
export function renderQuizShellFor(v: QuizView): void {
    v.protyleHost.destroyAll();
    destroyStatsPanel(); // innerHTML 覆盖前先 dispose 图表实例防泄漏
    // 三栏格局：非刷题工作区（学伴/专题/知识文档）整体换内容后返回
    if (v.workspace !== "drill") {
        renderWorkspaceFor(v);
        return;
    }
    // M6 多模式路由：复习（错题本）由 ReviewFlow 全权渲染；预览复用做题
    // 壳（题卡全揭示、不作答）；study 仍预留
    if (v.mode === "review") {
        renderReviewFor(v);
        bindHeadFor(v);
        bindRailFor(v);
        return;
    }
    if (v.mode !== "quiz" && v.mode !== "preview") return;
    const pv = v.mode === "preview";
    const colMode = v.colFlow.isActive();
    const doc = colMode ? undefined : v.docs.find((d) => d.id === v.docId);
    v.units = buildDrillUnits(v.list, v.materials);
    const cardModel: CardHtmlModel = {
        t: v.t,
        showAttempts: v.settings?.showAttempts !== false,
        // 预览不透历史对错（题号/徽标/描色全中性，保密）
        showWrongBadge: !pv && v.settings?.showWrong !== false && v.revealMode !== "after",
    };
    v.el.innerHTML = renderMainShell({
        t: v.t,
        docs: v.docs,
        docId: v.docId,
        sideCollapsed: v.sideCollapsed,
        filter: v.sideFilter,
        sideTreeOpen: v.sideTreeOpen,
        hasSettingsButton: !!v.openSettings,
        collections: v.colFlow.rowsView(),
        activeCollection: v.colFlow.id(),
        loading: v.loading,
        loadError: v.loadError,
        // 预览视为常开：不落开刷面板，直接展示全部题卡
        started: v.started || pv,
        previewing: v.progressive.active,
        hasDoc: !!doc,
        listCount: v.list.length,
        startPanelHtml: renderStartPanel(v.startPanelModel()),
        subheadHtml: colMode
            ? `<span class="wengu-muted">${esc(v.colFlow.activeTitle() ?? "")} · ${esc(String(v.list.length))}</span>`
            : renderSubheadHtml({ t: v.t, doc, listCount: v.list.length, rounds: v.rounds }),
        cardsHtml: renderUnitsHtml(v.units, cardModel),
        numsHtml: renderNumsHtml(
            v.list,
            v.t,
            v.settings?.showNums !== false,
            !pv && v.settings?.showWrong !== false && v.revealMode === "instant"
        ),
    });
    bindQuizFor(v);
    bindRailFor(v);
    // 渲染路径分流：题库模式/长卷走静态 Lute（无内核请求、无 N 个
    // Protyle 实例）；常规卷走内嵌 Protyle（块级还原最完整）
    if (colMode || v.list.length > PROTYLE_INLINE_MAX) {
        v.protyleHost.mountStatic(v.el, v.list, v.materials);
        restoreGroupScrolls(v.el);
    } else {
        void v.protyleHost.mount(v.el, v.list, v.materials).then(() => restoreGroupScrolls(v.el));
    }
    if (pv) decoratePreview(v.el, v.list, v.t, () => v.switchMode("quiz")); // 预览装饰：揭示答案/快捷复制/模糊开关/退出预览
    v.timerBinder.updateLabel();
}

/** 视图级绑定：头部/题号/开刷面板/题卡/材料组单元。 */
function bindQuizFor(v: QuizView): void {
    bindHeadFor(v);
    bindNumRail(v.el, {
        onActive: (idx) => v.onActiveQ(idx),
        onFocus: (idx) => focusQuestion(v.el, v.units, v.list, idx),
    });
    bindStartPanel(v.el, v.startPanelModel(), () => beginDrillFor(v), {
        onPreview: () => v.enterPreviewMode(),
        onReview: () => v.enterReviewMode({}),
    });
    bindGroupUnits(v.el, v.units, v, {
        onActive: (idx) => v.onActiveQ(idx),
        onShown: () => void v.protyleHost.mount(v.el, v.list, v.materials),
    });
    if (v.progressive.active || v.mode === "preview") return; // 渐进/预览不绑作答（预览事件由 decoratePreview 绑）
    for (const node of v.el.querySelectorAll<HTMLElement>(".wengu-card")) {
        const q = v.list.find((x) => x.id === node.dataset.qid);
        if (q) bindCardEvents(v, node, q);
    }
}
