import { errText } from "./../../ui/shared";
import type { QuizView } from "../index";
import { destroyStatsPanel } from "../../stats";
import { renderReviewFor, detachReviewApp, reviewHeadSummary } from "../../review";
import { detachCompanionPanel } from "../../companion";
import { detachBankPanels } from "../../bank";
import { setFallbackTitle } from "../../bank/data/BankSets";
import { renderMainShell, renderSubheadHtml } from "./CardHtml";
import type { CardHtmlModel } from "./CardParts";
import { buildDrillUnits, buildSetGroups, type DrillUnit, type SetGroup } from "./DrillUnits";
import { shuffleListForDisplay } from "./CardDisplayShuffle";
import { readingShellScope, unitStartIdx, wrapPlanOf } from "../flow/ReadingScope";
import { detachCardApps, mountDrillUnit } from "./CardMount";
import { restoreContextFor, type CardInitCtx } from "./CardState";
import { focusQuestion } from "../flow/MaterialFlow";
import { refreshAllClueMarks } from "../flow/ClueFlow";
import { bindNumRail, detachNumRail } from "./NumRail";
import { decoratePreview } from "../flow/PreviewFlow";
import { badMarkedSet } from "../../bank/data/BadMark";
import { detachRoundReport } from "./RoundReport";
import { STATIC_FRAME_BUDGET_MS } from "../service/ProtyleHost";
import { detachRail, mountRailFor, RAIL_ANCHOR_HTML } from "./RailMount";
import { detachStartPanel, mountStartPanelFor } from "./StartPanel";
import { detachSideHead, mountHeadFor, mountSideFor } from "../flow/SideMount";
import { renderWorkspaceFor } from "./WorkspaceShell";
import { svgIcon } from "../../ui/FormHtml";
import { esc, fmt, yieldToBrowser } from "../../ui/shared";

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
 *  收尾须等它；其余路径同步完成返回 undefined。
 *  ⚠️ 本函数必须**保持同步签名**（Issue #46 审查）：渲染期任何 await 都会把
 *  「壳落 + 头部/侧栏挂载」推后到微任务，renderList 的一众同步调用方
 *  （applySettings/switchMode/switchWorkspace/load…）会读到半成品壳；同步段
 *  抛错还会变成 rejected Promise，使 renderListFor 的 try/catch 失效。标记
 *  清单故走同步快照 `badMarkedSet(bank.peek())`（AnnoScopeCtl/SideMount 同款）。 */
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
    // 展示层选项洗牌（Issue #131）：库/源文档=死形态（原文原序），消剧透
    // 改在进卡前现洗——只换**卡内选项顺序**（答案字母随同一映射重写），
    // 卷内顺序/题号/材料链不变。**预览模式不洗**（要看死形态对照原文），
    // 渐进呈现（转换中）也不洗（生成产物即死形态、重渲染会跳序）。
    // ⚠️ 排列按 **(会话 id, 题 id)** 定种子（`scope` 传会话 id）：会话只
    // 记字母、排列只在卡里，重渲染（拉开侧栏/改设置/收卷重渲/重开页签）
    // 若重掷，恢复出来的字母就指到别的选项上——必须同轮恒定；换轮换
    // 会话 id 即换排列，消剧透仍成立（见 CardDisplayShuffle 文件头）。
    // 洗的是副本（`v.list` 原件不动）——会话恢复/记账按 id 走，视图
    // 快照与判分口径都不受影响。
    const displayList =
        pv || v.progressive.active ? v.list : shuffleListForDisplay(v.list, { scope: v.currentSession()?.id ?? "" });
    v.units = buildDrillUnits(displayList, v.materials);
    // 题集分组（多集合刷：题号栏横线 + 正文标题行；单题集一段=零装饰）。
    // 分组只切分视图——列表顺序是题集先后 × 集内原序，绝不重排。
    const setGroups = buildSetGroups(v.list, (id) => v.docs.find((d) => d.id === id)?.title || setFallbackTitle(id));
    // 阅读面作用域（Issue #81，Issue #83 **改结构判据**）：判据是
    // **材料组结构**（材料块 + 依附小题 = 一题多问），与学科/题型零关系
    // ——材料组是全学科通用结构（英语阅读/完形、语文文言文、政治材料
    // 分析、工科一题多问都是）。**唯一判定点**（见 ReadingScope）：
    //   · 组单元自身无条件挂 `.wengu-reading`（GroupUnitApp 自判）；
    //   · 整壳题卡列表只在**全部单元都是材料组**时挂（纯材料/一题多问
    //     卷 ⇒ 产物与改造前同形、零包装）；混合（聚合「全部习题」/跨学科
    //     专题，或同卷既有独立题又一题多问）下改由 wrapPlanOf 逐个包装
    //     材料组单元——**独立题卡始终零装饰**（不再按首题一判到底）。
    //     判据按**单元**而不是按段整包：同段既有独立题又一题多问时整段
    //     包装会把独立题卡也染上阅读面（违反 #83 验收 3）。包装/复用规则
    //     收口在纯函数 wrapPlanOf（带单测）——含「跨题集段必须断链」一条。
    // ⚠️ 别再拿英语判别（isEnglishScope）当阅读面判据：那让「判别不出
    // 英语」的材料组连美化一起丢（#83 根因）；英语判别只服务「标生词」。
    const reading = readingShellScope(v.units);
    const cardModel: CardHtmlModel = {
        t: v.t,
        showAttempts: v.settings?.showAttempts !== false,
        // 预览不透历史对错（题号/徽标/描色全中性，保密）
        showWrongBadge: !pv && v.settings?.showWrong !== false && v.revealMode !== "after",
        // 「标记为错题」钮只在预览模式渲染（Issue #46；做题模式不加）
        preview: pv,
        // 材料/题目分隔条比例（Issue #138 §7.c）：undefined=从未拖过，
        // 材料组不写内联内联值、回 CSS 的 52vh 默认（短材料/独立题零变化）
        matCapRatio: v.matSplit.current,
    };
    // 已标记为错题的 qid 集合（Issue #46；卡头标记钮初态回灌；非预览不查——
    // 做题模式没有这个钮）。**同步读题库快照**（peek）：渲染路径不 await 查库
    // （见本函数头注）；未装载时为空集=全部未标记。
    const badMarks = pv ? badMarkedSet(v.bankStore()?.peek()) : new Set<string>();
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
            // 专题/聚合模式没有 docs 行，但同样有开刷面板态（hasDoc 只
            // 决定壳走面板分支还是空态文案——旧值在专题模式落空态文案
            // 且不挂面板，专题刷题卡死为锁定卡，20260903 定诊随聚合修复）
            hasDoc: colMode || !!doc,
            listCount: v.list.length,
            reading,
            startPanelHtml: "<div data-startpanel-host></div>",
            cardsHtml: "",
            // 题号栏改 Svelte 挂载锚（bindNumRail 以 anchor 法插入；
            // 设置关闭/无题不放锚=不挂栏，旧 renderNumsHtml 同款守卫）
            numsHtml: v.settings?.showNums !== false && v.list.length > 0 ? "<div data-nums-anchor></div>" : "",
        });
    bindQuizFor(v); // 静态路径卡事件改逐片绑（bindQuizFor 的全量卡循环此时扫到空表）
    mountRailFor(v);
    // 开刷面板挂载（renderMainShell 的面板态条件同款：非加载/错误、
    // 有上下文有题、未开刷非预览渐进）
    if (
        !v.loading &&
        !v.loadError &&
        (doc || colMode) &&
        v.list.length > 0 &&
        !v.started &&
        !pv &&
        !v.progressive.active
    ) {
        mountStartPanelFor(v);
    }
    // 侧栏/头部组件挂载（6-5；原 SideTreeMount/renderSideHtml/renderHeadHtml
    // 退役——树/搜索/专题/次头部全进组件，计时器/转换条等命令式钩子走 DOM 契约）
    const subhead = colMode
        ? `<span class="wengu-muted">${esc(v.colFlow.activeTitle() ?? "")} · ${esc(String(v.list.length))}</span>`
        : renderSubheadHtml({ t: v.t, doc, listCount: v.list.length, rounds: v.rounds });
    mountSideFor(sideQuizAccess(v), "drill");
    mountHeadFor(sideQuizAccess(v), "drill", subhead, v.started && !pv, v.revealMode === "after");
    v.timerBinder.updateLabel();
    // 包装计划（纯判定在 ReadingScope.wrapPlanOf）：逐单元给出包装序号，
    // 段下标按 buildSetGroups 的 start 现算（与标题行落位同一口径）
    const segOfUnit = v.units.map((u) => {
        const idx = unitStartIdx(u);
        for (let i = setGroups.length - 1; i >= 0; i--) if (idx >= setGroups[i].start) return i;
        return -1;
    });
    const task = renderStaticChunked(v, cardModel, setGroups, badMarks, wrapPlanOf(v.units, segOfUnit), segOfUnit);
    // 预览装饰等题卡全部插入后再做（此前同步跑在空列表上会漏掉全部
    // 卡）；stale 放弃的批次不装饰——新批次自己会装饰，旧批次补挂会
    // 错挂新壳/对同 DOM 翻倍追加（装饰全是非幂等 insertAdjacentHTML）
    if (pv)
        void task.then((fresh) => {
            if (fresh) decoratePreview(v.el, v.list, v.t, () => v.switchMode("quiz"), v.bankStore());
        });
    return task.then((fresh): void => {
        // Issue #28：整壳就绪后补一遍线索高亮/chips（会话恢复/重开页签
        // 的第三处挂载时机——组单元材料填充走的是自己那份 onMount，
        // 并行挂载下组内非当前题的顺序不保证，这里按表收口，幂等）；
        // stale 批次不补（新壳自己会补）
        if (fresh) refreshAllClueMarks(v, v.list);
    });
}

/** 静态路径分片管线：壳已落、题卡列表空——单元逐片以组件挂载
 * （16ms 帧预算 yield），头下挂「题目渲染中 n/m」胶囊，填完摘除。
 * 题卡/材料静态填充与 KaTeX 惰性已收进组件 onMount（6-4b）；已答
 * 恢复收敛进卡初始态（buildCtx 首挂前一次算好），收卷后的在途
 * 分片以 locked=true 初始态直锁。代数变更（整壳重建）或中途异常
 * resolve false，收尾方据此跳过预览装饰等后续。setGroups 非单段时
 * 在每段首单元前插题集标题行（多集合刷的正文分组）。 */
async function renderStaticChunked(
    v: QuizView,
    m: CardHtmlModel,
    setGroups: SetGroup[],
    /** 已标记为错题的 qid 集合（Issue #46；非预览恒空集）。 */
    badMarks: Set<string> = new Set(),
    /** 逐单元的**包装序号**（Issue #83，纯判定在 ReadingScope.wrapPlanOf）：
     *  -1=落在外层（整壳已带类名 / 独立题单元），>=0=落进第 n 个包装。
     *  ⚠️ 复用规则（连续**且同段**才共用包装）也在纯函数里，本层只施工。 */
    wrapPlan: readonly number[] = [],
    /** 逐单元的题集段下标（与 wrapPlan 同一份来源，标题行落位用）。 */
    segOf: readonly number[] = []
): Promise<boolean> {
    const container = v.el.querySelector<HTMLElement>(".wengu-card-list");
    if (!container) return false;
    const showHeads = setGroups.length > 1;
    // 单元级阅读面包装（Issue #83）：按 wrapPlan 把材料组单元套进
    // `.wengu-set-seg.wengu-reading` 包装——整卷都是材料组时整壳已挂类名、
    // 计划全 -1（默认渲染产物逐字节不变）；独立题单元落在外层（零装饰）。
    // 标题行留在包装**外**：`.wengu-set-head:first-child` 的首/续段间距口径
    // 不变（包装会让每段标题都成 first-child，白改外观）。
    // 复用规则（连续**且同段**才共用包装）见 ReadingScope.wrapPlanOf。
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
        // 考点 chips 的检索出口（Issue #135 §7.a）：进统计面板的考点视图。
        // 不传 ⇒ chip 降级纯展示（预览/复习等只读壳不在统计视图里）
        kcapSearch: v.kcapSearchOf,
    };
    // 节点口径：独立题单元=1 个题卡节点；组单元=组内题+材料。原只算
    // 组口径，纯独立题长卷全程显示「渲染中 0/0」（20260829 审查）。
    const nodesOf = (u: DrillUnit) => (u.kind === "group" ? (u.qs?.length ?? 0) + (u.mid ? 1 : 0) : 1);
    const total = v.units.reduce((n, u) => n + nodesOf(u), 0);
    let done = 0;
    let deadline = performance.now() + STATIC_FRAME_BUDGET_MS;
    // 包装元素按序号懒建一次（计划保证同一序号只在连续同段内出现，故
    // 复用即正确顺序；序号单调递增 ⇒ 建序 = 落位序）。
    const wraps = new Map<number, HTMLElement>();
    const wrapOf = (ordinal: number): HTMLElement => {
        const hit = wraps.get(ordinal);
        if (hit) return hit;
        container.insertAdjacentHTML("beforeend", '<div class="wengu-set-seg wengu-reading"></div>');
        const el = container.lastElementChild as HTMLElement;
        wraps.set(ordinal, el);
        return el;
    };
    try {
        for (let unitIdx = 0; unitIdx < v.units.length; unitIdx++) {
            const u = v.units[unitIdx];
            if (stale()) return false; // 整壳已重建，放弃本轮
            if (performance.now() > deadline) {
                await yieldToBrowser();
                if (stale()) return false;
                deadline = performance.now() + STATIC_FRAME_BUDGET_MS;
            }
            // 单元所属题集段与「是否段首单元」（段首插标题行）——段下标由
            // 调用方一次算好传入，与包装计划同源
            const segIdx = segOf[unitIdx] ?? -1;
            const atSegStart = segIdx >= 0 && setGroups[segIdx].start === unitStartIdx(u);
            // 标题行**先**落在外层（包装后插，标题就不会成包装的首子结点，
            // .wengu-set-head 的 first-child 间距口径逐字不变）
            if (showHeads && atSegStart) container.insertAdjacentHTML("beforeend", setHeadHtml(setGroups[segIdx], v.t));
            // 材料组单元的阅读面包装（计划值为 -1 即落外层）
            const ordinal = wrapPlan[unitIdx] ?? -1;
            const target = ordinal >= 0 ? wrapOf(ordinal) : container;
            mountDrillUnit(target, u, m, ctx, v, badMarks); // 组件根追加到目标容器尾（恢复/作答态随挂载就位）
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

/** 题集标题行（多集合刷正文分组）：短横 + 标题 + 题量。 */
function setHeadHtml(g: SetGroup, t: (key: string) => string): string {
    return `<div class="wengu-set-head" data-set="${esc(g.setId)}"><span class="wengu-set-head-line"></span>
<span class="wengu-set-head-title">${esc(g.title)}</span>
<span class="wengu-set-head-count">${esc(fmt(t("exerciseCount"), { n: String(g.count) }))}</span></div>`;
}

/** 视图级绑定：题号栏（头部 6-5 起组件化，此层只剩题号；题卡与
 *  材料组单元 6-4b 起组件自管——作答事件组件直调流程、组导航收进
 *  GroupUnitApp，无卡级 DOM 绑定）。题集分组随绑（横线分隔行）。 */
function bindQuizFor(v: QuizView): void {
    const setGroups = buildSetGroups(v.list, (id) => v.docs.find((d) => d.id === id)?.title || setFallbackTitle(id));
    bindNumRail(v.el, v.list, {
        onActive: (idx) => v.onActiveQ(idx),
        onFocus: (idx) => focusQuestion(v.el, idx),
        numsTitle: v.t("qnumsTitle"),
        showNums: v.settings?.showNums !== false,
        showPast: v.mode !== "preview" && v.settings?.showWrong !== false && v.revealMode === "instant",
        setGroups,
        // 揭示态图例（Issue #135 §2.9）：instant 判分即揭示；after 收卷才揭示
        // ——两条来路都要算：① 运行期（revealCard → markNumRailRevealed，
        // 收卷不重建壳）；② 壳重建时（收卷后切工作区/折叠侧栏都走 renderList），
        // 此时本轮已封卷（endedAt 已写）⇒ 初值直接给揭示档，否则图例会退回
        // 「作答中」而卡片早已揭示（两处口径不一致）。
        revealed: v.revealMode === "instant" || !!v.currentSession()?.endedAt,
        t: v.t,
    });
}

/** 侧栏/头部挂载入参适配（quiz/preview 主路径）：QuizView 已实现的
 *  箭头属性直接复用；sideAct 统一出口在 QuizView（侧栏/头部按钮）。 */
function sideQuizAccess(v: QuizView): import("../flow/SideMount").SideViewAccess {
    return {
        el: v.el,
        t: v.t,
        // 预览头部「批量重转标记的错题(N)」闸与徽标（Issue #46；非预览恒
        // false/0=不出钮）——视图访问器一处分派，此处只转发
        badMark: v.badMark,
        docsOf: () => v.docs,
        docIdOf: () => v.docId,
        sideCollapsedOf: () => v.sideCollapsed,
        sideFilterOf: () => v.sideFilter,
        sideTreeOpenOf: () => v.sideTreeOpen,
        colFlowOf: () => v.colFlow,
        convertingOf: () => v.convertingOf(),
        setSideFilter: (text) => v.setSideFilter(text),
        selectDoc: (id) => v.selectDoc(id),
        // 侧栏切换二次确认闸（#137 §7.d）：⚠️ 必须在这里接上——挂载点的
        // 两个出口回调已改为「先过闸再执行」，本字段缺席时
        // `guardOrRun` 走直切兜底（另两路仍然可用），但**生产主路径
        // 就永远不弹**（上一版即漏了这行，闸全程是死代码）。
        switchGuard: (entry) => v.switchGuardOf(entry),
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
