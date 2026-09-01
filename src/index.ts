import { Plugin, openTab, getActiveEditor, type Custom, type MobileCustom } from "siyuan";
import "./index.scss";
import { HistoryStore } from "./quiz/service/HistoryStore";
import { QuestionBank } from "./bank/data/QuestionBank";
import { QuizView } from "./quiz";
import { openRelatedDialog } from "./bank/ui/RelatedDialog";
import { KernelQuery } from "./siyuan/query";
import { openWenguSetting } from "./ui/SettingsDialog";
import type { WenguRevealMode, WenguTimingMode } from "./types";
import { WeaknessStore } from "./bank/data/WeaknessStore";
import { WordStore } from "./word/core/WordStore";
import { mountWordView, type WordView } from "./word";
import { companionCtl, initCompanion, mountCompanionGlobal, unmountCompanionGlobal } from "./companion";
import { initWordLib } from "./word/service/WordLib";
import { initNotify } from "./ui/Notify";
import { initRouteCache } from "./bank/data/RouteCache";
import { aiSessions, initAiSessions } from "./ai/data/AiSessions";
import { runDriftCheck } from "./bank/data/DriftWatch";
import { initKnowHash, knowHash } from "./bank/data/KnowHash";

/** 页签 type。openTab 的 custom.id 会拼成 plugin.name + type，addTab 用同 type 匹配。 */
const TAB_RESULT = "wengu-tab";

/** 单词复习页签 type（Dock 面板与兜底页签共用）。 */
const TAB_WORDS = "wengu-words";

/** 单词面板的 Svelte 卸载函数（Dock 单例，模块级传递给 destroy 回调）。 */
let wordUnmount: (() => void) | undefined;

/** 3.8.0 运行时的插件 Dock 注册入参（类型包 1.2.x 未收录，按运行时形状声明）。 */
interface WordDockConfig {
    type: string;
    config: {
        title: string;
        icon: string;
        index?: number;
        hotkey?: string;
        /** 内核 dock 布局必读字段（缺失会在 addDock 内部 startsWith 崩溃）。 */
        position?: "LeftBottom" | "LeftTop" | "RightBottom" | "RightTop" | "BottomLeft" | "BottomRight";
        size?: { width?: number; height?: number };
    };
    init: (custom: { element?: Element }) => void;
    destroy?: () => void;
    update?: () => void;
    resize?: () => void;
}

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
    /** 默认生成位置：same=原文档同目录；custom=指定父文档下面。 */
    convertTargetMode?: "same" | "custom";
    /** 指定父文档 id 或 siyuan:// 链接（convertTargetMode=custom 时用）。 */
    convertTargetId?: string;
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

    bank(): QuestionBank | undefined {
        this.bankStore ??= new QuestionBank(
            () => this.loadData("bank"),
            (v) => this.saveData("bank", v)
        );
        return this.bankStore;
    }

    async onload() {
        WenguPlugin.instance = this;
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
            void this.saveData("settings", rest);
        };
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
        // 知识小节内容哈希基线（自托管三期）：面板 stale 徽标 + 路由
        // 缓存代数指纹的小节内容维度
        initKnowHash({
            load: () => this.loadData("know-hash"),
            save: (v) => this.saveData("know-hash", v),
        });
        // 看板娘学伴（全局悬浮层挂 body，与页签渲染解耦；事件由各域收口
        // 一行接入，20260828 定稿）
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
        // 题干内嵌块引用（查看原文）：document 级委托一次接管静态渲染产出的引用 span
        document.addEventListener("click", WenguPlugin.onBlockRefClick);
        // 插件图标：形状取自思源官方图标集（litheness 包 iconRiffCard /
        // iconLanguage 的原始 path），以自有稳定 id 注册——不依赖运行环境
        // sprite 是否收录该图标（iconLanguage 非核心图标，dock 里会渲染成
        // 空白）；id 保持不变，conf.json uiLayout 持久化的旧 dock 图标引用
        // 才能继续命中 symbol（换图标只换形状不改 id，20260826 定论）
        this
            .addIcons(`<symbol id="iconWengu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>
</symbol>
<symbol id="iconWenguWords" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
</symbol>
<symbol id="iconVolume" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
  <path d="M11 5 6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.8 5.7a10 10 0 0 1 0 12.6"/>
</symbol>`);
        this.addTopBar({
            icon: "iconWengu",
            title: this.i18n.pluginName,
            position: "right",
            callback: async () => {
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

        // 单词复习只走 Dock 面板（顶部入口与同名页签已删：addTab 与
        // addDock 注册同名 type 会让 dock 的 init 分发到页签实例，
        // 面板空白的根因）。3.8.0 运行时支持，类型包未收录 → 局部声明。
        const dockHost = this as unknown as { addDock?: (c: WordDockConfig) => unknown };
        if (dockHost.addDock) {
            dockHost.addDock({
                type: TAB_WORDS,
                config: {
                    title: this.i18n.wordBtn || "背单词",
                    icon: "iconWenguWords",
                    index: 1000,
                    hotkey: "",
                    position: "RightBottom",
                    size: { width: 360, height: 0 },
                },
                init: (custom) => this.mountWordView(custom),
                // 卸载 Svelte 应用与计时器监听（旧版此处空置会泄漏）
                destroy: () => {
                    wordUnmount?.();
                    wordUnmount = undefined;
                },
            });
        }

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

    /** 卸载：全局悬浮层挂 body 不随页签回收，必须显式卸（重载不叠影）。 */
    onunload(): void {
        unmountCompanionGlobal();
        document.removeEventListener("click", WenguPlugin.onBlockRefClick);
        this.eventBus.off("ws-main", WenguPlugin.onWsReconcile);
        this.eventBus.off("open-menu-content", this.onOpenMenuContent);
        if (WenguPlugin.reconcileTimer !== undefined) window.clearTimeout(WenguPlugin.reconcileTimer);
        aiSessions()?.flushNow(); // 登记簿去抖窗口内的尾笔立即落盘（重载不丢）
        void this.bankStore?.flush(); // 题库 2s 防抖窗口内的作答记账尾笔（刷完题即重载不丢）
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
            click: () => void openRelatedDialog(bank, this.tKey, ids[0]),
        });
    };

    /** 题干内嵌块引用（查看原文）的 document 级委托：静态渲染是字符串
     *  管线（md → HTML 串），引用 span 只能带 data 标记由这里统一跳转。 */
    private static readonly onBlockRefClick = (ev: MouseEvent): void => {
        const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-wengu-blockref]");
        if (el?.dataset.wenguBlockref) window.open(`siyuan://blocks/${el.dataset.wenguBlockref}`);
    };

    /** 树删除/移动事件的防抖对账定时器（onunload 清）。 */
    private static reconcileTimer: number | undefined;

    /** ws 事务流里攒下的待对账文档根（防抖窗口内聚簇，update 漂移检测用）。 */
    private static pendingRoots = new Set<string>();

    /** ws 事务流过滤：delete/move 排程存活对账；update 记下文档根、
     *  防抖后对题库登记文档跑镜像漂移检测（内核无独立事件面，官方
     *  广播即信号源；op 字段名 rootID 系 3.8.x 前端源码验证）。 */
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

    /** 防抖对账：①delete/move→题库登记文档存活性核对；②update→
     *  命中 migratedDocs 的文档镜像漂移检测（插件自身写先更新题库
     *  hash 再落块，dry-run 得「相同」天然免疫）。 */
    private static readonly scheduleBankReconcile = (): void => {
        if (WenguPlugin.reconcileTimer !== undefined) window.clearTimeout(WenguPlugin.reconcileTimer);
        WenguPlugin.reconcileTimer = window.setTimeout((): void => {
            WenguPlugin.reconcileTimer = undefined;
            void (async () => {
                const plugin = WenguPlugin.instance;
                const bank = plugin?.bank();
                if (!plugin || !bank) return;
                const roots = [...WenguPlugin.pendingRoots];
                WenguPlugin.pendingRoots.clear();
                const docIds = [...(await bank.all()).migratedDocs];
                for (let i = 0; i < docIds.length; i += 50) {
                    const chunk = docIds
                        .slice(i, i + 50)
                        .map((x) => `'${x}'`)
                        .join(",");
                    const rows = await KernelQuery.rows<{ id: string }>(
                        `SELECT id FROM blocks WHERE type = 'd' AND id IN (${chunk})`
                    );
                    const alive = new Set(rows.map((r) => r.id));
                    for (const id of docIds.slice(i, i + 50)) {
                        if (!alive.has(id)) await bank.removeDocData(id);
                    }
                }
                for (const id of roots) {
                    if (docIds.includes(id)) await runDriftCheck(bank, id);
                    else await knowHash()?.refreshDoc(id); // 知识域文档：小节哈希基线顺路刷新
                }
                await bank.flush();
            })().catch((): void => undefined); // 对账尽力而为，失败等下次事件/装载
        }, 5000);
    };

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

    /** 单词视图挂载（Dock 面板与兜底页签共用；WordStore 单例共享进度缓存）。 */
    private mountWordView(custom: { element?: Element }): void {
        const el = custom.element as HTMLElement | undefined;
        if (!el || !WenguPlugin.instance) return;
        wordUnmount?.(); // dock init 重入（布局恢复竞态）先卸旧实例——否则旧 WordTimer 间隔器泄漏
        const m = mountWordView(el, this.i18n ?? {}, this.getWordStore());
        (custom as unknown as { wenguWordView?: WordView }).wenguWordView = m.view;
        wordUnmount = m.unmount;
    }

    /** 设置 → 插件 → 温故：仿思源原生设置外观（左导航 + 分组条目）。 */
    openSetting() {
        openWenguSetting({
            i18n: this.i18n,
            pluginName: this.i18n.pluginName || this.name,
            version: (this as unknown as { manifest?: { version?: string } }).manifest?.version ?? "0.1.1",
            settings: this.settings,
            onSettingsChange: () => {
                this.activeView?.applySettings();
                companionCtl()?.syncEnabled(); // 学伴总开关对全局悬浮层即时生效（20260828 审查：原只写 settings 不刷 ui.enabled）
            },
        });
    }
}
