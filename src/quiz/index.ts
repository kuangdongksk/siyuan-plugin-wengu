import { errText } from "./../ui/shared";
import type { App } from "siyuan";
import type { AnswerHost } from "./flow/AnswerFlow";
import { revealAll } from "./flow/AnswerFlow";
import { notifyQuizAnswer, notifyRoundDone } from "../companion";
import { filterReviewDocFor } from "../review";
import { collectThoughts, lockAllCards as lockAllCardsState } from "./render/CardRegistry";
import { reimportDocFrom, unregisterSetAsQuiz } from "./service/DocOps";
import { badMarkAccess } from "./service/BadMarkRegen";
import { resetPreviewSearch } from "./flow/PreviewFlow";
import { enterPreviewFor, enterReviewFor } from "./flow/ModeOps";
import { normalizeWorkspace, type WenguWorkspace } from "./render/RailMount";
import { buildSideTree } from "./render/SideTree";
import { openConvertForView } from "../convert";
import { ConvertAccess, type ConvertAccessHost } from "../convert/service/run/ConvertAccess";
import { reconcileKnowledgeRefs } from "../bank/data/BankReconcile";
import { notifyError, notifyInfo } from "../ui/Notify";
import { mirrorAnswer, mirrorOverride, mirrorRepeatAnswer, mirrorResult } from "./service/AnswerMirror";
import type { BankMirrorDetail } from "./service/AnswerMirror";
import { genTagsAction, variantDrillAction, type DocActionCtx } from "./service/DocActions";
import { teardownView } from "./flow/Teardown";
import { AnnoScopeCtl } from "./service/AnnoScopeCtl";
import { CollectionFlow, colLoadContext } from "../bank";
import type { HistoryStore, WenguSession } from "./service/HistoryStore";
import { pushSessionAnswer } from "./service/HistoryStore";
import { hideBar as hideAnnoBar, type AnnoCallbacks } from "./flow/AnnoFlow";
import { anchorsOf, refreshClueMarkFor, refreshClueRow } from "./flow/ClueFlow";
import type { ClueAnchor } from "./service/MaterialDecorate";
import type { DrillUnit } from "./render/DrillUnits";
import { ProgressivePreview } from "./service/ProgressivePreview";
import { ProtyleHost } from "./service/ProtyleHost";
import { renderListFor } from "./render/QuizShell";
import type { QuestionBank } from "../bank/data/QuestionBank";
import type { WenguPrefsIo } from "./service/QuizLoader";
import { loadPrefs, loadQuizState, savePrefs } from "./service/QuizLoader";
import { lockAllCards, manualFinishRound, roundFinishCtx, showRoundReportNow } from "./render/RoundReport";
import type { WeaknessStore } from "../bank/data/WeaknessStore";
import type { WenguSettingsShape as SettingsDialogShape } from "../ui/SettingsDialog";
import { beginDrillFor, startPanelModelFor } from "./render/StartPanel";
import { openStatsPanelFor } from "../stats";
import { TimerBinder, timerHostFor } from "./service/TimerBinder";
import { bindViewFrameFor } from "./flow/ViewBindings";
import { sideActFor } from "./flow/SideMount";
import { relatedAccessFor } from "./flow/RelatedAccess";
import type { RelatedViewAccess } from "../bank/ui/RelatedDialog";
import { TimerController } from "./service/TimerController";
import type { WenguDoc, WenguMaterial, WenguQuestion, WenguRevealMode } from "../types";

/** 温故刷题页签视图（编排层），各模块见 docs/design-review.md。 */
export class QuizView implements AnswerHost, ConvertAccessHost {
    /** i18n 取值（public：AnswerHost 接口按结构匹配）。 */
    readonly t: (key: string) => string;
    /** 视图根元素（public：ClueHost 结构匹配）。 */
    readonly el: HTMLElement;
    private readonly app?: App;
    private readonly storage?: { load: () => Promise<unknown>; save: (v: WenguPrefsIo) => Promise<unknown> };
    readonly settings?: SettingsDialogShape;
    private readonly history?: HistoryStore;
    private readonly weakness?: WeaknessStore;
    private readonly bank?: QuestionBank;
    readonly openSettings?: () => void;
    readonly colFlow: CollectionFlow;
    private readonly timer = new TimerController(() => this.timerBinder.updateLabel());
    readonly timerBinder: TimerBinder;
    /** 统计面板下钻意图：load 完成后重开面板并直落该 tab。 */
    private reopenStatsTab?: "overview" | "doc";
    readonly protyleHost: ProtyleHost;
    readonly progressive = new ProgressivePreview();
    docId: string;
    private activeDocId: string;
    docs: WenguDoc[] = [];
    sideCollapsed = false;
    sideFilter = "";
    /** 侧栏树展开的路径集合（S2：默认第一层，prefs 持久化）。 */
    sideTreeOpen: string[] = [];
    private pendingDoc: { id: string; title: string } | undefined;
    list: WenguQuestion[] = [];
    private fullList: WenguQuestion[] = [];
    materials: WenguMaterial[] = [];
    /** 渲染单元（独立题/材料组），renderList 时由 buildDrillUnits 组装。 */
    units: DrillUnit[] = [];
    /** M6 多模式开口：做题（现有）/复习/预览/学习预留，主区渲染按它路由。 */
    mode: "quiz" | "review" | "study" | "preview" = "quiz";
    /** 左栏工作区（rail 维度）：刷题=现有界面，其余四个是管理面板。 */
    workspace: WenguWorkspace = "drill";
    /** 标注层解绑与背单词存储（生词→复习队列，index.ts 注入共享单例）。 */
    private annoCleanup?: () => void;
    private wordStore?: AnnoCallbacks["wordStore"];
    /** 卷级英语判定（Issue #45 标生词闸；实现与缓存见 service/AnnoScopeCtl）。 */
    private readonly annoScope: AnnoScopeCtl;
    loading = false;
    loadError = "";
    private docTotalSec = 0;
    revealMode: WenguRevealMode = "instant";
    private activeQIdx = 0;
    started = false;
    /** 转换弹窗状态与收尾（ConvertViewAccess 实现体，拆出压行数）。
     *  public：DocOps「重新导入」直接经它取上次设置/清续跑记录/启动运行。 */
    readonly convertAccess: ConvertAccess;
    /** 复习模式「重刷本文档」的待开轮范围（load 完成后消费并清空）。 */
    private pendingDrillScope?: import("./service/HistoryStore").WenguRoundScope;
    private session?: WenguSession;
    /** 收卷后的会话快照（总结报告/揭示仍要读它）。 */
    private finished?: WenguSession;
    rounds: WenguSession[] = [];
    /** 本轮静态分片挂载任务（revealAnsweredNow 手动收卷揭示等它）。 */
    renderTask: Promise<void> | undefined;

    constructor(
        element: HTMLElement,
        i18n: Record<string, string>,
        docId = "",
        app?: App,
        storage?: {
            load: () => Promise<unknown>;
            save: (v: WenguPrefsIo) => Promise<unknown>;
        },
        settings?: SettingsDialogShape,
        history?: HistoryStore,
        weakness?: WeaknessStore,
        bank?: QuestionBank,
        openSettings?: () => void,
        wordStore?: AnnoCallbacks["wordStore"]
    ) {
        this.el = element;
        this.t = (key) => i18n[key] || key;
        this.docId = docId;
        this.activeDocId = docId;
        this.app = app;
        this.storage = storage;
        this.settings = settings;
        this.history = history;
        this.weakness = weakness;
        this.bank = bank;
        this.openSettings = openSettings;
        this.wordStore = wordStore;
        this.protyleHost = new ProtyleHost();
        this.annoScope = new AnnoScopeCtl(this);
        this.convertAccess = new ConvertAccess(this);
        this.timerBinder = new TimerBinder(timerHostFor(this));
        this.colFlow = new CollectionFlow({
            t: this.t,
            container: this.container,
            bank: () => this.bank,
            docs: () => this.docs,
            docId: () => this.docId,
            sideFilter: () => this.sideFilter,
            sideTreeOpen: () => this.sideTreeOpen,
            modelId: () => this.aiModelId(),
            settleTimer: () => void this.timerBinder.flush(),
            reloadFromCollection: () => this.reloadDocs(""),
        });
        // 一次性事件委托（重渲染不重复绑定，实现体 ViewBindings）：
        // 块引用跳转/题卡「重新生成」+ 标注层（线索/生词）+ AI 复核线索
        this.annoCleanup = bindViewFrameFor(this, this.bank, wordStore, () => void this.load());
    }

    readonly container = (): HTMLElement => this.el;
    readonly questions = (): WenguQuestion[] => this.list;
    readonly currentRevealMode = (): WenguRevealMode => this.revealMode;
    readonly timerController = (): TimerController => this.timer;
    readonly currentSession = (): WenguSession | undefined => this.session ?? this.finished;
    readonly roundComplete = (): void => {
        notifyRoundDone(this);
        showRoundReportNow(roundFinishCtx(this));
    };
    readonly flushTime = (): void => void this.timerBinder.flush();
    /** ClueHost 结构匹配：当前题/材料定位/会话落库（线索标注用）。 */
    readonly currentQuestion = (): WenguQuestion | undefined => this.list[this.activeQIdx];
    readonly materialOf = (q: WenguQuestion): WenguMaterial | undefined => this.materials.find((m) => m.id === q.group);
    readonly questionById = (qid: string): WenguQuestion | undefined => this.list.find((q) => q.id === qid);
    /** AnswerHost（#28 高亮后处理 / #52 坐标供给）实现收口在 ClueFlow。 */
    readonly refreshClueMarks = (q: WenguQuestion): void => refreshClueMarkFor(this, q);
    readonly clueAnchors = (q: WenguQuestion): ClueAnchor[] => anchorsOf(this.currentSession(), q.id);
    readonly persist = (): void => {
        const s = this.session ?? this.finished;
        if (s) void this.history?.upsert(s);
    };
    readonly recordAnswer = (
        qid: string,
        submitted: string,
        ok: boolean,
        extra?: { verdict?: "right" | "partial" | "wrong"; comment?: string; cause?: string }
    ): void => {
        const s = this.session;
        if (!s) return;
        const former = s.results.some((r) => r.qid === qid); // upsert 前先看是否重复提交
        const sec = this.timer.takeQuestionSec(qid);
        pushSessionAnswer(s, qid, submitted, ok, sec, this.timer.elapsed(), extra);
        void this.history?.upsert(s);
        // 题库统计镜像（薄壳在 service/AnswerMirror）：首答常规记账，重复提交
        // （after 改答案）只覆写 lastAnswer/right 不动 attempts（Issue #12 B2）；
        // qid#k 的逐空/逐步刻意跳过，整题由 bankMirror 补记
        if (!qid.includes("#")) {
            // 守空在 AnswerMirror 内部统一做（与另两个镜像入口同口径）
            if (former) mirrorRepeatAnswer(this.bank, qid, submitted, ok);
            else mirrorAnswer(this.bank, qid, submitted, ok);
        }
        notifyQuizAnswer(this, qid, submitted, ok, sec); // 看板娘事件（含错题讲解上下文）
    };

    /** after 模式答满（未收卷）：一次性提示「可检查修改，结束后统一判卷」
     *  （Issue #12 B3；去重标记由 renderList 复位）。详见 renderList 注。 */
    private allAnsweredNotified = false;
    readonly onAllAnswered = (): void => {
        if (this.allAnsweredNotified) return;
        this.allAnsweredNotified = true;
        notifyInfo({ key: "allAnsweredPending" });
    };

    /** 整题收口镜像（steps/slots 用）：题库按整题记一次——逐 #k 的
     *  recordAnswer 刻意跳过题库，整题结果在此补（契约「调用方剥后缀」，
     *  20260828 审查：原整题从不进镜像，专题错题重刷对这类题失效）。
     *  detail 携带细粒度（自托管后题库是运行时统计唯一落点）。 */
    readonly bankMirror = (qid: string, submitted: string, ok: boolean, detail?: BankMirrorDetail): void =>
        mirrorResult(this.bank, qid, submitted, ok, detail);

    /** 改判镜像（brief 纠错/steps 申诉复核）：只翻 right 微调 wrongCount。 */
    readonly bankOverride = (
        qid: string,
        correct: boolean,
        detail?: { kind: "steps"; letters: string[]; oks: boolean[] }
    ): void => mirrorOverride(this.bank, qid, correct, detail);

    /** 设置页开关变更后由插件调用：立即按新设置重渲染。 */
    applySettings(): void {
        this.renderList();
    }

    /** 顶栏再次点击且页签已打开时：活动文档是习题文档才切换选中。 */
    setDoc(docId: string): void {
        if (!docId) return;
        this.activeDocId = docId;
        this.selectDoc(docId);
    }

    render(): void {
        void this.load();
        this.timerBinder.start();
    }

    destroy(): void {
        this.timerBinder.stop();
        this.progressive.clear();
        this.finishSession();
        void this.timerBinder.flush();
        this.annoCleanup?.();
        void this.bank?.flush();
        this.protyleHost.destroyAll(this.el);
        teardownView(); // 模块级挂载物统一反挂（清单在 flow/Teardown）
    }

    /** 当前题切换（题号导航/组内导航共用）：同步下标、逐题计时、线索行。 */
    onActiveQ(idx: number): void {
        this.activeQIdx = idx;
        this.timer.setQuestion(this.list[idx]?.id ?? "");
        refreshClueRow(this);
    }

    selectDoc(docId: string): void {
        if (!docId || docId === this.docId) return;
        // 复习模式点侧栏文档 = 筛选错题本到该文档（不切做题上下文）
        if (this.mode === "review") {
            filterReviewDocFor(docId);
            this.renderList();
            return;
        }
        this.colFlow.reset(); // 点文档=离开题库模式
        this.reloadDocs(docId);
    }

    /** 切换上下文的公共收尾：结算计时、记 prefs、重载。 */
    private reloadDocs(docId: string): void {
        void this.timerBinder.flush();
        if (this.mode === "preview") resetPreviewSearch(); // 换卷不带走旧搜题词
        this.docId = docId;
        this.persistPrefs();
        void this.load();
    }

    /** 模式切换统一入口（头部切换器已删 2026-08-26）：开刷面板三按钮/
     *  右键错题复习/预览工具行「退出预览」都汇到这里；切回做题恢复已答锁定。 */
    readonly switchMode = (mode: "quiz" | "review" | "preview"): void => {
        if (this.mode === mode) return;
        if (this.mode === "preview") resetPreviewSearch(); // 搜题词是模块级，离开预览清零防下卷误过滤
        hideAnnoBar(); // Issue #45：切模式立即收条（判定是拉取式的，无事件重判）
        this.mode = mode;
        this.invalidateAnnoScope();
        this.renderList(); // 落幕统一恢复已答锁定（见 renderList 尾注）
    };

    /** 预览模式入口：开刷面板「预览」按钮（只读浏览，不作答不计轮次）。 */
    readonly enterPreviewMode = (): void => enterPreviewFor(this);

    /** 复习模式统一入口：右键文档预筛 / 统计 qid 定位 / 直入（统计面板先关）。 */
    readonly enterReviewMode = (opt: { docId?: string; qid?: string; qids?: string[] }): void =>
        enterReviewFor(this, opt);

    /** 左栏工作区切换（刷题/学伴/专题/知识文档）；prefs 记住上次。 */
    readonly switchWorkspace = (ws: WenguWorkspace): void => {
        if (this.workspace === ws) return;
        this.workspace = ws;
        this.persistPrefs();
        this.renderList();
    };

    /** 「结束本次做题」：批改已答部分并出本轮报告（大卷分次刷；下次「继续上次」接着做）。
     *  空轮不收卷但给通知（原静默返回像「点了没反应」）；报告已出的
     *  残留按钮再点=重展报告（头部组件不随 started 重挂，收卷后按钮
     *  仍在，原二次点击静默成死钮——20260901 走查实锤）。 */
    readonly endRound = (): void => {
        if (this.session) {
            if (this.session.answered <= 0) {
                notifyInfo({ key: "endRoundEmpty" });
                return;
            }
            manualFinishRound(roundFinishCtx(this));
            return;
        }
        if (this.finished) showRoundReportNow(roundFinishCtx(this));
    };

    /** 复习模式组头「重刷本文档」：切做题 + scope=wrongAll 直落开轮。 */
    readonly startReviewDrill = (docId: string): void => {
        this.switchMode("quiz");
        if (docId === this.docId) beginDrillFor(this, { scope: "wrongAll" });
        else void ((this.pendingDrillScope = "wrongAll"), this.selectDoc(docId));
    };

    /** 目录文档右键「重新导入」：实现见 DocOps（删旧题集+源讲义重转替换）。 */
    readonly reimportDocOf = (docId: string): void => reimportDocFrom(this, docId);

    /** 目录题集右键「删除此题集」：实现见 DocOps（清题库记录/题集/材料+联动清理）。 */
    readonly removeSetOf = (docId: string): void => unregisterSetAsQuiz(this, docId);

    persistPrefs(): void {
        savePrefs(this.storage, {
            docId: this.docId,
            colId: this.colFlow.id(),
            sideCollapsed: this.sideCollapsed,
            sideTreeOpen: this.sideTreeOpen,
            workspace: this.workspace,
            ...this.convertAccess.prefsSnapshot(),
        });
    }

    /** 目录文档右键的弹窗类动作（实现体在 service/DocActions，压行数外移）。 */
    private readonly docActionCtx: DocActionCtx = {
        docs: () => this.docs,
        bank: () => this.bank,
        modelId: () => this.aiModelId(),
        colFlow: () => this.colFlow,
    };
    readonly variantDrillOf = (docId: string): void => variantDrillAction(this.docActionCtx, docId, this.t);
    readonly genTagsOf = (docId: string): void => genTagsAction(this.docActionCtx, docId, this.t);

    finishSession(): void {
        const s = this.session;
        if (!s) return;
        this.session = undefined;
        s.endedAt = Date.now();
        s.elapsedSec = Math.max(s.elapsedSec, this.timer.elapsed());
        s.thoughts = collectThoughts(); // 思路随卷快照（未作答的题也保得住；6-4b 走题卡登记表）
        this.finished = s;
        void this.history?.upsert(s);
    }

    private async load(): Promise<void> {
        this.finishSession(); // 切文档/刷新/重开都视为上一轮结束
        this.invalidateAnnoScope(); // Issue #45：换卷旧判定作废（题表即将重建）
        this.loading = true;
        this.loadError = "";
        this.renderList();
        const prefs = await loadPrefs(this.storage);
        // 存储读异常（20260829 起吞错改上抛）落到 loadError 而非无提示挂起
        try {
            await this.weakness?.preload();
            await this.bank?.preload();
        } catch (e) {
            this.loading = false;
            this.loadError = errText(e);
            this.renderList();
            return;
        }
        if (prefs.colId && !this.colFlow.isActive()) await this.colFlow.restore(prefs.colId); // 重开恢复专题模式
        const colQuestions = await this.colFlow.questions();
        const r = await loadQuizState({
            prefs,
            settings: this.settings,
            timer: this.timer,
            history: this.history,
            bank: this.bank,
            docId: this.docId,
            activeDocId: this.activeDocId,
            pendingDoc: this.pendingDoc,
        });
        this.sideCollapsed = r.sideCollapsed;
        this.workspace = normalizeWorkspace(r.workspace);
        this.convertAccess.restore(r);
        this.revealMode = r.revealMode;
        this.started = false;
        this.activeQIdx = 0;
        this.finished = undefined;
        this.docs = r.docs;
        this.pendingDoc = r.pendingDoc;
        this.docId = r.docId;
        // S2 树展开态：首次（prefs 无记录）默认展开第一层并持久化
        if (r.sideTreeOpen === undefined) {
            this.sideTreeOpen = buildSideTree(r.docs).map((n) => n.path);
            this.persistPrefs();
        } else {
            this.sideTreeOpen = r.sideTreeOpen;
        }
        this.docTotalSec = r.docTotalSec;
        this.list = this.fullList = r.fullList;
        this.materials = r.materials;
        this.rounds = r.rounds;
        if (colQuestions) {
            // 专题上下文：会话独立归档（col:<id>）轮次可续，材料按来源题集并集
            const col = await colLoadContext(this.history, this.bank, this.colFlow.id());
            this.list = this.fullList = colQuestions;
            this.rounds = col.rounds;
            this.materials = col.materials;
            this.docTotalSec = 0;
        }
        this.loadError = r.loadError;
        this.loading = false;
        await this.colFlow.refresh();
        this.renderList();
        // 后台链：知识引用对账 → 补侧栏专题清单（题集推导在装载链
        // ensureSets 已完成，无文档首扫步骤）
        if (this.bank) {
            void (this.weakness ? reconcileKnowledgeRefs(this.bank, this.weakness) : Promise.resolve(0))
                .then((): void => void this.colFlow.refresh().then((): void => this.colFlow.refreshSide()))
                .catch((e: unknown): void => {
                    // 原为 unhandled rejection：对账失败无人知
                    notifyError({ key: "notifyMigrateFail", vars: { msg: errText(e) } });
                });
        }
        if (this.reopenStatsTab) {
            const tab = this.reopenStatsTab;
            this.reopenStatsTab = undefined;
            this.openStatsPanelAt(tab);
        }
        // 复习模式发起的「重刷本文档」：装载完成后按落定的范围直落开轮
        if (this.pendingDrillScope && this.mode === "quiz" && !this.started && this.list.length > 0) {
            const scope = this.pendingDrillScope;
            this.pendingDrillScope = undefined;
            beginDrillFor(this, { scope });
        }
    }

    /* ── TimerHostAccess（timerHostFor 消费） ── */
    readonly activeQidOf = (): string => this.list[this.activeQIdx]?.id ?? "";
    readonly docTotalSecOf = (): number => this.docTotalSec;
    readonly syncSession = (elapsed: number): void => void (this.session && (this.session.elapsedSec = elapsed));
    readonly addDocTotal = (add: number) => (this.docTotalSec += add);
    readonly finishNow = (): void => manualFinishRound(roundFinishCtx(this));
    readonly allRounds = (): WenguSession[] => this.rounds;
    readonly finishedSession = (): WenguSession | undefined => this.finished;
    readonly aiModelId = (): string => this.convertAccess.modelId || this.settings?.convertModelId || "";
    /** 手动收卷统一揭示（after 模式）：等静态分片全部挂载后按表揭示——
     *  在途分片未挂时直接揭示会漏卡，且卡片初始态按未收口渲染、恢复
     *  口径各异（6-4b 与旧「分片插入后即绑」语义对齐）。 */
    readonly revealAnsweredNow = (): void => void this.renderTask?.then((): void => void revealAll(this));
    readonly stopRoundNow = (): void => {
        this.started = false;
        this.flushTime(); // 收卷即落库（未满 15s 的秒数不清零）
        this.timerBinder.updateLabel();
    };
    /** 收卷全锁：**状态级 + DOM 级双管**（Issue #12）。状态级锁 `ui.locked`
     *  是真正的作答闸（`answeredFrozen` 认它——重渲染后按钮不会又活过来），
     *  DOM 级补非响应式的输入位（textarea/input 只吃 disabled）。 */
    readonly lockAllCardsNow = (): void => {
        lockAllCardsState();
        lockAllCards(this.el);
    };
    readonly weaknessStore = (): WeaknessStore | undefined => this.weakness;
    readonly bankStore = (): QuestionBank | undefined => this.bank;
    readonly refreshCollections = (): void => void this.colFlow.refresh().then((): void => this.colFlow.refreshSide());
    readonly colFlowOf = (): CollectionFlow => this.colFlow;
    /** 相关题弹窗的视图能力（Issue #44；实现体 see flow/RelatedAccess）。 */
    readonly relatedAccessOf = (): RelatedViewAccess => relatedAccessFor(this);
    readonly convertingOf = (): boolean => this.convertAccess.converting;
    readonly setSideFilter = (text: string): void => void (this.sideFilter = text);
    readonly setSideCollapsed = (collapsed: boolean): void => {
        this.sideCollapsed = collapsed;
        this.persistPrefs();
        this.renderList();
    };
    /* ── StatsViewAccess（openStatsPanelFor 消费）；ConvertViewAccess 在下 ── */
    readonly docsOf = (): WenguDoc[] => this.docs;
    readonly sideTreeOpenOf = (): string[] => this.sideTreeOpen;
    readonly markReopenStats = (tab: "overview" | "doc") => (this.reopenStatsTab = tab);
    readonly switchDocSelect = (id: string): void => this.selectDoc(id);
    startPanelModel = () => startPanelModelFor(this);

    /* ── DrillViewAccess（beginDrillFor 消费）；专题模式会话记 col:<id> ── */
    readonly fullListOf = (): WenguQuestion[] => this.fullList;
    readonly docIdOf = (): string => (this.colFlow.isActive() ? `col:${this.colFlow.id()}` : this.docId);
    readonly historyStore = (): HistoryStore | undefined => this.history;
    readonly setQuizList = (l: WenguQuestion[]) => (this.list = l);
    readonly setQuizRevealMode = (m: WenguRevealMode) => (this.revealMode = m);
    readonly setActiveQIdx = (i: number) => (this.activeQIdx = i);
    readonly setStartedFlag = (v: boolean) => (this.started = v);
    readonly setFinishedSession = (s: WenguSession | undefined) => (this.finished = s);
    readonly setCurSession = (s: WenguSession | undefined) => (this.session = s);
    readonly renderQuizList = (): void => this.renderList();
    readonly rerenderView = (): void => this.renderList();
    readonly updateTimerLabelNow = (): void => this.timerBinder.updateLabel();
    readonly afterStartHook = (): void => {
        this.renderList(); // 落幕统一恢复已答锁定（继续上轮路径）
        this.timerBinder.updateLabel();
    };

    private renderList(): void {
        // 全新一轮渲染即重置「答满提示」去重标记（Issue #12 B3）：换题集/
        // 重开页签/收卷重渲染后，新一轮答满能再提示一次
        this.allAnsweredNotified = false;
        renderListFor(this);
    }

    /** 卷级英语判定作废（Issue #45）：题表/题集变更后旧判定作废（换卷/
     *  切题集/切模式时调用；缓存与反查链见 service/AnnoScopeCtl）。 */
    readonly invalidateAnnoScope = (): void => this.annoScope.invalidate();

    /** 选区起点所在卷是否英语卷（Issue #45 卷级判定，AnnoCallbacks 实现）。 */
    readonly isEnglishQuestionAt = (anchorEl: HTMLElement | null): boolean => this.annoScope.englishAt(anchorEl);

    /** 打开统计面板（tab 直落；下钻后 load 完成时也走这里重开）。 */
    readonly openStatsPanelAt = (tab: "overview" | "doc"): void => openStatsPanelFor(this, tab);

    readonly activeDocIdOf = (): string => this.activeDocId;
    readonly settingsOf = (): SettingsDialogShape | undefined => this.settings;
    readonly convertParallelOf = (): number => this.settings?.convertParallel ?? 1;
    readonly progressiveOf = (): ProgressivePreview => this.progressive;
    readonly isStarted = (): boolean => this.started;
    readonly currentDocId = (): string => this.docId;
    readonly switchPreviewDoc = (id: string, title: string, count: number): void => {
        this.colFlow.reset();
        this.pendingDoc = { id, title };
        this.docId = id;
        this.persistPrefs();
        this.activeQIdx = 0;
        this.finished = undefined; // 渐进呈现接管页签：旧轮次报告不让残留
        if (!this.docs.some((d) => d.id === id)) {
            this.docs.unshift({ id, title, hPath: "", total: count, attempted: 0, rightCount: 0, totalTime: 0 });
        }
    };
    readonly applyQuizList = (list: WenguQuestion[], materials?: WenguMaterial[]): void => {
        this.list = this.fullList = list;
        this.invalidateAnnoScope(); // Issue #45：题表换掉（渐进呈现逐批）旧判定作废
        if (materials) this.materials = materials;
        this.renderList();
    };
    readonly reloadView = (): Promise<void> => this.load();

    /** 题库访问（ConvertAccess 丢弃半成品题集用；bankStore 同体）。 */
    readonly bankOf = (): QuestionBank | undefined => this.bank;

    readonly openConvert = () => openConvertForView(this.convertAccess);
    /** 带预填打开转换弹窗（知识面板「转习题」：源/知识点根=该文档）。 */
    readonly openConvertPrefilled = (docId: string, know: string) =>
        openConvertForView(this.convertAccess, docId, know);

    /** 「标记为错题」/批量重转访问器（Issue #46；实现体 service/BadMarkRegen
     *  ——预览闸 / 徽标数 / 顶栏批量重转三合一，保 index.ts 不再净增）。 */
    readonly badMark = badMarkAccess(this);

    /** 侧栏/头部按钮统一出口（6-5 Svelte 化后 SidePanelApp/QuizHeadApp
     *  经 SideMount 的 onAct 汇到这里，act 名同 data-act；实现体在
     *  flow/SideMount 的 sideActFor）。 */
    readonly sideAct = sideActFor(this);
}
