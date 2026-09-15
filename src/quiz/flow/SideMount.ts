import type { WenguDoc } from "../../types";
import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";
import type { WenguWorkspace } from "../render/RailMount";
import SidePanelApp from "../components/SidePanelApp.svelte";
import QuizHeadApp from "../components/QuizHeadApp.svelte";
import type { CollectionFlow } from "../../bank";
import { updateConvertBtn } from "../../convert";
import { fmt } from "../../ui/shared";
import type { BadMarkViewAccess } from "../service/BadMarkRegen";
import { searchKcapFor, type StatsViewAccess } from "../../stats";

/** 侧栏/头部按钮统一出口（act 名同 data-act）：SidePanelApp/QuizHeadApp
 *  的 onAct 回调经 SideViewAccess.sideAct 汇到这里分派——原来是
 *  ViewBindings 的逐钮 DOM 绑定（refresh/convert/side-fold/side-toggle/
 *  end-round/stats/collections），6-5 组件化后收为一个 switch。视图能力
 *  经 SideActAccess 结构匹配（QuizView 箭头属性复用）。设置入口不在
 *  此（20260910 挪 rail，见 RailMount）。 */
export interface SideActAccess {
    reloadView(): Promise<void>;
    openConvert(): void;
    openStatsPanelAt(tab: "overview" | "doc"): void;
    colFlowOf(): CollectionFlow;
    setSideCollapsed(collapsed: boolean): void;
    endRound(): void;
    /** 切 AI 会话工作区（SidePanelApp 的 `.wengu-side-ai` 入口，Issue #135 §1.4）。 */
    switchWorkspace(ws: WenguWorkspace): void;
    /** 「标记为错题」访问器（Issue #46；预览闸/徽标数/批量重转三合一，
     *  实现体见 service/BadMarkRegen）。 */
    badMark: BadMarkViewAccess;
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
            case "side-fold":
                v.setSideCollapsed(true);
                break;
            case "side-toggle":
                v.setSideCollapsed(false);
                break;
            case "end-round":
                v.endRound();
                break;
            case "side-ai":
                v.switchWorkspace("ai");
                break;
            case "regen-bad":
                v.badMark.regen();
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
    /** 「标记为错题」访问器（Issue #46）：预览闸 + 跨卷标记数，头部
     *  「批量重转标记的错题(N)」的渲染闸与徽标都取它（N=0 不出钮）。 */
    badMark: BadMarkViewAccess;
    t(key: string): string;
    docsOf(): WenguDoc[];
    docIdOf(): string;
    sideCollapsedOf(): boolean;
    sideFilterOf(): string;
    sideTreeOpenOf(): string[];
    colFlowOf(): CollectionFlow;
    convertingOf(): boolean;
    setSideFilter(text: string): void;
    /** 本轮序号（「第 N 轮 · 进行中」胶囊用；无进行中轮次回 0）。
     *  可选——只读壳/测试壳不实现即回 0（胶囊不出）。 */
    roundIndex?(): number;
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
    canEndRound: boolean,
    /** after 模式（收卷后揭示）：按钮措辞与提示随语义变（Issue #12 B3） */
    afterMode = false
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
        // after 模式收卷＝交卷看答案（用户唯一能结束编辑窗口的入口）
        endRoundLabel: afterMode ? "endRoundRevealBtn" : "endRoundBtn",
        showFinishHint: canEndRound && afterMode,
        // 预览头部「批量重转标记的错题(N)」（Issue #46；N=0 不显示）
        showRegenBad: v.badMark.previewing() && v.badMark.count() > 0,
        badMarkCount: v.badMark.count(),
        // 「第 N 轮 · 进行中」胶囊（Issue #135 §3.5，C 类可选增强）：模式
        // 切换器已裁撤，胶囊位改作轮次指示（不复活切换器）；无进行中轮次
        // （roundIndex=0）不出
        roundModeLabel: roundIndex(v) > 0 ? fmt(v.t("headRoundRunning"), { n: String(roundIndex(v)) }) : undefined,
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

/** 题卡考点 chip 的检索出口（Issue #135 §7.a）：进统计面板的考点视图。
 *  与 sideAct 同域（都是「视图动作的薄壳出口」），落此以保 `quiz/index.ts`
 *  不净增（红线 §11.1，豁免额度即上限）。取柯里化形态——`QuizView` 的
 *  访问器表按它直接落属性（无需再包一层 anonymous 箭头）。 */
export const kcapSearchFor =
    (v: StatsViewAccess): ((knowledge: string) => void) =>
    (knowledge) =>
        searchKcapFor(v, knowledge);

/** 取轮次序号（视图能力可选——只读壳/测试壳不实现即回 0，胶囊不出）。 */
function roundIndex(v: SideViewAccess): number {
    return typeof v.roundIndex === "function" ? v.roundIndex() : 0;
}
