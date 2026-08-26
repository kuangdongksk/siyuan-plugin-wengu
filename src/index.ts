import { Plugin, openTab, getActiveEditor, type Custom, type MobileCustom } from "siyuan";
import "./index.scss";
import { HistoryStore } from "./quiz/HistoryStore";
import { QuestionBank } from "./bank/QuestionBank";
import { QuizView } from "./quiz";
import { openRelatedDialog } from "./bank/RelatedDialog";
import { openWenguSetting } from "./ui/SettingsDialog";
import type { WenguRevealMode, WenguTimingMode } from "./types";
import { WeaknessStore } from "./bank/WeaknessStore";
import { WordStore } from "./word/WordStore";
import { mountWordView, type WordView } from "./word";

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
    /** 默认生成位置：same=原文档同目录；custom=指定父文档下面。 */
    convertTargetMode?: "same" | "custom";
    /** 指定父文档 id 或 siyuan:// 链接（convertTargetMode=custom 时用）。 */
    convertTargetId?: string;
    /** MinerU API Token（mineru.net 注册获取，PDF 导入用）。 */
    mineruToken?: string;
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
</symbol>`);
        this.addTopBar({
            icon: "iconWengu",
            title: this.i18n.pluginName,
            position: "right",
            callback: async () => {
                // 记录当前活动文档，页签据此渲染该文档的题目
                const editor = getActiveEditor();
                targetDocId = editor?.protyle.block.rootID ?? "";
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
        this.eventBus.on("open-menu-content", (ev) => {
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
        });

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
        const m = mountWordView(el, this.i18n ?? {}, this.getWordStore());
        (custom as unknown as { wenguWordView?: WordView }).wenguWordView = m.view;
        wordUnmount = m.unmount;
    }

    /** 设置 → 插件 → 温故：仿思源原生设置外观（左导航 + 分组条目）。 */
    openSetting() {
        openWenguSetting({
            i18n: this.i18n,
            pluginName: this.i18n.pluginName || this.name,
            version: (this as unknown as { manifest?: { version?: string } }).manifest?.version ?? "0.1.0",
            settings: this.settings,
            onSettingsChange: () => this.activeView?.applySettings(),
        });
    }
}
