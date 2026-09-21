import type { WenguDoc } from "../../types";
import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";
import type { WenguWorkspace } from "../render/RailMount";
import SidePanelApp from "../components/SidePanelApp.svelte";
import QuizHeadApp from "../components/QuizHeadApp.svelte";
import { type CollectionFlow } from "../../bank";
import { AGGREGATE_ID } from "../../bank/data/BankSets";
import { updateConvertBtn } from "../../convert";
import { fmt } from "../../ui/shared";
import type { BadMarkViewAccess } from "../service/BadMarkRegen";
import { searchKcapFor, type StatsViewAccess } from "../../stats";
import { needsSwitchConfirm, openSwitchConfirm } from "./SwitchConfirm";
import type { WenguSession } from "../service/HistoryStore";

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
    /** 侧栏两路切换入口的**共闸出口**（Issue #137 §7.d）：点击另一
     *  题集/专题/聚合行且当前轮次进行中（`!endedAt && answered > 0`）时
     *  先弹二次确认，确认后才执行 `entry.go()`。组件层无会话知识，故闸在
     *  视图层——实现体见 {@link switchGuardFor}（本模块）。
     *  可选：未实现的壳（只读壳/测试壳）由 {@link guardOrRun} 按「直切」
     *  兜底——⚠️ 兜底方向必须是「照常切换」，不能是「什么都不做」。 */
    switchGuard?(entry: SwitchEntry): void;
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
    // 壳内的 [data-side-host] 只是**挂载锚**（同 RAIL_ANCHOR_HTML 模式），
    // 不是组件宿主：`.wengu-side` 的 `flex:none` 与全高依赖它是 `.wengu-panel`
    // 的直接子元素（stretch）——锚法把组件根插到锚位后即删锚，位置与形态
    // 回到「占位 div 原所在处」，CSS 零改动。⚠️ 别退回「以 [data-side-host]
    // 为 target 直挂」（#202：组件被裹进无样式 block 宿主 ⇒ 高度塌成内容高、
    // `.wengu-side-body` 内滚窗失效）。
    const host = v.el.querySelector<HTMLElement>("[data-side-host]");
    if (!host) return;
    // *.svelte 的环境声明不带实例导出类型，这里收口一次（KnowPicker 同款）
    const mounted = mountSvelteApp(
        SidePanelApp,
        v.el,
        {
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
            // 切换入口两路（树内文档行 / 专题与聚合行）各自外包二次确认闸
            // （Issue #137 §7.d）：组件层没有会话知识，闸只在**执行体外**加
            // 一层判定——⚠️ 执行体必须留在原位（上一版把两个回调换成空函数、
            // 只留新 prop，壳未实现新能力时 `guardOrRun` 走直切兜底 ⇒ 点行
            // 无反应，静默断链）。
            onOpenDoc: (id: string) =>
                guardOrRun(
                    v,
                    switchEntryOf("doc", id, () => v.selectDoc(id))
                ),
            onOpenCollection: (id: string) =>
                guardOrRun(
                    v,
                    switchEntryOf("col", id, () => v.colFlowOf().switchTo(id))
                ),
            onPersistOpen: (open: string[]) => v.setSideTreeOpen(open),
        },
        { anchor: host }
    );
    host.remove();
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
    // 「结束本次」文案随**总结视图态**换语义（Issue #147 追加 1 尾句）：
    // 总结态下本轮已收卷，这个钮不再是「又一次结束本轮」（那本就无意义），
    // 而是总结视图的开关——总结开着=「返回题卷」，收起后=「查看总结」。
    // ⚠️ 两个判据都**别拿 [data-report] 的 hidden 当「报告已出」**：显隐是
    // 总结视图态的从属量（`exitSummaryView` 会把宿主收回 hidden），一旦
    // 用错，「返回题卷」后头部就读成「还没收卷」⇒ 文案退回「结束本次」。
    // 权威判据＝**报告卡是否已挂**（组件根 `.wengu-report`），与显隐无关。
    const summaryOpen = !!v.el.querySelector<HTMLElement>(".wengu-main.wengu-summary-view");
    const reportReady = !!v.el.querySelector<HTMLElement>("[data-report] .wengu-report");
    const endRoundLabel = summaryOpen
        ? "reportBackToQuiz"
        : reportReady
          ? "reportShowSummary"
          : afterMode
            ? "endRoundRevealBtn"
            : "endRoundBtn";
    // 宿主为壳内空占位（data-head-host），组件片段即 .wengu-head 直接内容
    headApp = mountSvelteApp(QuizHeadApp, host, {
        t: v.t,
        sideCollapsed: v.sideCollapsedOf(),
        subheadHtml,
        canEndRound,
        endRoundLabel,
        showFinishHint: canEndRound && afterMode && !reportReady,
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

/** 侧栏一次切换点击（Issue #137 §7.d）：**上下文 id 与行 id / 动作三者
 *  分开**——侧栏三处入口的行 id 口径不同（文档行=裸 `docId`；专题行=裸
 *  `col-xxxx`；聚合行=`all`），而「当前上下文」的规范口径来自
 *  `QuizView.docIdOf()`（专题模式带 `col:` 前缀，同 `bank.colSessionId`）。
 *  ⚠️ 上一版把行 id 直接当上下文 id 比，点**当前已选中的专题/聚合行**会
 *  被判成「另一上下文」而弹窗（同 id 早退失效）——两个 id 必须各归其位。 */
export interface SwitchEntry {
    /** 规范上下文 id（同 `docIdOf()` 口径）：判「是不是另一上下文」用它。 */
    ctxId: string;
    /** 侧栏行 id（目标名反查用）：专题/聚合行是裸 id，文档行=`docId`。 */
    rowId: string;
    /** 确认后执行的切换动作（未确认永不调用）。 */
    go(): void;
}

/** 侧栏行 → {@link SwitchEntry}（行 id 归位到上下文口径的唯一落点）：
 *  文档行原样，专题/聚合行加 `col:` 前缀（= `bank.colSessionId`）。 */
export function switchEntryOf(kind: "doc" | "col", rowId: string, go: () => void): SwitchEntry {
    return { ctxId: kind === "col" ? `col:${rowId}` : rowId, rowId, go };
}

/** 切换入口的共闸（Issue #137 §7.d）：按 {@link switchGuardFor} 判定，
 *  需确认则弹窗、确认后才切；视图能力未实现 `switchGuard` 的壳
 *  （只读壳/测试壳）按「直切」兜底——与改造前行为逐字一致。 */
export function guardOrRun(v: SideViewAccess, entry: SwitchEntry): void {
    if (typeof v.switchGuard === "function") v.switchGuard(entry);
    else entry.go();
}

/** 二次确认闸的**装配体**（`SidePanelApp.guard` 的实现，视图侧一行转出）：
 *  组件层没有会话知识，判据所需的模式/会话/上下文三件套全在这里按需从
 *  宿主拉取（`guardCtx()` / `currentSession()` **必须是函数**——挂载时
 *  预求值会把上一轮的值定格，闸就永远读不到「点击那一刻」）。 */
export interface SwitchGuardAccess {
    /** 点击那一刻的上下文快照（见 {@link guardCtxFor}）。 */
    guardCtx(): { mode: string; currentId: string; total: number };
    /** 当前会话（`QuizView.currentSession()`）。 */
    currentSession(): WenguSession | undefined;
    /** 当前专题流（目标名解析用；`QuizView.colFlowOf()`）。 */
    colFlowOf(): CollectionFlow;
    /** 目标上下文名（专题/聚合行标题 / 文档标题）。 */
    targetName(id: string): string;
    t(key: string): string;
    docsOf(): WenguDoc[];
}

/** 点击那一刻的上下文快照（模式 / 当前上下文 id / 本卷题数）：闸的三条
 *  判据里除会话外都要**现取**——挂载时预求值会把上一轮的值定格。 */
export function guardCtxFor(v: SwitchCtxAccess): () => { mode: string; currentId: string; total: number } {
    return () => ({ mode: v.mode, currentId: v.docIdOf(), total: v.fullListOf().length });
}

/** 上下文快照的视图能力（`QuizView` 三个既有访问器直接结构匹配）。 */
export interface SwitchCtxAccess {
    /** 模式（`QuizView.mode` 字段；review/preview 不拦）。读的是**字段**
     *  不是方法——`QuizView` 已有同名 `mode` 字段，别再添 `modeOf`。 */
    mode: string;
    /** 当前上下文 id（同 id 早退判据）。 */
    docIdOf(): string;
    /** 全量题表（弹窗进度实况的分母）。 */
    fullListOf(): { id: string }[];
}

/** 侧栏切换入口的闸（Issue #137 §7.d）：判定→（需确认时）弹窗→确认后切。
 *  `QuizView.switchGuardOf` 即本函数的实例（一行转出，压 index.ts 行数）。
 *
 *  ⚠️ 判据三件套（模式/会话/上下文）**逐次现取**——预求值会在挂载时把
 *  上一轮的 session 定格，闸就永远读不到「点击那一刻」。 */
export function switchGuardFor(v: SwitchGuardAccess): (entry: SwitchEntry) => void {
    return (entry) => {
        const ctx = v.guardCtx();
        const session = v.currentSession();
        if (
            !needsSwitchConfirm({
                mode: ctx.mode,
                session,
                targetId: entry.ctxId,
                currentId: ctx.currentId,
            })
        ) {
            entry.go();
            return;
        }
        openSwitchConfirm({
            t: v.t,
            targetName: v.targetName(entry.rowId),
            session: session as WenguSession,
            total: ctx.total,
            onGo: entry.go,
        });
    };
}

/** 切换目标名（弹窗文案 `{目标名}`）：专题/聚合行取行标题（聚合行标题与
 *  侧栏根行同键 `allExTitle`），文档行取标题、回落 id——id 是**兜底**不是
 *  首选（弹窗要给用户认得出的名字）。 */
export function switchTargetNameFor(v: SwitchGuardAccess, id: string): string {
    if (id === AGGREGATE_ID) return v.t("allExTitle");
    const row = v
        .colFlowOf()
        .rowsView()
        .find((c) => c.id === id);
    if (row) return row.title;
    const doc = v.docsOf().find((d) => d.id === id);
    return doc?.title || id;
}

/** 取轮次序号（视图能力可选——只读壳/测试壳不实现即回 0，胶囊不出）。 */
function roundIndex(v: SideViewAccess): number {
    return typeof v.roundIndex === "function" ? v.roundIndex() : 0;
}

/** 进行中轮的 1-based 序号（Issue #135 §3.5 头部分段胶囊）。
 *
 *  ⚠️ **不能用 `rounds.length` 当序号**（真机 off-by-one，两处都对不上）：
 *  `rounds` 是装载时的历史快照，`startRound` 只把它 upsert 落盘、**不追加
 *  进这个数组**，所以
 *    - 新开一轮：快照里有 N 个历史轮，进行中的是第 N+1 轮，取 length 会
 *      少报一轮（显示「第 0 轮」当 N=0）；
 *    - 「继续上次」：session 就是快照里的那个未收卷轮，它已在 length 里，
 *      再 +1 就多报一轮。
 *  正解=**按 id 在表内定位**：命中取位次 +1；未命中（新轮）取 length +1。
 *  无进行中轮（session 空）回 0，调用侧据此不出胶囊。
 *  纯函数落这里而不是 index.ts：编排层已顶到豁免额度（§11.1 红线）。 */
export function roundIndexFor(rounds: { id: string }[], session?: { id: string }): number {
    if (!session) return 0;
    const i = rounds.findIndex((r) => r.id === session.id);
    return i >= 0 ? i + 1 : rounds.length + 1;
}
