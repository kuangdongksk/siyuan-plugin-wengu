import { Menu } from "siyuan";
import { applySideFilter } from "../render/CardHtml";
import type { CollectionFlow } from "../../bank";
import { updateConvertBtn } from "../../convert";
import { bindCardActions } from "../../bank/ui/RegenDialog";
import { livingSourceOf } from "../service/DocOps";
import { bindAnnotationLayer, type AnnoCallbacks } from "./AnnoFlow";
import { addClue, bindClueJudge } from "./ClueFlow";
import type { QuizView } from "../index";
import type { WenguDoc } from "../../types";
import type { QuestionBank } from "../../bank/data/QuestionBank";

/**
 * 视图通用事件绑定（从 QuizView 拆出）：头部按钮（刷新/转换/设置/
 * 目录开合）、目录搜索、文档项点击与右键（错题复习入口）、
 * 题号/开刷面板/卡片事件在各自模块（模式入口在开刷面板三按钮，
 * 头部切换器已删，2026-08-26）。
 */

/** 构造器一次性事件委托（自 QuizView 拆出压 500 行红线）：块引用跳转
 *  + 题卡「重新生成」+ 标注层（线索/生词）与「AI 复核线索」委托。
 *  返回标注层解绑函数（destroy 时调）。bank 是视图私有存储，经参传入。 */
export function bindViewFrameFor(
    v: QuizView,
    bank: QuestionBank | undefined,
    wordStore: AnnoCallbacks["wordStore"] | undefined,
    reload: () => void
): () => void {
    bindCardActions(v.el, {
        t: v.t,
        find: (qid) => v.list.find((x) => x.id === qid),
        bank,
        modelId: v.aiModelId,
        reload,
    });
    const cleanup = bindAnnotationLayer(v.el, {
        t: v.t,
        onMarkClue: (text) => addClue(v, text),
        wordStore,
    });
    bindClueJudge(v);
    return cleanup;
}
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
    /** 「结束本次做题」：批改已答部分并出本轮报告（下次可继续）。 */
    endRound(): void;
    /** 目录文档右键「错题复习」：进复习模式并预筛该文档。 */
    enterReviewMode(opt: { docId?: string; qid?: string }): void;
    /** 目录文档右键「重新导入」：删旧题集并把配对源讲义重转一份新的。 */
    reimportDoc(docId: string): void;
    /** 目录文档右键「删除此题集」：解除登记（剥属性，文档保留）并清插件侧数据。 */
    removeDocSet(docId: string): void;
    /** 目录文档右键「变式重练」：按题生成变式专题并切换开刷。 */
    variantDrill(docId: string): void;
    /** 侧栏树分支折叠/展开（S1）。 */
    toggleTree(path: string): void;
    /** 右键菜单项文案（i18n）。 */
    reviewMenuLabel: string;
    reimportMenuLabel: string;
    removeSetMenuLabel: string;
    variantDrillMenuLabel: string;
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
    q("[data-act='end-round']")?.addEventListener("click", () => ctx.endRound());
    q("[data-act='side-search']")?.addEventListener("input", (ev) => {
        ctx.filterDocs((ev.target as HTMLInputElement).value);
    });
    // 事件委托：搜索过滤只重绘清单 innerHTML，点击绑定挂在容器上不失效
    q("[data-side-body]")?.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement;
        // 树分支折叠/展开：分支行/带子级文档行的 toggle 带 data-tree-path
        // （带子级的文档行本身不带，点其标题仍走开刷）
        const toggle = target.closest<HTMLElement>("[data-tree-path]");
        if (toggle) {
            ctx.toggleTree(toggle.dataset.treePath ?? "");
            return;
        }
        const node = target.closest<HTMLElement>("[data-docid]");
        if (node) {
            ctx.switchDoc(node.dataset.docid ?? "");
            return;
        }
        const col = target.closest<HTMLElement>("[data-colid]");
        if (col) ctx.switchCollection(col.dataset.colid ?? "");
    });
    // 目录文档右键：错题复习 + 重新导入（有存活源讲义才露出，源查库
    // 有一次 SQL 往返，菜单迟一拍开）+ 删除此题集（文档保留）+ 变式重练
    q("[data-side-body]")?.addEventListener("contextmenu", (ev) => {
        const node = (ev.target as HTMLElement).closest<HTMLElement>("[data-docid]");
        const docId = node?.dataset.docid;
        if (!docId) return;
        const pos = ev as MouseEvent;
        ev.preventDefault();
        ev.stopPropagation();
        void (async () => {
            const menu = new Menu("wengu-doc-menu");
            menu.addItem({ icon: "iconInfo", label: ctx.reviewMenuLabel, click: () => ctx.enterReviewMode({ docId }) });
            if (await livingSourceOf(docId)) {
                menu.addItem({
                    icon: "iconRefresh",
                    label: ctx.reimportMenuLabel,
                    click: () => ctx.reimportDoc(docId),
                });
            }
            menu.addItem({ icon: "iconTrashcan", label: ctx.removeSetMenuLabel, click: () => ctx.removeDocSet(docId) });
            menu.addItem({
                icon: "iconSparkles",
                label: ctx.variantDrillMenuLabel,
                click: () => ctx.variantDrill(docId),
            });
            menu.open({ x: pos.clientX, y: pos.clientY });
        })();
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
    endRound(): void;
    enterReviewMode(opt: { docId?: string; qid?: string }): void;
    reimportDocOf(docId: string): void;
    removeSetOf(docId: string): void;
    variantDrillOf(docId: string): void;
    toggleSideTreeOf(path: string): void;
    sideTreeOpenOf(): string[];
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
            applySideFilter(
                v.el,
                v.docsOf(),
                v.docIdOf(),
                v.t,
                text,
                v.colFlowOf().rowsView(),
                v.colFlowOf().id(),
                v.sideTreeOpenOf()
            );
        },
        toggleSide: (collapsed) => v.setSideCollapsed(collapsed),
        updateConvertBtn: () => updateConvertBtn(v.el, v.convertingOf(), v.t),
        switchDoc: (id) => v.selectDoc(id),
        endRound: () => v.endRound(),
        enterReviewMode: (opt) => v.enterReviewMode(opt),
        reimportDoc: (id) => v.reimportDocOf(id),
        removeDocSet: (id) => v.removeSetOf(id),
        variantDrill: (id) => v.variantDrillOf(id),
        toggleTree: (path) => v.toggleSideTreeOf(path),
        reviewMenuLabel: v.t("reviewMenuLabel"),
        reimportMenuLabel: v.t("reimportMenuLabel"),
        removeSetMenuLabel: v.t("removeSetMenuLabel"),
        variantDrillMenuLabel: v.t("variantDrillMenuLabel"),
    });
}

/** 侧栏树分支折叠/展开（S1）：改集合持久化后局部重绘清单块。
 *  自 QuizView.toggleSideTreeOf 拆出压 500 行红线。 */
export function toggleSideTreeFor(v: QuizView, path: string): void {
    const set = new Set(v.sideTreeOpen);
    if (set.has(path)) set.delete(path);
    else set.add(path);
    v.sideTreeOpen = [...set];
    v.persistPrefs();
    applySideFilter(v.el, v.docs, v.docId, v.t, v.sideFilter, v.colFlow.rowsView(), v.colFlow.id(), v.sideTreeOpen);
}
