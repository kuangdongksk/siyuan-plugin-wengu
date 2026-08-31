import type { WenguDoc } from "../../types";
import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";
import SidePanelApp from "../components/SidePanelApp.svelte";
import QuizHeadApp from "../components/QuizHeadApp.svelte";
import type { CollectionFlow } from "../../bank";
import { updateConvertBtn } from "../../convert";
import type { WenguWorkspace } from "../render/RailMount";

/** 侧栏/头部按钮统一出口（act 名同 data-act）：SidePanelApp/QuizHeadApp
 *  的 onAct 回调经 SideViewAccess.sideAct 汇到这里分派——原来是
 *  ViewBindings 的逐钮 DOM 绑定（refresh/convert/settings/side-fold/
 *  side-toggle/end-round/stats/collections），6-5 组件化后收为一个
 *  switch。视图能力经 SideActAccess 结构匹配（QuizView 箭头属性复用）。 */
export interface SideActAccess {
    reloadView(): Promise<void>;
    openConvert(): void;
    openStatsPanelAt(tab: "overview" | "doc"): void;
    colFlowOf(): CollectionFlow;
    openSettings?(): void;
    setSideCollapsed(collapsed: boolean): void;
    endRound(): void;
}

/** sideAct 工厂（QuizView.sideAct 的实现体，拆出压 index.ts 行数）。 */
export function sideActFor(v: SideActAccess): (act: string) => void {
    return (act) => {
        switch (act) {
            case "refresh":
                void v.reloadView();
                break;
            case "convert":
                v.openConvert();
                break;
            case "stats":
                v.openStatsPanelAt("overview");
                break;
            case "collections":
                v.colFlowOf().openDialog();
                break;
            case "settings":
                v.openSettings?.();
                break;
            case "side-fold":
                v.setSideCollapsed(true);
                break;
            case "side-toggle":
                v.setSideCollapsed(false);
                break;
            case "end-round":
                v.endRound();
                break;
        }
    };
}

/**
 * 刷题侧栏 + 主区头部的挂载编排（批次6-5 Svelte 化）：整壳 innerHTML
 * 重建的架构下挂载点无法常驻——renderQuizShellFor 头部 detach、壳落
 * 后 mountSideFor/mountHeadFor 重挂。侧栏主体（树/搜索平铺/专题区）
 * 与头部（次头部/结束本轮/计时器壳）全部进组件，原来是 renderSideHtml/
 * renderHeadHtml 字符串 + applySideFilter 重灌 + bindHeadFor 逐钮绑 +
 * SideTreeMount 重挂四件套，现统一为两个组件 + 本编排。
 *
 * 挂载后动不了的命令式钩子（跨重建、由别的模块写）仍走 DOM 契约：
 * 计时器 [data-timer]（TimerBinder 每秒）、倒计时归零 [data-timeup-slot]、
 * 转换进度 [data-status]、转换按钮文案 [data-convert-label]、文档行
 * 右键菜单（ViewBindings 委托 data-docid/data-id）。这些组件只产壳。
 */

export interface SideViewAccess {
    readonly el: HTMLElement;
    t(key: string): string;
    docsOf(): WenguDoc[];
    docIdOf(): string;
    sideCollapsedOf(): boolean;
    sideFilterOf(): string;
    hasSettingsBtn(): boolean;
    sideTreeOpenOf(): string[];
    colFlowOf(): CollectionFlow;
    convertingOf(): boolean;
    setSideFilter(text: string): void;
    selectDoc(docId: string): void;
    setSideTreeOpen(open: string[]): void;
    /** 侧栏/头部按钮统一出口（act 名同 data-act）。 */
    sideAct(act: string): void;
}

/** SidePanelApp 实例导出（挂载侧唯一入口）。 */
interface SidePanelExports {
    updateCols(next: { id: string; title: string; count: number }[], active: string): void;
}

let sideApp: MountedSvelteApp<SidePanelExports> | null = null;
let headApp: MountedSvelteApp | null = null;

/** 专题清单/选中轻量刷新（CollectionFlow.refreshSide；无侧栏挂载时 no-op）。 */
export function refreshSideCols(next: { id: string; title: string; count: number }[], active: string): void {
    sideApp?.app.updateCols(next, active);
}

/** 壳落定后挂侧栏（QuizShell 调；非 drill 工作区不挂——侧栏只服务刷题）。 */
export function mountSideFor(v: SideViewAccess, workspace: WenguWorkspace): void {
    unmountSide();
    if (workspace !== "drill") return;
    const host = v.el.querySelector<HTMLElement>("[data-side-host]");
    if (!host) return;
    // 宿主为壳内空占位（data-side-host），组件根即 .wengu-side 直接子元素。
    // *.svelte 的环境声明不带实例导出类型，这里收口一次（KnowPicker 同款）
    const mounted = mountSvelteApp(SidePanelApp, host, {
        t: v.t,
        docs: v.docsOf(),
        docId: v.docIdOf(),
        sideCollapsed: v.sideCollapsedOf(),
        hasSettingsButton: v.hasSettingsBtn(),
        filter: v.sideFilterOf(),
        collections: v.colFlowOf().rowsView(),
        activeCollection: v.colFlowOf().id(),
        sideTreeOpen: v.sideTreeOpenOf(),
        onAct: (act: string) => v.sideAct(act),
        onSearch: (text: string) => v.setSideFilter(text),
        onOpenDoc: (id: string) => v.selectDoc(id),
        onOpenCollection: (id: string) => v.colFlowOf().switchTo(id),
        onPersistOpen: (open: string[]) => v.setSideTreeOpen(open),
    });
    sideApp = { app: mounted.app as unknown as SidePanelExports, unmount: mounted.unmount };
    // 挂载后同步一次转换按钮的转换中态（命令式钩子，跨重建）
    updateConvertBtn(v.el, v.convertingOf(), v.t);
}

/** 壳落定后挂头部（QuizShell 调；drill 工作区才挂）。 */
export function mountHeadFor(
    v: SideViewAccess,
    workspace: WenguWorkspace,
    subheadHtml: string,
    canEndRound: boolean
): void {
    unmountHead();
    if (workspace !== "drill") return;
    const host = v.el.querySelector<HTMLElement>("[data-head-host]");
    if (!host) return;
    // 宿主为壳内空占位（data-head-host），组件片段即 .wengu-head 直接内容
    headApp = mountSvelteApp(QuizHeadApp, host, {
        t: v.t,
        sideCollapsed: v.sideCollapsedOf(),
        subheadHtml,
        canEndRound,
        onAct: (act: string) => v.sideAct(act),
    });
}

function unmountSide(): void {
    sideApp?.unmount();
    sideApp = null;
}

function unmountHead(): void {
    headApp?.unmount();
    headApp = null;
}

/** 整壳重建前的卸载（同 detachBankPanels 位）。 */
export function detachSideHead(): void {
    unmountSide();
    unmountHead();
}
