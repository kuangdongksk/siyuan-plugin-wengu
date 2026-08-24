import { applySideFilter } from "./CardHtml";
import type { CollectionFlow } from "./CollectionFlow";
import { updateConvertBtn } from "./ConvertHost";
import type { WenguDoc } from "./types";

/**
 * 视图通用事件绑定（从 QuizView 拆出）：头部按钮（刷新/转换/设置/
 * 目录开合）、目录搜索与文档项点击。题号、开刷面板、卡片事件在各自模块。
 */
export interface ViewBindCtx {
    el: HTMLElement;
    reload(): void;
    openConvert(): void;
    /** 打开统计面板（总览 + 本文档详情）。 */
    openStats(): void;
    openSettings?(): void;
    /** 收起/展开目录（含持久化与重渲染）。 */
    toggleSide(collapsed: boolean): void;
    /** 反映转换中状态到目录顶部的转换按钮。 */
    updateConvertBtn(): void;
    /** 目录搜索输入（局部刷新清单，不重建输入框）。 */
    filterDocs(text: string): void;
    /** 切换刷题文档（结算旧文档用时）。 */
    switchDoc(docId: string): void;
    /** 切换到专题刷题（题库模式；空串回文档模式）。 */
    switchCollection(collectionId: string): void;
    /** 打开专题管理（按知识点收集/删除专题）。 */
    openCollections(): void;
}

export function bindViewEvents(ctx: ViewBindCtx): void {
    const q = (sel: string) => ctx.el.querySelector(sel);
    q("[data-act='refresh']")?.addEventListener("click", () => ctx.reload());
    ctx.updateConvertBtn();
    q("[data-act='convert']")?.addEventListener("click", () => ctx.openConvert());
    q("[data-act='stats']")?.addEventListener("click", () => ctx.openStats());
    q("[data-act='collections']")?.addEventListener("click", () => ctx.openCollections());
    q("[data-act='settings']")?.addEventListener("click", () => ctx.openSettings?.());
    q("[data-act='side-toggle']")?.addEventListener("click", () => ctx.toggleSide(false));
    q("[data-act='side-fold']")?.addEventListener("click", () => ctx.toggleSide(true));
    q("[data-act='side-search']")?.addEventListener("input", (ev) => {
        ctx.filterDocs((ev.target as HTMLInputElement).value);
    });
    // 事件委托：搜索过滤只重绘清单 innerHTML，点击绑定挂在容器上不失效
    q("[data-side-body]")?.addEventListener("click", (ev) => {
        const node = (ev.target as HTMLElement).closest<HTMLElement>("[data-docid]");
        if (node) {
            ctx.switchDoc(node.dataset.docid ?? "");
            return;
        }
        const col = (ev.target as HTMLElement).closest<HTMLElement>("[data-colid]");
        if (col) ctx.switchCollection(col.dataset.colid ?? "");
    });
}

/** 头部接线所需的视图能力（QuizView 用箭头属性实现，bindHeadFor 消费）。 */
export interface HeadAccess {
    readonly el: HTMLElement;
    t(key: string): string;
    reloadView(): void;
    openConvert(): void;
    openStatsPanelAt(tab: "overview" | "doc"): void;
    openSettings?(): void;
    colFlowOf(): CollectionFlow;
    docsOf(): WenguDoc[];
    docIdOf(): string;
    convertingOf(): boolean;
    setSideFilter(text: string): void;
    setSideCollapsed(collapsed: boolean): void;
    selectDoc(docId: string): void;
}

/** 头部/目录接线（QuizView.bindHead 的拆出体，闭包集中在这里）。 */
export function bindHeadFor(v: HeadAccess): void {
    bindViewEvents({
        el: v.el,
        reload: () => v.reloadView(),
        openConvert: () => v.openConvert(),
        openStats: () => v.openStatsPanelAt("overview"),
        switchCollection: (id) => v.colFlowOf().switchTo(id),
        openCollections: () => v.colFlowOf().openDialog(),
        openSettings: () => v.openSettings?.(),
        filterDocs: (text) => {
            v.setSideFilter(text);
            applySideFilter(v.el, v.docsOf(), v.docIdOf(), v.t, text, v.colFlowOf().rowsView(), v.colFlowOf().id());
        },
        toggleSide: (collapsed) => v.setSideCollapsed(collapsed),
        updateConvertBtn: () => updateConvertBtn(v.el, v.convertingOf(), v.t),
        switchDoc: (id) => v.selectDoc(id),
    });
}
