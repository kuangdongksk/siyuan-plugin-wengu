import { Plugin, openTab, getActiveEditor, type Custom, type MobileCustom } from "siyuan";
import "./index.scss";
import { HistoryStore } from "./quiz/service/HistoryStore";
import { QuestionBank } from "./bank/data/QuestionBank";
import { QuizView } from "./quiz";
import { openRelatedDialog, type RelatedViewAccess } from "./bank/ui/RelatedDialog";
import { openWenguSetting } from "./ui/SettingsDialog";
import type { WenguRevealMode, WenguTimingMode } from "./types";
import { WeaknessStore } from "./bank/data/WeaknessStore";
import { WordStore } from "./word/core/WordStore";
import { companionCtl, initCompanion, mountCompanionGlobal, unmountCompanionGlobal } from "./companion";
import { initWordLib } from "./word/service/WordLib";
import { initNotify, notifyInfo } from "./ui/Notify";
import { debounce, isMobileUi } from "./ui/shared";
import { initRouteCache } from "./bank/data/RouteCache";
import { aiSessions, initAiSessions } from "./ai/data/AiSessions";
import { initKnowHash, knowHash } from "./bank/data/KnowHash";
import { initKnowSynonyms } from "./bank/data/KnowSynonyms";
import { initKnowIndex } from "./bank/data/KnowIndex";
import { aiSlotCapacityOf, setAiSlotCapacity } from "./ai/queue";
import { knowJumpTarget, knowTreeByNode, knowTreesOf } from "./bank/data/KnowTrees";
import { WENGU_ICONS } from "./bootstrap/Icons";
import { registerDocks, type WordDockConfig } from "./bootstrap/Docks";

/** 页签 type。openTab 的 custom.id 会拼成 plugin.name + type，addTab 用同 type 匹配。 */
const TAB_RESULT = "wengu-tab";

/** 打开页签时记录的目标文档 id（addTab 回调读不到 Tab.data，用模块级传递）。 */
let targetDocId = "";

/** 插件设置（loadData/saveData("settings") 持久）。
 *  语义见 SettingsDialog.WenguSettingsShape：设置页=默认值。 */
interface WenguSettings {
    /** 题目区左侧是否显示题号导航。 */
    showNums: boolean;
    /** 题卡头部是否显示「刷过 N 次」。 */
    showAttempts?: boolean;
    /** 是否显示上次错题信息（错题徽标、题号历史描色）。 */
    showWrong?: boolean;
    /** 默认计时/展示/分钟与模型（开刷面板、转换弹窗的初始选择）。 */
    defaultTiming?: WenguTimingMode;
    defaultReveal?: WenguRevealMode;
    defaultCountdownMin?: number;
    convertModelId?: string;
    /** 默认「填空转选择」。 */
    fillToChoice?: boolean;
    /** 默认「大题拆多步」（可分解的工科大题 → 多步引导题）。 */
    bigToSteps?: boolean;
    /** 省费模式（增量重转换）：变更/消失块全保留旧题、只补新增块。 */
    convertKeepOld?: boolean;
    /** 转换并行度（1~4，1=串行）：转换分片流水线数，同时是**全局 AI
     *  在途并发闸**的容量（Issue #76，index.ts applyAiSlots 注入）。 */
    convertParallel?: number;
    /** 看板娘学伴：全局开关/兜底台词人设/AI 台词与对话/多套学伴配置。 */
    companionEnabled?: boolean;
    companionPersona?: string;
    companionAi?: boolean;
    companionProfiles?: import("./companion/core/CompanionCtl").CompanionProfile[];
    companionActiveId?: string;
    /** 由插件注入的落盘回调。 */
    save?: () => void;
}

/**
 * 温故 —— 刷题 · 错题复习 · 题目与笔记联动
 *
 * 顶栏 `温故` 按钮 → openTab 打开自定义页签（addTab 注册，同 type）。
 * 页签内容由 QuizView 渲染：开刷前先选计时方式，题目列表 + 题号导航，
 * 客观题自动判分。设置 → 插件 → 温故 里有「显示题号」开关。
 */
export default class WenguPlugin extends Plugin {
    /** 单例缓存，供 addTab 回调在拿不到插件实例时取 i18n。 */
    static instance: WenguPlugin | undefined;
    /** 插件设置（对象引用共享给 QuizView，开关即时生效）。 */
    settings: WenguSettings = { showNums: true, showAttempts: true, showWrong: true };
    /** 当前打开的刷题视图（设置变更时通知重渲染）。 */
    activeView: QuizView | undefined;
    /** 刷题侧共享存储单例（多页签/右键反查共享同一份缓存与脏标记）。 */
    private historyStore?: HistoryStore;
    private weaknessStore?: WeaknessStore;
    private bankStore?: QuestionBank;

    /** i18n 取值（右键菜单/对话框用）。 */
    readonly tKey = (key: string): string => this.i18n[key] || key;

    history(): HistoryStore | undefined {
        this.historyStore ??= new HistoryStore(
            () => this.loadData("history"),
            (h) => this.saveData("history", h)
        );
        return this.historyStore;
    }

    weakness(): WeaknessStore | undefined {
        this.weaknessStore ??= new WeaknessStore(
            () => this.loadData("weakness"),
            (v) => this.saveData("weakness", v)
        );
        return this.weaknessStore;
    }

    /** 相关题弹窗的视图能力（Issue #44）：页签不在场返回 undefined，
     *  弹窗动作退化为「不可用」提示（列表照常可看）。 */
    relatedAccess(): RelatedViewAccess | undefined {
        return this.activeView?.relatedAccessOf();
    }

    bank(): QuestionBank | undefined {
        this.bankStore ??= new QuestionBank(
            () => this.loadData("bank"),
            (v) => this.saveData("bank", v)
        );
        return this.bankStore;
    }

    /**
     * 装载编排：**只留调用序 + 兜底 catch**（20260915 按域切注册器，
     * audit #109——原 512 行唯一无豁免的超线业务入口）。各注册段拆到
     * 下面五个方法里，本方法只负责「先建后挂、先注入后消费」的顺序：
     *
     *  1. `loadSettings()` 读设置并注入落盘回调（后续各域都读它）；
     *  2. `initStores()` 初始化各持久化店（词书房 / 通知 / 路由缓存 /
     *     AI 会话 / 并发闸 / 知识哈希 / 同义词 / 知识索引）；
     *  3. `registerCompanion()` 学伴（全局悬浮层 + 事件收口）；
     *  4. `bindGlobal()` document 级委托（拆出前就落在这里：紧跟学伴、
     *     先于图标与其余 UI 注册）；
     *  5. `registerUi()` 图标 / 顶栏 / dock（单词 + 移动端刷题）/ 右键注入
     *     / ws-main 对账 / 刷题页签。
     *
     * ⚠️ 次序是硬的（内核 dock 与页签共用 type、通知须先于各存储 init、
     * 并发闸容量读设置项），拆方法时**逐段搬运、未调顺序**；兜底 catch
     * 留在本方法（onload 抛错=插件半装载，不是崩溃）。
     */
    async onload() {
        WenguPlugin.instance = this;
        try {
            await this.loadSettings();
            this.initStores();
            this.registerCompanion();
            this.bindGlobal();
            this.registerUi();
        } catch (e) {
            // 装载期任一段抛错：插件停在半装载态（各段自带尽力而为兜底），
            // 但不能把异常漏给宿主——onload 抛错会让思源报「插件加载失败」
            console.error("[wengu] onload 失败", e);
        }
    }

    /** 读插件设置并注入落盘回调（对象引用共享给 QuizView，开关即时生效）。 */
    private async loadSettings(): Promise<void> {
        try {
            const saved = (await this.loadData("settings")) as Partial<WenguSettings> | "" | null | undefined;
            if (saved && typeof saved === "object") this.settings = { ...this.settings, ...saved };
        } catch (_) {
            // 读不到就按默认
        }
        // 持久化回调注入共享对象（落盘时剥掉函数字段）
        this.settings.save = () => {
            const rest = { ...this.settings } as Partial<WenguSettings>;
            delete rest.save;
            // 链尾吞错：裸 void 会把 saveData 的异步 reject（重载后旧
            // 实例的 410 生命周期闸等）漏成未捕获拒绝刷控制台
            this.saveData("settings", rest).catch((): void => undefined);
        };
    }

    /** 各持久化店初始化（设置读完后、任何 UI 挂载前）。 */
    private initStores(): void {
        // 词书房（多词书，redesign §五）：内核文件通道，onload 先于任何
        // 单词面板挂载初始化
        initWordLib();
        // 思源通知（20260901）：后台任务的静默失败/完成走 showMessage
        // 浮层（深层存储模块经 i18n 键取词），先于各存储 init
        initNotify(this.i18n ?? {});
        // 路由结果缓存（增量哈希一期）：两级 AI 路由按题指纹缓存，
        // 匹配/批量关联/生成标签三弹窗共用
        initRouteCache({
            load: () => this.loadData("route-cache"),
            save: (v) => this.saveData("route-cache", v),
        });
        // AI 会话登记簿（20260831）：判题/转换/标签等带 track 的 AI 调用
        // 自动登记，「AI 会话」面板回看产出 + 继续追问
        initAiSessions({
            load: () => this.loadData("ai-sessions"),
            save: (v) => this.saveData("ai-sessions", v),
        });
        // 全局 AI 在途并发闸（Issue #76）：容量 = 设置里的转换并行度
        // （1~4）。**未设置回落默认 4**（见 aiSlotCapacityOf——不能拿转换
        // 弹窗的「1 = 串行」当默认，那会把全仓 AI 在途数默认压成 1）。
        // 设置页改并行度时经 onSettingsChange 重新注入（见下）
        this.applyAiSlots();
        // 知识小节内容哈希基线（自托管三期）：面板 stale 徽标 + 路由
        // 缓存代数指纹的小节内容维度
        initKnowHash({
            load: () => this.loadData("know-hash"),
            save: (v) => this.saveData("know-hash", v),
        });
        // 知识点同义词表（Issue #3）：文本关联归一链的前置层，AI 判定
        // 结果沉淀于此（同一对词第二次出现零 AI 调用）
        initKnowSynonyms({
            load: () => this.loadData("know-synonyms"),
            save: (v) => this.saveData("know-synonyms", v),
        });
        // 知识索引快照（Issue #39）：登记根的文档标题树一次性捕获，
        // 面板/路由/词表装载零内核 SQL；懒捕获兜住存量登记根
        initKnowIndex({
            load: () => this.loadData("know-index"),
            save: (v) => this.saveData("know-index", v),
        });
    }

    /** 看板娘学伴：全局悬浮层挂 body，与页签渲染解耦（事件由各域收口
     *  一行接入，20260828 定稿）。 */
    private registerCompanion(): void {
        initCompanion({
            i18n: this.i18n ?? {},
            settings: this.settings,
            history: this.history(),
            word: this.getWordStore(),
            chat: {
                loadRaw: () => this.loadData("companion-chat"),
                saveRaw: (v) => this.saveData("companion-chat", v),
            },
        });
        // 全局悬浮层（挂 body）：onload 尾声挂，onunload 卸——重载不叠影
        mountCompanionGlobal();
    }

    /** UI 注册段：图标 / 顶栏 / dock / 事件订阅 / 刷题页签。 */
    private registerUi(): void {
        this.addIcons(WENGU_ICONS);

        this.registerTopbar();
        this.registerDocks();
        this.registerMenus();
        this.registerQuizTab();
    }

    /** 顶栏「温故」按钮 → openTab 打开刷题页签（移动端分流提示）。 */
    private registerTopbar(): void {
        this.addTopBar({
            icon: "iconWengu",
            title: this.i18n.pluginName,
            position: "right",
            callback: async () => {
                // 移动端分流（Issue #10）：插件页签在移动端打不开——思源
                // app/src/plugin/API.ts 的 `/// #if MOBILE` 分支里 openTab
                // 是空桩（/\* TODO: Mobile \*/），点击原本**静默无反应**。
                // 移动端唯一可用的插件面板通道是 dock（addDock 被包装为
                // mobileModel 挂移动侧栏），且无程序化打开 API——只提示。
                // 移动端刷题面板挂在 dock（下面按 isMobileUi 注册），
                // 没有程序化打开 API——只提示用户去侧栏 dock 取。
                if (isMobileUi()) {
                    notifyInfo({ key: "notifyMobileQuizOnly" });
                    return;
                }
                // 记录当前活动文档，页签据此渲染该文档的题目
                const editor = getActiveEditor();
                targetDocId = editor?.protyle?.block?.rootID ?? "";
                const tab = await openTab({
                    app: this.app,
                    custom: {
                        icon: "iconWengu",
                        title: this.i18n.pluginName,
                        id: this.name + TAB_RESULT,
                    },
                });
                // 页签已打开时 openTab 只聚焦不重建：把新文档 id 推给既有视图
                const view = (tab as unknown as { model?: { wenguView?: QuizView } })?.model?.wenguView;
                view?.setDoc(targetDocId);
            },
        });
    }

    /** Dock 注册（单词复习 / 移动端刷题）：实现体在 bootstrap/Docks.ts，
     *  本方法只注入宿主能力——注册次序与「移动端只在移动端注册」的闸门
     *  在那边逐字保留（20260915 拆出压 500 行红线）。 */
    private registerDocks(): void {
        registerDocks({
            i18n: this.i18n ?? {},
            // addDock 是插件实例自带的内核通道（类型包 1.2.x 未收录运行时形状）：
            // 就地转换后**绑定本实例**再转发——拆出前 `dockHost.addDock(...)`
            // 的 dockHost 就是本实例，绑定丢失会让内核方法拿错 this。实例
            // 没有该方法时传 undefined，Docks 侧的 `if (host.addDock)` 照旧拦住。
            addDock: (this as unknown as { addDock?: (c: WordDockConfig) => unknown }).addDock?.bind(this),
            alive: () => !!WenguPlugin.instance,
            wordStore: () => this.getWordStore(),
            // 共享设置对象：拆出后 settings 会成为快照，故取用时读活引用
            settings: () => this.settings,
            bank: () => this.bank(),
            history: () => this.history(),
            weakness: () => this.weakness(),
        });
    }

    /** 事件订阅：知识文档右键注入（⑤）+ 内核 ws 事务对账。 */
    private registerMenus(): void {
        // 知识文档右键「温故：查相关题目」（⑤）：映射在插件数据里，本地反查
        this.eventBus.on("open-menu-content", this.onOpenMenuContent);

        // 用户在思源树里删/移文档时对账题库：内核事务经 ws-main 广播
        // （doOperations.action=delete/move），官方事件面没有独立的
        // deleted/moved 事件。不过滤明细、delete/move 一律防抖全量对账
        // ——migratedDocs 登记的文档逐个查活（分块 IN 50），死文档的
        // 记录/影子专题/登记一次清掉。原无任何同步路径：树里删了习题
        // 文档后题库存量悬空、专题/材料静默空转（20260829 三轮审查）。
        // 串行内核调用、放后台不阻塞 UI。
        this.eventBus.on("ws-main", WenguPlugin.onWsReconcile);
    }

    /** 刷题页签（addTab）：init 建 QuizView、update 重渲染、destroy 回收。 */
    private registerQuizTab(): void {
        this.addTab({
            type: TAB_RESULT,
            init(this: Custom | MobileCustom) {
                const i18n = WenguPlugin.instance?.i18n ?? {};
                const plugin = WenguPlugin.instance;
                const view = new QuizView(
                    this.element as HTMLElement,
                    i18n,
                    targetDocId,
                    plugin?.app,
                    plugin
                        ? {
                              load: () => plugin.loadData("quiz"),
                              save: (v) => plugin.saveData("quiz", v),
                          }
                        : undefined,
                    // 共享设置对象：设置页开关后页签立即跟随
                    plugin?.settings,
                    // 共享存储单例（历史/薄弱画像/题库，见 onload 字段）
                    plugin?.history(),
                    plugin?.weakness(),
                    plugin?.bank(),
                    // 目录底部设置图标按钮 → 插件设置弹窗
                    plugin ? () => plugin.openSetting() : undefined,
                    // 背单词存储（生词标记 → 复习队列，与背单词面板共享单例）
                    plugin?.getWordStore()
                );
                (this as any).wenguView = view;
                if (plugin) plugin.activeView = view;
                view.render();
            },
            update(this: Custom | MobileCustom) {
                (this as any).wenguView?.render?.();
            },
            destroy() {
                const view = (this as any).wenguView as QuizView | undefined;
                view?.destroy?.();
                const plugin = WenguPlugin.instance;
                if (plugin && plugin.activeView === view) plugin.activeView = undefined;
            },
        });
    }

    /** document 级全局委托（onunload 配对摘除）：题干内嵌块引用（查看原文）
     *  ——静态渲染是字符串管线，引用 span 只能带 data 标记由这里统一跳转。 */
    private bindGlobal(): void {
        document.addEventListener("click", WenguPlugin.onBlockRefClick);
    }

    /** 卸载：全局悬浮层挂 body 不随页签回收，必须显式卸（重载不叠影）。 */
    onunload(): void {
        unmountCompanionGlobal();
        document.removeEventListener("click", WenguPlugin.onBlockRefClick);
        this.eventBus.off("ws-main", WenguPlugin.onWsReconcile);
        this.eventBus.off("open-menu-content", this.onOpenMenuContent);
        WenguPlugin.scheduleBankReconcile.cancel(); // 防抖窗口内的对账作废
        this.flushPending();
    }

    /** 去抖窗口内的尾笔立即落盘（重载/卸载不丢）。 */
    private flushPending(): void {
        aiSessions()?.flushNow(); // 登记簿
        void this.bankStore?.flush(); // 题库 2s 防抖窗口内的作答记账
    }

    /** 文档右键菜单注入（onunload 需配对退订，故必须是命名方法——
     *  匿名箭头订阅重载一次叠一份监听器且旧实例无法回收）。 */
    private readonly onOpenMenuContent = (ev: CustomEvent): void => {
        const detail = ev.detail as {
            menu?: { addItem: (item: { icon: string; label: string; click: () => void }) => void };
            blockElements?: Record<string, unknown>;
        };
        const ids = Object.keys(detail.blockElements ?? {});
        if (!detail.menu || ids.length !== 1) return;
        const bank = this.bank();
        if (!bank) return;
        detail.menu.addItem({
            icon: "iconSearch",
            label: this.tKey("relatedMenu"),
            // 弹窗动作（预览/开刷/回顾）要刷题页签在场；页签不在时 access
            // 缺省 → 列表照常、联动动作提示（Issue #44）
            click: () => void openRelatedDialog(bank, this.tKey, ids[0], WenguPlugin.instance?.relatedAccess()),
        });
    };

    /** 题干内嵌块引用（查看原文）的 document 级委托：静态渲染是字符串
     *  管线（md → HTML 串），引用 span 只能带 data 标记由这里统一跳转。
     *  内部知识树节点无真实块——降级跳到源章节文档。 */
    private static readonly onBlockRefClick = (ev: MouseEvent): void => {
        const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-wengu-blockref]");
        const id = el?.dataset.wenguBlockref;
        if (!id) return;
        void (async (): Promise<void> => {
            const bank = WenguPlugin.instance?.bank();
            if (bank) {
                const trees = await knowTreesOf(bank);
                // AI 树节点：源标题块指针优先块级直跳，无则降级跳源章节文档
                if (knowTreeByNode(trees, id)) {
                    window.open(`siyuan://blocks/${knowJumpTarget(trees, id)}`);
                    return;
                }
            }
            window.open(`siyuan://blocks/${id}`);
        })();
    };

    /** ws 事务流里攒下的待刷新文档根（防抖窗口内聚簇）。 */
    private static pendingRoots = new Set<string>();

    /** ws 事务流过滤：delete/move/update 记下文档根，防抖后刷新知识
     *  小节哈希基线（题目内容 20260903 起唯一真相在题库，镜像漂移检测
     *  与习题文档存活性核对整体退役；内核无独立事件面，官方广播即信号
     *  源；op 字段名 rootID 系 3.8.x 前端源码验证）。 */
    private static readonly onWsReconcile = (ev: {
        detail: { data?: { doOperations?: { action?: string; rootID?: string }[] } };
    }): void => {
        const ops = ev.detail?.data?.doOperations ?? [];
        let hit = false;
        for (const o of ops) {
            if (o.action === "delete" || o.action === "move" || o.action === "update") {
                if (o.rootID) WenguPlugin.pendingRoots.add(o.rootID);
                hit = true;
            }
        }
        if (hit) WenguPlugin.scheduleBankReconcile();
    };

    /** 防抖对账：知识域文档的小节哈希基线顺路刷新（尽力而为）。 */
    private static readonly scheduleBankReconcile = debounce((): void => {
        void (async () => {
            const roots = [...WenguPlugin.pendingRoots];
            WenguPlugin.pendingRoots.clear();
            const kh = await knowHash();
            for (const id of roots) await kh?.refreshDoc(id);
        })().catch((): void => undefined); // 对账尽力而为，失败等下次事件/装载
    }, 5000);

    /** 单词进度存储单例（Dock 面板/兜底页签/刷题生词标记共用同一缓存）。 */
    private wordStore: WordStore | undefined;

    /** 取共享 WordStore（刷题页签的生词标记也写入同一份进度）。 */
    getWordStore(): WordStore {
        if (!this.wordStore) {
            this.wordStore = new WordStore(
                () => this.loadData("words"),
                (p) => this.saveData("words", p)
            );
        }
        return this.wordStore;
    }

    /** 全局 AI 在途闸容量注入（Issue #76）：设置里的转换并行度即容量
     *  （1~4）；**未设置/非法值回落默认 4**（aiSlotCapacityOf，纯函数带
     *  单测）。运行期可更新——缩容不打断在途，只拦新来的。设置页改并行度
     *  后经 onSettingsChange 重注入。 */
    applyAiSlots(): void {
        setAiSlotCapacity(aiSlotCapacityOf(this.settings.convertParallel));
    }

    /** 设置 → 插件 → 温故：仿思源原生设置外观（左导航 + 分组条目）。 */
    openSetting() {
        openWenguSetting({
            i18n: this.i18n,
            pluginName: this.i18n.pluginName || this.name,
            version: (this as unknown as { manifest?: { version?: string } }).manifest?.version ?? "0.1.1",
            settings: this.settings,
            onSettingsChange: () => {
                this.applyAiSlots(); // 改转换并行度即改全局 AI 在途容量（Issue #76）
                this.activeView?.applySettings();
                companionCtl()?.syncEnabled(); // 学伴总开关对全局悬浮层即时生效（20260828 审查：原只写 settings 不刷 ui.enabled）
            },
        });
    }
}
