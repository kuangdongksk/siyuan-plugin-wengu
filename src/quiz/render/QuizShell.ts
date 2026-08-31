import type { QuizView } from "../index";
import { destroyStatsPanel } from "../../stats";
import { renderReviewFor, detachReviewApp } from "../../review";
import { detachCompanionPanel } from "../../companion";
import { detachBankPanels } from "../../bank";
import { bindCardEvents, restoreAnsweredCards } from "../flow/AnswerFlow";
import { renderMainShell, renderSubheadHtml } from "./CardHtml";
import type { CardHtmlModel } from "./CardParts";
import { buildDrillUnits, type DrillUnit } from "./DrillUnits";
import { detachCardApps, mountDrillUnit } from "./CardMount";
import { bindGroupUnits, bindOneGroupUnit, focusQuestion, restoreGroupScrolls } from "../flow/MaterialFlow";
import { bindNumRail, detachNumRail } from "./NumRail";
import { decoratePreview } from "../flow/PreviewFlow";
import { detachRoundReport, lockAllCards } from "./RoundReport";
import { STATIC_FRAME_BUDGET_MS } from "../service/ProtyleHost";
import { detachRail, mountRailFor, RAIL_ANCHOR_HTML } from "./RailMount";
import { detachStartPanel, mountStartPanelFor } from "./StartPanel";
import { bindHeadFor } from "../flow/ViewBindings";
import { detachSideTree, mountSideTreeFor } from "../flow/SideTreeMount";
import { renderWorkspaceFor } from "./WorkspaceShell";
import { svgIcon } from "../../ui/FormHtml";
import { esc, yieldToBrowser } from "../../ui/shared";

/**
 * 主区渲染与视图级绑定（自 QuizView 拆出压 500 行红线）：
 * renderListInner 的多模式路由（复习/预览/做题）+ bindAll 的
 * 头部/题号/开刷面板/材料组/题卡绑定。纯编排，状态全在 QuizView。
 */

/** renderList 主体（自 QuizView 拆出压 500 行红线）：整壳渲染 + 错误
 *  兜底 + 落幕统一恢复已答锁定（renderList 是整壳 innerHTML 重建——
 *  收起目录/设置变更/切工作区/继续上轮全走它，不恢复的话已答题回到
 *  未答外观、可重复提交。渐进/预览/复习不绑作答，started 未开的装载
 *  也不需要。静态路径题卡分片插入——恢复必须等全部就绪
 *  （restoreAnsweredCards 幂等，多轮渲染的在途 then 重复执行无害）。 */
export function renderListFor(v: QuizView): void {
    v.el.classList.add("wengu-panel");
    let ready: Promise<void> | undefined;
    try {
        ready = renderQuizShellFor(v);
    } catch (e) {
        v.protyleHost.destroyAll(v.el);
        v.el.innerHTML = `${RAIL_ANCHOR_HTML}<div class="wengu-head"></div>
    <div class="wengu-status wengu-status-err">${esc(v.t("loadFailed"))}${esc(
        String((e as Error)?.message ?? e)
    )}</div>`;
        bindHeadFor(v);
        mountRailFor(v); // 错误兜底 rail 一并挂载（旧路径渲染了 rail 却漏绑事件，顺修）
    }
    const restore = (): void => {
        if (v.mode === "quiz" && v.started && !v.progressive.active) restoreAnsweredCards(v);
    };
    if (ready) void ready.then(restore);
    else restore();
}

/** renderListInner 主体（QuizView.renderList 调；错误兜底留在视图）。
 *  静态路径（题库/长卷）返回「题卡全部就绪」的 Promise——已答锁定
 *  恢复、预览装饰等收尾须等它；其余路径同步完成返回 undefined。 */
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
    detachSideTree(); // 侧栏树同款（TreeList 化 20260830；回调一并作废）
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
        bindHeadFor(v);
        mountRailFor(v);
        // 复习侧栏同样有树（点行=筛选错题本到该文档，selectDoc 分流）；
        // docId 传空=不亮行（旧 renderSideHtml 同款）
        mountSideTreeFor({
            el: v.el,
            docs: () => v.docs,
            docId: () => "",
            t: v.t,
            activeCollection: () => "",
            sideTreeOpen: () => v.sideTreeOpen,
            selectDoc: (id) => v.selectDoc(id),
            setSideTreeOpen: (open) => {
                v.sideTreeOpen = open;
                v.persistPrefs();
            },
        });
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
            docs: v.docs,
            docId: v.docId,
            sideCollapsed: v.sideCollapsed,
            filter: v.sideFilter,
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
            startPanelHtml: "<div data-startpanel-host></div>",
            subheadHtml: colMode
                ? `<span class="wengu-muted">${esc(v.colFlow.activeTitle() ?? "")} · ${esc(String(v.list.length))}</span>`
                : renderSubheadHtml({ t: v.t, doc, listCount: v.list.length, rounds: v.rounds }),
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
    mountSideTreeFor({
        // 侧栏树挂载适配（回调记进 SideTreeMount，重灌后 remount 复用）
        el: v.el,
        docs: () => v.docs,
        docId: () => v.docId,
        t: v.t,
        activeCollection: () => v.colFlow.id(),
        sideTreeOpen: () => v.sideTreeOpen,
        selectDoc: (id) => v.selectDoc(id),
        setSideTreeOpen: (open) => {
            v.sideTreeOpen = open;
            v.persistPrefs();
        },
    });
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

/** 静态路径分片管线：壳已落、题卡列表空——单元逐片插入 + 绑定 +
 *  MdRender 填充（16ms 帧预算 yield），头下挂「题目渲染中 n/m」胶囊，
 *  填完摘除并恢复材料组滚动。代数变更（整壳重建）或中途异常 resolve
 *  false，收尾方据此跳过预览装饰等后续。 */
async function renderStaticChunked(v: QuizView, m: CardHtmlModel): Promise<boolean> {
    const container = v.el.querySelector<HTMLElement>(".wengu-card-list");
    if (!container) return false;
    v.el.querySelector(".wengu-main > .wengu-head")?.insertAdjacentHTML("afterend", renderingPillHtml(v.t));
    // 胶囊持元素引用摘除：选择器会把重渲染后新批次的胶囊误摘
    const pill = v.el.querySelector<HTMLElement>("[data-rendering]") ?? undefined;
    const counter = pill?.querySelector<HTMLElement>("[data-rendering-count]") ?? undefined;
    const gen = v.protyleHost.currentGen();
    const stale = () => gen !== v.protyleHost.currentGen();
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
            mountDrillUnit(container, u, m); // 组件根追加到容器尾（旧字符串插入同位）
            const el = container.lastElementChild as HTMLElement | null;
            if (el) {
                // 作答绑定守卫与 bindQuizFor 同口径（预览/渐进不绑：预览
                // 装饰只摘按钮不摘 chip，误绑会让预览态选项可选）；再加
                // started——收卷后（stopRoundNow 置 false）在途分片不再
                // 绑新卡，防收卷竞态窗口内重复提交
                const bindable = v.mode === "quiz" && !v.progressive.active && v.started;
                if (u.kind === "group") {
                    bindOneGroupUnit(el, u, {
                        onActive: (idx) => v.onActiveQ(idx),
                        onShown: () => void v.protyleHost.mountStatic(v.el, v.list, v.materials),
                    });
                    // 组内题卡与独立题同权绑作答（原组分支漏绑：题库/长卷
                    // 静态路径的材料组题全部点不动，20260829 审查）
                    if (bindable) {
                        for (const node of el.querySelectorAll<HTMLElement>(".wengu-gqs .wengu-card")) {
                            const q = v.list.find((x) => x.id === node.dataset.qid);
                            if (q) bindCardEvents(v, node, q);
                        }
                    }
                } else if (u.q && bindable) {
                    bindCardEvents(v, el, u.q);
                }
                await v.protyleHost.mountStatic(el, v.list, v.materials); // 本单元内容填充（KaTeX 惰性）
                if (v.mode === "quiz" && !v.progressive.active) {
                    // 已答锁定逐单元就地恢复（幂等）：不等全卷成像——分片
                    // 窗口内已答题呈现未答外观、事件已绑，可重复提交；收卷
                    // 后插入的卡无新会话可续，直接整卡上锁
                    if (v.currentSession()) restoreAnsweredCards(v, el);
                    if (!v.started) lockAllCards(el);
                }
            }
            done += nodesOf(u);
            if (counter) counter.textContent = `${done}/${total}`;
        }
    } catch (e) {
        console.error("[wengu] 静态分片渲染中断", e);
        return false;
    } finally {
        pill?.remove();
    }
    restoreGroupScrolls(v.el);
    return true;
}

/** 静态渲染进度胶囊：转圈图标 + 文案 + n/m 计数（mountStatic 逐卡回调）。 */
function renderingPillHtml(t: (key: string) => string): string {
    return `<div class="wengu-rendering" data-rendering>${svgIcon("iconRefresh")}<span>${esc(
        t("rendering")
    )}</span><span class="wengu-rendering-count" data-rendering-count></span></div>`;
}

/** 视图级绑定：头部/题号/题卡/材料组单元（开刷面板为 Svelte 组件，
 *  由 renderQuizShellFor 壳落后挂载，无 DOM 绑定）。 */
function bindQuizFor(v: QuizView): void {
    bindHeadFor(v);
    bindNumRail(v.el, v.list, {
        onActive: (idx) => v.onActiveQ(idx),
        onFocus: (idx) => focusQuestion(v.el, v.units, v.list, idx),
        numsTitle: v.t("qnumsTitle"),
        showNums: v.settings?.showNums !== false,
        showPast: v.mode !== "preview" && v.settings?.showWrong !== false && v.revealMode === "instant",
    });
    bindGroupUnits(v.el, v.units, v, {
        onActive: (idx) => v.onActiveQ(idx),
        onShown: () => void v.protyleHost.mountStatic(v.el, v.list, v.materials),
    });
    if (v.progressive.active || v.mode === "preview") return; // 渐进/预览不绑作答（预览事件由 decoratePreview 绑）
    for (const node of v.el.querySelectorAll<HTMLElement>(".wengu-card")) {
        const q = v.list.find((x) => x.id === node.dataset.qid);
        if (q) bindCardEvents(v, node, q);
    }
}
