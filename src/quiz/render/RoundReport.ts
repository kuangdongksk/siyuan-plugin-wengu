import { attributeWrongCauses } from "../service/AiJudge";
import type { CauseItem } from "../service/AiJudge";
import { svgIcon } from "../../ui/FormHtml";
import type { WenguSession } from "../service/HistoryStore";
import type { TimerController } from "../service/TimerController";
import type { WenguQuestion } from "../../types";
import { baseQid } from "../../types";
import { esc } from "../../ui/shared";
import type { QuestionBank } from "../../bank/data/QuestionBank";
import type { WeakCause, WeakTopRow, WeaknessStore } from "../../bank/data/WeaknessStore";
import { openWeakDrill } from "../../bank/ui/WeakDrill";
import { roundAggByQid } from "../../bank/data/WeaknessStore";
import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";
import { notifyInfo } from "../../ui/Notify";
import RoundReportApp from "../components/RoundReportApp.svelte";

/**
 * 一轮完成后的总结报告（纯 CSS 条形图，不引图表库）：渲染在
 * components/RoundReportApp.svelte（Svelte 化 20260830），本文件保留
 * 模型与收卷编排（showRoundReportNow）+ AI 分析 prompt 构建 +
 * 错因沉淀；AI 通道走 ai 域客户端。
 */

export interface RoundReportModel {
    t: (key: string) => string;
    /** 本轮会话（已收卷或即将收卷的快照）。 */
    session: WenguSession;
    /** 本轮题目（含未答的，按顺序给图条标签）。 */
    list: WenguQuestion[];
    /** 该文档全部历史轮次（含本轮）。 */
    rounds: WenguSession[];
    /** 报告显示的用时（秒，通常 = 会话 elapsedSec 快照）。 */
    totalSec: number;
    /** 倒计时超时段（秒，非倒计时报 0）。 */
    overtimeSec: number;
    /** 薄弱沉淀 Top 行（WeaknessStore 同步快照，空=不渲染）。 */
    weakRows: WeakTopRow[];
}

/** 倒计时归零的选择条：「继续作答」（转超时正计时）或「结束本轮」。 */
export function showTimeUpChoice(
    slot: HTMLElement,
    t: (k: string) => string,
    handlers: { onOvertime: () => void; onFinish: () => void }
): void {
    slot.innerHTML = `<div class="wengu-timeup">
  <span>${svgIcon("iconClock")} ${esc(t("timeUpShort"))}</span>
  <button class="b3-button b3-button--outline" data-act="overtime">${esc(t("continueAnswer"))}</button>
  <button class="b3-button b3-button--cancel" data-act="finish-round">${esc(t("finishRound"))}</button>
</div>`;
    const clear = () => (slot.innerHTML = "");
    slot.querySelector("[data-act='overtime']")?.addEventListener("click", () => {
        clear();
        handlers.onOvertime();
    });
    slot.querySelector("[data-act='finish-round']")?.addEventListener("click", () => {
        clear();
        handlers.onFinish();
    });
}

/** 收卷/报告编排所需的视图能力（QuizView 提供薄实现）。 */
export interface RoundFinishCtx {
    el: HTMLElement;
    t: (k: string) => string;
    list: WenguQuestion[];
    rounds: WenguSession[];
    session?: WenguSession;
    finished?: WenguSession;
    timer: TimerController;
    revealMode: "instant" | "after";
    /** AI 报告使用的模型 id（空=智能体默认）。 */
    aiModelId: string;
    /** 薄弱画像（有则收卷计数 + 异步补错因 + 报告展示）。 */
    weakness?: WeaknessStore;
    /** 题库（针对性加练入库）。 */
    bank?: QuestionBank;
    /** 专题清单变化后刷新侧栏。 */
    refreshCollections?(): void;
    /** 收卷：落库、置 finished、清 session（视图实现）。 */
    finishSession(): void;
    /** after 模式手动收卷时揭示已答部分。 */
    revealAnswered(): void;
    /** 停走秒并刷新头部标签。 */
    stopRound(): void;
    /** 锁定全部作答位。 */
    lockAllCards(): void;
}

function roundsWithCurrent(rounds: WenguSession[], cur?: WenguSession): WenguSession[] {
    return cur && !rounds.some((x) => x.id === cur.id) ? [...rounds, cur] : rounds;
}

/* ── 收卷总结视图（Issue #147 追加 1/2/3） ──

   形态：**收卷出总结 = 题卷收起、总结独占**（原先是报告插在卷首、45 题
   长卷报告与全部题卡同屏，真机截图实证）。实现走**主区状态类**而不是
   收题卷容器——题卡是 Svelte 挂载物（unmount 再 mount 会丢 Protyle 锚与
   在途分片），藏起来不动它的 DOM 最稳；类摘掉即逐字节回原状。

   类挂在**主区 `.wengu-main`** 上：壳每轮由 renderMainShell 重建，类
   不会跨轮残留（报告挂载点 [data-report] 与题卡 [data-timeup-slot] 是
   它的一级子元素，CSS 全用子选择器、不外溢到题卡内部）。

   追加 2（`focusFinishedRound`）：「结束本次」在报告已出态再点 = **总结视图
   开关**——开着就收起回题卷，已在题卷就重开总结并滚回顶部 + 高亮。原实现
   是 detach + 重挂同一份报告（视觉零变化 ⇒ 用户观感「点了没反应」），
   本单改为真实可见的形态切换；头部按钮随态换语义、**不禁用**（项目原则
   「停止键别 disabled」）。
   追加 3：报告区自身是滚动窗（题卷态不可滚），高度按内容自适应。 */

let reportApp: MountedSvelteApp | undefined;

/** 主区是否处于「总结独占」态（题卷收起）。 */
export function isSummaryView(el: HTMLElement): boolean {
    return !!el.querySelector<HTMLElement>(".wengu-main")?.classList.contains("wengu-summary-view");
}

/** 报告宿主的显隐（`hidden` 属性是**唯一判据**，CardHtml 初值即 hidden）。
 *  ⚠️ 必须与总结视图类**成对**操作，缺一都不成立：
 *  - 只摘类不设回 hidden ⇒「返回题卷」后报告卡仍压在卷首（题卷上方挂着
 *    一份总结，观感上并没真收起，追加 2 的「收起总结」也就没有落点）；
 *  - 只设 hidden 不摘类 ⇒ CSS 里 `.wengu-main.… [data-report] { display:flex }`
 *    的特异性压过 UA 的 `[hidden] { display:none }`，报告照显（隐藏失效）。 */
function showReportHost(el: HTMLElement, visible: boolean): void {
    const host = el.querySelector<HTMLElement>("[data-report]");
    if (!host) return;
    if (visible) host.removeAttribute("hidden");
    else host.setAttribute("hidden", "");
}

/** 出总结：题卷收起、总结独占（收卷链尾调一次）。 */
export function enterSummaryView(el: HTMLElement): void {
    el.querySelector<HTMLElement>(".wengu-main")?.classList.add("wengu-summary-view");
    showReportHost(el, true);
}

/** 收起总结、回到题卷（追加 1 的「返回题卷」与追加 2 的已出态点击共用）：
 *  摘类**并收起报告宿主**——题卷态下报告不该再占卷首（否则「收起了总结」
 *  只是题卷又冒了出来，报告卡还在上面挂着，「查看总结 / 返回题卷」这一对
 *  语义就永远对不上）。宿主不卸载：重进只需再摘一次 hidden，报告整挂整卸
 *  的代价（AI 输出区、滚动位置）得以保留。 */
export function exitSummaryView(el: HTMLElement): void {
    el.querySelector<HTMLElement>(".wengu-main")?.classList.remove("wengu-summary-view");
    showReportHost(el, false);
}

/** 报告滚动窗的选择器（**全仓唯一取用点**，Issue #147 回归）：
 *  窗口是组件 `RoundReportApp.svelte` 渲染的那个 `[data-report-scroll]`。
 *  ⚠️ 别再在挂载前用 `host.innerHTML` 放一个**同标记的桩**——那会在宿主
 *  里多出一个空节点：总结态两个 `.wengu-report-scroll` 都吃 `flex:1`
 *  ⇒ 面板被劈成「一半空白 + 一半报告」，且 `querySelector` 命中的是
 *  排在前面的空桩（`scrollTop` 恒 0）⇒「滚回总结顶部」静默失效。
 *  标记由组件自己渲染，查询经本常量走（见 `RoundReport.view.test` 的闸）。 */
const REPORT_SCROLL_SEL = "[data-report] [data-report-scroll]";

/** 报告区是否已滚离顶部（成员方法，不在本文件做类型收窄——TS 认
 *  `Element.scrollTop`；jsdom/内核都给该字段，缺省按 0 兜底）。 */
export function reportScrolled(el: HTMLElement): boolean {
    const scroller = el.querySelector<HTMLElement>(REPORT_SCROLL_SEL);
    const node: { scrollTop?: unknown } | null = scroller;
    const top = node?.scrollTop;
    return typeof top === "number" ? top > 4 : false;
}

/** 报告区滚回顶部（叠加一次高亮脉冲，见 scss/report.scss）。 */
export function scrollReportTop(el: HTMLElement): void {
    el.querySelector<HTMLElement>(REPORT_SCROLL_SEL)?.scrollTo({ top: 0 });
    pulseReport(el);
}

/** 给报告块叠一次高亮脉冲（animationend 自摘；连点重启动画，幂等）。 */
export function pulseReport(el: HTMLElement): void {
    const report = el.querySelector<HTMLElement>("[data-report] .wengu-report");
    if (!report) return;
    report.classList.add("wengu-report-pulse");
    report.addEventListener("animationend", () => report.classList.remove("wengu-report-pulse"), { once: true });
}

/** 总结态变更的旁路通知（挂载方在上面重挂头部，让按钮随态换语义）。
 *  头部是 Svelte 组件、不随总结态自更新，而组件接口是 props 驱动的
 *  （本仓无全局 store 约定，且重挂是既有刷新手段——见 SideMount 头注），
 *  故挂载方在 toggle 时收一次「请重画头部」的信号即可。 */
let onSummaryToggle: (() => void) | undefined;

/** 挂载方注册总结态变更回调（QuizShell 挂头部时注册，返回时注销）。 */
export function bindSummaryToggle(fn: (() => void) | undefined): void {
    onSummaryToggle = fn;
}

/** 「结束本次」在**报告已出态**的响应（追加 2）：**总结视图开关**——
 *  总结开着 ⇒ 收起回题卷；已在题卷 ⇒ 重开总结并滚回顶部（叠一次高亮）。
 *
 *  ⚠️ 原实现是 detach + 重挂同一份报告：**视觉零变化** ⇒ 用户观感
 *  「点了没反应」（真机实证）。故正常路径**只切视图态、不重挂**。
 *  **唯一例外＝报告节点已不在**（整壳重建设 `detachRoundReport`，而
 *  `finished` 仍留着）：此时不补挂就是「收起题卷 + 空宿主」＝整片空白，
 *  比零变化更糟，故按报告模型补挂一次（{@link mountReportNode}，不走
 *  收卷链，不重复落库/停表/AI 归因）。 */
export function focusFinishedRound(ctx: RoundFinishCtx): void {
    if (!ctx.finished) return;
    // 收起支走 backToQuiz（摘类 + 通知重画头部）——与报告内那颗钮同一条路
    if (isSummaryView(ctx.el)) backToQuiz(ctx);
    else {
        // 报告节点已不在（整壳重建）⇒ 先补挂再切态（见上注：不补就是空白）
        if (!ctx.el.querySelector<HTMLElement>("[data-report] .wengu-report")) {
            const host = ctx.el.querySelector<HTMLElement>("[data-report]");
            if (!host) return;
            mountReportNode(ctx, ctx.finished, host);
        }
        enterSummaryView(ctx.el);
        // 已在顶部就不白跳一次（脉冲仍给：它才是「我响应了」的可见反馈，
        // 光靠「总结又出现了」在快速连点下不易分辨）
        if (reportScrolled(ctx.el)) scrollReportTop(ctx.el);
        else pulseReport(ctx.el);
        onSummaryToggle?.(); // 头部按钮随态换语义（返回题卷 / 查看总结）
    }
}

/** 收起总结 + 通知挂载方重画头部（**唯一**的「回题卷」执行体）：
 *  「返回题卷」有两个入口——报告内那个钮（本文件挂载时传的 `onBackToQuiz`）
 *  与头部那颗钮在总结态下的语义（`focusFinishedRound` 的收起支）。两者
 *  **必须同一条路**：少一次 `onSummaryToggle` 头部文案就留在「返回题卷」
 *  不改（总结已收起、钮却还在喊「返回题卷」= 文案说谎，再点下去又是重开
 *  总结，与字面相反）。
 *
 *  ⚠️ 别在 `onBackToQuiz` 里直调 `exitSummaryView`：那只摘类、不通知。 */
export function backToQuiz(ctx: RoundFinishCtx): void {
    exitSummaryView(ctx.el);
    onSummaryToggle?.();
}

/** 卸载轮次报告（renderQuizShellFor 整壳重建前与 QuizView.destroy 兜底）。 */
export function detachRoundReport(): void {
    reportApp?.unmount();
    reportApp = undefined;
}

/** 把报告**挂进宿主**（唯一挂载点，收卷链与「补挂」两路共用）。
 *  model 可外部传入（收卷时用**停表前**取的用时快照）；不给则按当前
 *  计时器现算（补挂路径：表已停，elapsed() 即终值）。 */
function mountReportNode(ctx: RoundFinishCtx, s: WenguSession, host: HTMLElement, model?: RoundReportModel): void {
    detachRoundReport();
    // ⚠️ 别在这里放 `[data-report-scroll]` 空桩：Svelte mount 无 anchor 时
    // append 到 host **末尾**，组件自己渲染的滚动窗会与桩**并列**，而
    // reportScrolled/scrollReportTop 的 querySelector 只命中第一个（桩）
    // ⇒ scrollTop 恒 0、「重开总结滚回顶部」静默失效。钩子属性跟着组件
    // 渲染的那个窗走（RoundReportApp.svelte），这里只清宿主。
    host.textContent = ""; // 挂载前清残留（detach 已卸组件，此为兜底）
    // 显隐交给 enterSummaryView 统一切（单一权威，别在这儿各做一份）
    reportApp = mountSvelteApp(RoundReportApp, host, {
        model: model ?? reportModelOf(ctx, s),
        modelId: ctx.aiModelId,
        onBackToQuiz: () => backToQuiz(ctx),
        onWeakDrill: (rows: WeakTopRow[]) => {
            if (ctx.weakness && ctx.bank)
                openWeakDrill(
                    {
                        t: ctx.t,
                        bank: ctx.bank,
                        weakness: ctx.weakness,
                        modelId: ctx.aiModelId,
                        onDone: () => ctx.refreshCollections?.(),
                    },
                    rows
                );
        },
    });
}

/** 收卷/补挂共用的报告模型（用时取**当时**计时器值）。 */
function reportModelOf(ctx: RoundFinishCtx, s: WenguSession): RoundReportModel {
    return {
        t: ctx.t,
        session: s,
        list: ctx.list,
        rounds: roundsWithCurrent(ctx.rounds, s),
        totalSec: ctx.timer.elapsed(),
        overtimeSec: ctx.timer.inOvertime ? ctx.timer.overtimeSec : 0,
        weakRows: ctx.weakness?.topSync(8) ?? [],
    };
}

/** 一轮完成：收卷 + 挂载总结报告（总用时/用时图/得分图 + AI 分析入口）。 */
export function showRoundReportNow(ctx: RoundFinishCtx): void {
    const s = ctx.session ?? ctx.finished;
    const host = ctx.el.querySelector<HTMLElement>("[data-report]");
    if (!s || !host) return;
    // ⚠️ 模型（含用时快照）必须在**停表前**取：finishSession/stopRound 之后
    // 计时器已终结，再算就偏差（补挂路径无此问题——那时表本就是停的）
    const model = reportModelOf(ctx, s);
    ctx.finishSession();
    ctx.stopRound();
    mountReportNode(ctx, s, host, model);
    /* 报告宿主在卷首（头部之下，renderMainShell）：收卷即见，不再依赖
       scrollIntoView——题卡 content-visibility 折叠屏外高度，smooth/
       nearest 常误判「已在视口」一步不滚（20260901 走查实锤）。
       追加 1（Issue #147）：收卷即**收起题卷**，总结独占主区——报告
       独占后「长卷报告埋在文档尾」的滚动问题一并消失。 */
    enterSummaryView(ctx.el);
    onSummaryToggle?.(); // 头部按钮随态换语义（收卷即刻变「返回题卷」）
    if (ctx.weakness) void settleWeakness(ctx.weakness, s, ctx.list, ctx.aiModelId);
}

/** 收卷后异步沉淀错因：brief 判分自带的先入账，客观/steps 错题打包
 *  一次 AI 归因（≤12 题、≤4000 字），任何失败静默降级（计数已在）。 */
async function settleWeakness(
    store: WeaknessStore,
    s: WenguSession,
    list: WenguQuestion[],
    modelId: string
): Promise<void> {
    try {
        const agg = roundAggByQid(s);
        const causes = new Map<string, WeakCause>();
        const notes = new Map<string, string>();
        const mineByQid = new Map<string, string>();
        for (const r of s.results) {
            const b = baseQid(r.qid);
            mineByQid.set(b, r.submitted);
            if (!r.ok && r.cause) causes.set(b, r.cause as WeakCause);
            if (!r.ok && r.comment) notes.set(b, r.comment);
        }
        const items: CauseItem[] = [];
        let chars = 0;
        for (const q of list) {
            if (agg.get(q.id) !== false || causes.has(q.id) || items.length >= 12) continue;
            const stem = (q.stemMd ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
            if (!stem) continue;
            chars += stem.length;
            if (chars > 4000) break;
            items.push({ qid: q.id, stem, mine: mineByQid.get(q.id) ?? "", answer: q.answer ?? "" });
        }
        if (items.length > 0) {
            for (const [qid, cause] of await attributeWrongCauses(items, modelId)) causes.set(qid, cause);
        }
        await store.applyCauses(s, list, causes, notes);
    } catch (_) {
        // 归因失败不影响报告（计数已本地落）
    }
}

/** 空轮不收卷（收卷**唯一**判定，见 {@link finishRoundGuarded}）：已回答数。 */
export function emptyRound(s: WenguSession | undefined): boolean {
    return !!s && s.answered <= 0;
}

/** 收卷**唯一**出口（Issue #147）：任一路径收卷都过这道空轮闸——
 *  头部「结束本次」与倒计时归零时间条「结束本轮」原是两个入口各写一份
 *  判定，后者（`finishNow`）漏写 ⇒ 开倒计时的用户时间到点「结束本轮」，
 *  一题没答也收卷出报告。
 *
 *  **不许绕过**：收卷动作只有 `endRound` / `finishNow` 两路，两路都调它；
 *  新增收卷入口前先读这条（`RoundReport.contract.test` 锁死本函数是
 *  全仓唯一定义点、且两路都走它）。
 *
 *  非空轮无副作用——「答满自动收卷」`roundComplete` 是另一条链（answered
 *  必然 >0），故不并入本闸。 */
export function finishRoundGuarded(ctx: RoundFinishCtx): void {
    if (emptyRound(ctx.session)) {
        notifyInfo({ key: "endRoundEmpty" });
        return;
    }
    manualFinishRound(ctx);
}

/** 手动收卷（倒计时归零选「结束本轮」）：after 模式先揭示已答，再报告。 */
export function manualFinishRound(ctx: RoundFinishCtx): void {
    if (!ctx.session) return;
    if (ctx.revealMode === "after") ctx.revealAnswered();
    else showRoundReportNow(ctx);
    ctx.lockAllCards();
}

/** 视图侧能力（QuizView 用箭头属性实现，与 AnswerHost 同风格）。 */
export interface RoundFinishView {
    container(): HTMLElement;
    t(key: string): string;
    questions(): WenguQuestion[];
    allRounds(): WenguSession[];
    currentSession(): WenguSession | undefined;
    finishedSession(): WenguSession | undefined;
    timerController(): TimerController;
    currentRevealMode(): "instant" | "after";
    aiModelId(): string;
    weaknessStore(): WeaknessStore | undefined;
    bankStore(): QuestionBank | undefined;
    refreshCollections(): void;
    finishSession(): void;
    revealAnsweredNow(): void;
    stopRoundNow(): void;
    lockAllCardsNow(): void;
}

/** 由视图组装 RoundFinishCtx。 */
export function roundFinishCtx(view: RoundFinishView): RoundFinishCtx {
    return {
        el: view.container(),
        t: view.t,
        list: view.questions(),
        rounds: view.allRounds(),
        session: view.currentSession(),
        finished: view.finishedSession(),
        timer: view.timerController(),
        revealMode: view.currentRevealMode(),
        aiModelId: view.aiModelId(),
        weakness: view.weaknessStore(),
        bank: view.bankStore(),
        refreshCollections: () => view.refreshCollections(),
        finishSession: () => view.finishSession(),
        revealAnswered: () => view.revealAnsweredNow(),
        stopRound: () => view.stopRoundNow(),
        lockAllCards: () => view.lockAllCardsNow(),
    };
}

/** 锁定全部卡片的作答位（收卷用）。 */
export function lockAllCards(el: HTMLElement): void {
    el.querySelectorAll<HTMLElement>(".wengu-card").forEach((c) => {
        c.querySelectorAll("input, textarea, button").forEach((n) => {
            (n as HTMLButtonElement).disabled = true;
        });
    });
}
