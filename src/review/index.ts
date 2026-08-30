import type { HistoryStore } from "../quiz/service/HistoryStore";
import { renderHeadHtml, renderSideHtml } from "../quiz/render/CardHtml";
import { RAIL_ANCHOR_HTML } from "../quiz/render/RailMount";
import { mountSvelteApp, type MountedSvelteApp } from "../ui/mountApp";
import { reviewCtl } from "./core/ReviewCtl";
import ReviewApp from "./component/ReviewApp.svelte";
import type { WenguDoc } from "../types";
import { esc, fmt } from "../ui/shared";

/**
 * 错题本（复习模式，M6 mode="review"）编排：rail/side/head 壳仍走
 * quiz 的字符串渲染（头部/侧栏事件由 QuizView 统一绑定），主区
 * （工具行+清单+详情）Svelte 化挂载（20260830，四件套见 core/component/）。
 * 筛选/排序/选中/缓存持久在 ReviewCtl 单例——外部域（quiz 侧栏/
 * 统计面板）在视图外读写，视图重渲染不丢状态。
 */

/** 复习模式渲染所需的视图能力（QuizView 用箭头属性实现）。 */
export interface ReviewViewAccess {
    readonly el: HTMLElement;
    t(key: string): string;
    historyStore(): HistoryStore | undefined;
    docsOf(): WenguDoc[];
    /** 侧栏树展开集合（树形渲染与做题模式共用）。 */
    sideTreeOpenOf(): string[];
    /** 组头「重刷本文档」：切做题模式 + scope=wrongAll 开轮。 */
    startReviewDrill(docId: string): void;
    /** 完整重渲染（含头部重绑——renderReviewFor 只重绘不绑头部，直接调会丢切换器事件）。 */
    rerenderView(): void;
}

let reviewApp: MountedSvelteApp | undefined;

/** 复习模式主渲染入口（QuizView.renderListInner 的 review 分支调，
 *  头部/侧栏事件由调用方随后统一绑定）。装载完成时 ctl 会走
 *  rerenderView 刷新头部 summary——本函数随之重挂主区，单例状态
 *  由 ctl 承接不丢。 */
export function renderReviewFor(v: ReviewViewAccess): void {
    detachReviewApp();
    const t = v.t;
    const o = reviewCtl.overview();
    const summary = o ? fmt(t("reviewHeadSummary"), { p: String(o.pending), m: String(o.mastered) }) : t("reviewTitle");
    v.el.innerHTML =
        RAIL_ANCHOR_HTML +
        renderSideHtml({
            t,
            docs: v.docsOf(),
            docId: "",
            sideCollapsed: false,
            hasSettingsButton: true,
            filter: "",
            collections: [],
            activeCollection: "",
        }) +
        `<div class="wengu-main wengu-review-main">
  <div class="wengu-head">${renderHeadHtml(t, false, esc(summary))}</div>
  <div data-review-app></div>
</div>`;
    const host = v.el.querySelector<HTMLElement>("[data-review-app]");
    if (host) reviewApp = mountSvelteApp(ReviewApp, host, { v });
}

/** 卸载复习主区（renderQuizShellFor 整壳重建前与 QuizView.destroy 兜底）。 */
export function detachReviewApp(): void {
    reviewApp?.unmount();
    reviewApp = undefined;
}

/** 侧栏点文档（复习模式）＝清单筛选该文档；再点一次取消。 */
export function filterReviewDocFor(docId: string): void {
    reviewCtl.filterDoc(docId);
}

/** 统计面板「进错题本」/错题行点击的定位（切模式后由渲染消费）。 */
export function selectReviewQid(qid: string): void {
    reviewCtl.selectQid(qid);
}

/** 统计面板总览「错题概况」的数据（缓存命中即回；未命中由面板自拉）。 */
export function wrongOverviewNow(): { pending: number; mastered: number } | undefined {
    return reviewCtl.overview();
}
