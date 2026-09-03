import { errText } from "./../../ui/shared";
import type { QuizView } from "../index";
import { destroyStatsPanel } from "../../stats";
import { renderReviewFor, detachReviewApp, reviewHeadSummary } from "../../review";
import { detachCompanionPanel } from "../../companion";
import { detachBankPanels } from "../../bank";
import { renderMainShell, renderSubheadHtml } from "./CardHtml";
import type { CardHtmlModel } from "./CardParts";
import { buildDrillUnits, type DrillUnit } from "./DrillUnits";
import { detachCardApps, mountDrillUnit } from "./CardMount";
import { restoreContextFor, type CardInitCtx } from "./CardState";
import { focusQuestion } from "../flow/MaterialFlow";
import { bindNumRail, detachNumRail } from "./NumRail";
import { decoratePreview } from "../flow/PreviewFlow";
import { detachRoundReport } from "./RoundReport";
import { STATIC_FRAME_BUDGET_MS } from "../service/ProtyleHost";
import { detachRail, mountRailFor, RAIL_ANCHOR_HTML } from "./RailMount";
import { detachStartPanel, mountStartPanelFor } from "./StartPanel";
import { detachSideHead, mountHeadFor, mountSideFor } from "../flow/SideMount";
import { renderWorkspaceFor } from "./WorkspaceShell";
import { svgIcon } from "../../ui/FormHtml";
import { esc, yieldToBrowser } from "../../ui/shared";

/**
 * 主区渲染与视图级绑定（自 QuizView 拆出压 500 行红线）：
 * renderListInner 的多模式路由（复习/预览/做题）+ bindAll 的
 * 头部/题号/开刷面板/材料组/题卡绑定。纯编排，状态全在 QuizView。
 */

/** renderList 主体（自 QuizView 拆出压 500 行红线）：整壳渲染 + 错误
 *  兜底。6-4b 起已答恢复收敛进题卡初始态（buildCardInit 恢复源由
 *  renderStaticChunked 挂第一张卡前一次算好）——renderList 是整壳
 *  innerHTML 重建（收起目录/设置变更/切工作区/继续上轮全走它），
 *  恢复态随组件挂载自然回位，无需落幕统一恢复。 */
export function renderListFor(v: QuizView): void {
    v.el.classList.add("wengu-panel");
    try {
        v.renderTask = renderQuizShellFor(v); // 手动收卷揭示等分片就绪（revealAnsweredNow）
    } catch (e) {
        v.protyleHost.destroyAll(v.el);
        v.el.innerHTML = `${RAIL_ANCHOR_HTML}<div class="wengu-head"></div>
    <div class="wengu-status wengu-status-err">${esc(v.t("loadFailed"))}${esc(errText(e))}</div>`;
        mountRailFor(v); // 错误兜底 rail 一并挂载（旧路径渲染了 rail 却漏绑事件，顺修）
    }
}

/** renderListInner 主体（QuizView.renderList 调；错误兜底留在视图）。
 *  静态路径（题库/长卷）返回「题卡全部就绪」的 Promise——预览装饰等
 *  收尾须等它；其余路径同步完成返回 undefined。 */
export function renderQuizShellFor(v: QuizView): Promise<void> | undefined {
    v.protyleHost.destroyAll(v.el);
    destroyStatsPanel(); // innerHTML 覆盖前先 dispose 图表实例防泄漏
    detachCompanionPanel(); // Svelte 面板先卸再挂（防实例滞留，同 statsPanel 位）
    detachBankPanels(); // bank 两面板同款（专题/知识文档）
    detachReviewApp(); // 复习主区同款（Svelte 化 20260830）
    detachStartPanel(); // 开刷面板同款（Svelte 化 20260830）
    detachRoundReport(); // 轮次报告同款（Svelte 化 20260830）
    detachRail(); // 工作区 rail 同款（Svelte 化 20260830）
    detachNumRail(); // 题号栏同款（Svelte 化 20260830）
    detachSideHead(); // 侧栏/头部同款（Svelte 化 6-5；原 SideTreeMount 并入侧栏）
    detachCardApps(); // 题卡/组单元组件同款（6-4a 渲染层组件化）
    // 预览类打在持久根 el 上、不随 innerHTML 重建消亡——任何重渲染先摘，
    // 否则退出预览后残留的 pointer-events:none 会锁死做题选项（20260828
    // 审查；预览模式稍后由 decoratePreview 重新加回）
    v.el.classList.remove("wengu-pv", "wengu-pv-secret");
    // 三栏格局：非刷题工作区（学伴/专题/知识文档）整体换内容后返回
    if (v.workspace !== "drill") {
        renderWorkspaceFor(v);
        return;
    }
    // M6 多模式路由：复习（错题本）由 ReviewFlow 全权渲染；预览复用做题
    // 壳（题卡全揭示、不作答）；study 仍预留
    if (v.mode === "review") {
        renderReviewFor(v);
        mountRailFor(v);
        // 复习侧栏同样有树（点行=筛选错题本到该文档，selectDoc 分流）；
        // docId 传空=不亮行（旧 renderSideHtml 同款，经 sideReviewAccess 适配）；
        // 次头部待刷/已掌握计数经 reviewHeadSummary 喂 QuizHeadApp
        mountSideFor(sideReviewAccess(v), "drill");
        mountHeadFor(sideReviewAccess(v), "drill", reviewHeadSummary(v.t), false);
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
    // 渲染路径：全量静态（20260830 起内嵌 Protyle 轨退役）——无内核
    // 请求、无 N 个 Protyle 实例。静态路径「视口优先」：壳先落（题卡
    // 列表空）、单元逐片插入+绑定+填充，消灭整壳一次性解析的冻结；
    // KaTeX 惰性到接近视口（renderMathWhenVisible），卡片
    // content-visibility 跳过屏外布局。
    v.el.innerHTML =
        RAIL_ANCHOR_HTML +
        renderMainShell({
            t: v.t,
            loading: v.loading,
            loadError: v.loadError,
            // 预览视为常开：不落开刷面板，直接展示全部题卡
            started: v.started || pv,
            previewing: v.progressive.active,
            hasDoc: !!doc,
            listCount: v.list.length,
            startPanelHtml: "<div data-startpanel-host></div>",
            cardsHtml: "",
            // 题号栏改 Svelte 挂载锚（bindNumRail 以 anchor 法插入；
            // 设置关闭/无题不放锚=不挂栏，旧 renderNumsHtml 同款守卫）
            numsHtml: v.settings?.showNums !== false && v.list.length > 0 ? "<div data-nums-anchor></div>" : "",
        });
    bindQuizFor(v); // 静态路径卡事件改逐片绑（bindQuizFor 的全量卡循环此时扫到空表）
    mountRailFor(v);
    // 开刷面板挂载（renderMainShell 的面板态条件同款：非加载/错误、
    // 有文档有题、未开刷非预览渐进）
    if (!v.loading && !v.loadError && doc && v.list.length > 0 && !v.started && !pv && !v.progressive.active) {
        mountStartPanelFor(v);
    }
    // 侧栏/头部组件挂载（6-5；原 SideTreeMount/renderSideHtml/renderHeadHtml
    // 退役——树/搜索/专题/次头部全进组件，计时器/转换条等命令式钩子走 DOM 契约）
    const subhead = colMode
        ? `<span class="wengu-muted">${esc(v.colFlow.activeTitle() ?? "")} · ${esc(String(v.list.length))}</span>`
        : renderSubheadHtml({ t: v.t, doc, listCount: v.list.length, rounds: v.rounds });
    mountSideFor(sideQuizAccess(v), "drill");
    mountHeadFor(sideQuizAccess(v), "drill", subhead, v.started && !pv);
    v.timerBinder.updateLabel();
    const task = renderStaticChunked(v, cardModel);
    // 预览装饰等题卡全部插入后再做（此前同步跑在空列表上会漏掉全部
    // 卡）；stale 放弃的批次不装饰——新批次自己会装饰，旧批次补挂会
    // 错挂新壳/对同 DOM 翻倍追加（装饰全是非幂等 insertAdjacentHTML）
    if (pv)
        void task.then((fresh) => {
            if (fresh) decoratePreview(v.el, v.list, v.t, () => v.switchMode("quiz"));
        });
    return task.then((): void => {
        /* 就绪信号（restore 等收尾由调用方挂） */
    });
}

/** 静态路径分片管线：壳已落、题卡列表空——单元逐片以组件挂载
 * （16ms 帧预算 yield），头下挂「题目渲染中 n/m」胶囊，填完摘除。
 * 题干/材料静态填充与 KaTeX 惰性已收进组件 onMount（6-4b）；已答
 * 恢复收敛进卡初始态（buildCtx 首挂前一次算好），收卷后的在途
 * 分片以 locked=true 初始态直锁。代数变更（整壳重建）或中途异常
 * resolve false，收尾方据此跳过预览装饰等后续。 */
async function renderStaticChunked(v: QuizView, m: CardHtmlModel): Promise<boolean> {
    const container = v.el.querySelector<HTMLElement>(".wengu-card-list");
    if (!container) return false;
    v.el.querySelector(".wengu-main > .wengu-head")?.insertAdjacentHTML("afterend", renderingPillHtml(v.t));
    // 胶囊持元素引用摘除：选择器会把重渲染后新批次的胶囊误摘
    const pill = v.el.querySelector<HTMLElement>("[data-rendering]") ?? undefined;
    const counter = pill?.querySelector<HTMLElement>("[data-rendering-count]") ?? undefined;
    const gen = v.protyleHost.currentGen();
    const stale = () => gen !== v.protyleHost.currentGen();
    // 卡初始态上下文（全部卡共用一份）：interactive=可作答（做题已开刷
    // 非渐进）；locked=收卷后（stopRoundNow 置 started=false）在途分片
    // 直锁；restore=继续上轮/收卷重渲染的恢复源（预览/渐进不传——预览
    // 无会话、渐进文档每批重建块 id 失效不可续答）
    const ctx: CardInitCtx = {
        t: v.t,
        interactive: v.mode === "quiz" && !v.progressive.active && v.started,
        locked: v.mode === "quiz" && !v.progressive.active && !v.started,
        restore:
            v.mode === "quiz" && !v.progressive.active
                ? restoreContextFor(v.list, v.currentSession(), v.revealMode)
                : undefined,
    };
    // 节点口径：独立题单元=1 个题卡节点；组单元=组内题+材料。原只算
    // 组口径，纯独立题长卷全程显示「渲染中 0/0」（20260829 审查）。
    const nodesOf = (u: DrillUnit) => (u.kind === "group" ? (u.qs?.length ?? 0) + (u.mid ? 1 : 0) : 1);
    const total = v.units.reduce((n, u) => n + nodesOf(u), 0);
    let done = 0;
    let deadline = performance.now() + STATIC_FRAME_BUDGET_MS;
    try {
        for (const u of v.units) {
            if (stale()) return false; // 整壳已重建，放弃本轮
            if (performance.now() > deadline) {
                await yieldToBrowser();
                if (stale()) return false;
                deadline = performance.now() + STATIC_FRAME_BUDGET_MS;
            }
            mountDrillUnit(container, u, m, ctx, v); // 组件根追加到容器尾（恢复/作答态随挂载就位）
            done += nodesOf(u);
            if (counter) counter.textContent = `${done}/${total}`;
        }
    } catch (e) {
        console.error("[wengu] 静态分片渲染中断", e);
        return false;
    } finally {
        pill?.remove();
    }
    return true;
}

/** 静态渲染进度胶囊：转圈图标 + 文案 + n/m 计数（mountStatic 逐卡回调）。 */
function renderingPillHtml(t: (key: string) => string): string {
    return `<div class="wengu-rendering" data-rendering>${svgIcon("iconRefresh")}<span>${esc(
        t("rendering")
    )}</span><span class="wengu-rendering-count" data-rendering-count></span></div>`;
}

/** 视图级绑定：题号栏（头部 6-5 起组件化，此层只剩题号；题卡与
 *  材料组单元 6-4b 起组件自管——作答事件组件直调流程、组导航收进
 *  GroupUnitApp，无卡级 DOM 绑定）。 */
function bindQuizFor(v: QuizView): void {
    bindNumRail(v.el, v.list, {
        onActive: (idx) => v.onActiveQ(idx),
        onFocus: (idx) => focusQuestion(v.el, idx),
        numsTitle: v.t("qnumsTitle"),
        showNums: v.settings?.showNums !== false,
        showPast: v.mode !== "preview" && v.settings?.showWrong !== false && v.revealMode === "instant",
    });
}

/** 侧栏/头部挂载入参适配（quiz/preview 主路径）：QuizView 已实现的
 *  箭头属性直接复用；sideAct 统一出口在 QuizView（侧栏/头部按钮）。 */
function sideQuizAccess(v: QuizView): import("../flow/SideMount").SideViewAccess {
    return {
        el: v.el,
        t: v.t,
        docsOf: () => v.docs,
        docIdOf: () => v.docId,
        sideCollapsedOf: () => v.sideCollapsed,
        sideFilterOf: () => v.sideFilter,
        hasSettingsBtn: () => !!v.openSettings,
        sideTreeOpenOf: () => v.sideTreeOpen,
        colFlowOf: () => v.colFlow,
        convertingOf: () => v.convertingOf(),
        setSideFilter: (text) => v.setSideFilter(text),
        selectDoc: (id) => v.selectDoc(id),
        setSideTreeOpen: (open) => {
            v.sideTreeOpen = open;
            v.persistPrefs();
        },
        sideAct: (act) => v.sideAct(act),
    };
}

/** 侧栏/头部挂载入参适配（review 路径）：docId 传空=不亮行，selectDoc
 *  分流为筛选错题本（selectDoc 内部按 mode==="review" 路由）。 */
function sideReviewAccess(v: QuizView): import("../flow/SideMount").SideViewAccess {
    return { ...sideQuizAccess(v), docIdOf: () => "" };
}
