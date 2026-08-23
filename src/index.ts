import {
    Plugin,
    openTab,
    getActiveEditor,
    type Custom,
    type MobileCustom,
} from "siyuan";
import "./index.scss";
import {HistoryStore} from "./wengu/HistoryStore";
import {QuizView} from "./wengu/QuizView";
import {openWenguSetting} from "./wengu/SettingsDialog";
import type {
    WenguRevealMode,
    WenguTimingMode,
} from "./wengu/types";
import {WordStore} from "./wengu/WordStore";
import {WordView} from "./wengu/WordView";

/** 页签 type。openTab 的 custom.id 会拼成 plugin.name + type，addTab 用同 type 匹配。 */
const TAB_RESULT = "wengu-tab";

/** 单词复习页签 type（Dock 面板与兜底页签共用）。 */
const TAB_WORDS = "wengu-words";

/** 3.8.0 运行时的插件 Dock 注册入参（类型包 1.2.x 未收录，按运行时形状声明）。 */
interface WordDockConfig {
    type: string;
    config: {title: string; icon: string; index?: number; hotkey?: string;};
    init: (custom: {element?: Element;}) => void;
    destroy?: () => void;
    update?: () => void;
    resize?: () => void;
}

/** 激活 Dock 用的最小接口（window.siyuan.layout 上的 Dock 实例）。 */
interface DockLike {
    data: Record<string, unknown>;
    toggleModel: (type: string, show?: boolean) => void;
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
    settings: WenguSettings = {showNums: true, showAttempts: true, showWrong: true};
    /** 当前打开的刷题视图（设置变更时通知重渲染）。 */
    activeView: QuizView | undefined;
    /** 单词进度存储单例（Dock 面板与页签共享同一缓存）。 */
    private wordStore: WordStore | undefined;

    async onload() {
        WenguPlugin.instance = this;
        try {
            const saved = await this.loadData("settings") as Partial<WenguSettings> | "" | null | undefined;
            if (saved && typeof saved === "object") this.settings = {...this.settings, ...saved};
        } catch (_) {
            // 读不到就按默认
        }
        // 持久化回调注入共享对象（落盘时剥掉函数字段）
        this.settings.save = () => {
            const rest = {...this.settings} as Partial<WenguSettings>;
            delete rest.save;
            void this.saveData("settings", rest);
        };
        this.addIcons(`<symbol id="iconWengu" viewBox="0 0 32 32">
  <path d="M4 6h10a4 4 0 0 1 4 4v16a3 3 0 0 0-3-3H4z" fill="currentColor"/>
  <path d="M28 6H18a4 4 0 0 0-4 4v16a3 3 0 0 1 3-3h11z" fill="currentColor" opacity="0.55"/>
  <path d="M13 15.5l2.2 2.2 4.3-4.6" fill="none" stroke="var(--b3-theme-background)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</symbol>
<symbol id="iconWenguWords" viewBox="0 0 32 32">
  <path d="M6 5h9c1.7 0 3 1.3 3 3v19c0-1.7-1.3-3-3-3H6z" fill="currentColor"/>
  <path d="M26 5h-9c-1.7 0-3 1.3-3 3v19c0-1.7 1.3-3 3-3h9z" fill="currentColor" opacity="0.55"/>
  <path d="M11 11.5h3M11 15h3M18 11.5h3M18 15h3" stroke="var(--b3-theme-background)" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>
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
                const view = (tab as unknown as {model?: {wenguView?: QuizView;};})?.model?.wenguView;
                view?.setDoc(targetDocId);
            },
        });

        this.addTopBar({
            icon: "iconWenguWords",
            title: this.i18n.wordBtn || "背单词",
            position: "right",
            callback: async () => {
                if (!this.activateWordDock()) {
                    await openTab({
                        app: this.app,
                        custom: {
                            icon: "iconWenguWords",
                            title: this.i18n.wordBtn || "背单词",
                            id: this.name + TAB_WORDS,
                        },
                    });
                }
            },
        });

        // 单词复习 Dock 面板（3.8.0 运行时支持，类型包未收录 → 局部声明）。
        const dockHost = this as unknown as {addDock?: (c: WordDockConfig) => unknown;};
        if (dockHost.addDock) {
            dockHost.addDock({
                type: TAB_WORDS,
                config: {
                    title: this.i18n.wordBtn || "背单词",
                    icon: "iconWenguWords",
                    index: 1000,
                    hotkey: "",
                },
                init: (custom) => this.mountWordView(custom),
                destroy: () => undefined,
            });
        }

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
                    plugin ?
                        {
                            load: () => plugin.loadData("quiz"),
                            save: (v) => plugin.saveData("quiz", v),
                        } :
                        undefined,
                    // 共享设置对象：设置页开关后页签立即跟随
                    plugin?.settings,
                    // N 刷会话历史（插件数据 history 文件）
                    plugin ?
                        new HistoryStore(
                            () => plugin.loadData("history"),
                            (h) => plugin.saveData("history", h),
                        ) :
                        undefined,
                    // 目录底部设置图标按钮 → 插件设置弹窗
                    plugin ? () => plugin.openSetting() : undefined,
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

        this.addTab({
            type: TAB_WORDS,
            init(this: Custom | MobileCustom) {
                const plugin = WenguPlugin.instance;
                if (plugin) plugin.mountWordView(this);
            },
            update(this: Custom | MobileCustom) {
                (this as any).wenguWordView?.render?.();
            },
            destroy() {
                (this as any).wenguWordView?.destroy?.();
            },
        });
    }

    /** 单词视图挂载（Dock 面板与兜底页签共用；WordStore 单例共享进度缓存）。 */
    private mountWordView(custom: {element?: Element;}): void {
        const el = custom.element as HTMLElement | undefined;
        if (!el || !WenguPlugin.instance) return;
        if (!this.wordStore) {
            this.wordStore = new WordStore(
                () => this.loadData("words"),
                (p) => this.saveData("words", p),
            );
        }
        const view = new WordView(el, this.i18n ?? {}, this.wordStore);
        (custom as unknown as {wenguWordView?: WordView;}).wenguWordView = view;
        view.bind();
        void view.render();
    }

    /** 激活背单词 Dock 面板；未注册/未布局返回 false 由页签兜底。 */
    private activateWordDock(): boolean {
        const full = this.name + TAB_WORDS;
        const layout = (window as unknown as {
            siyuan?: {layout?: {leftDock?: DockLike; rightDock?: DockLike; bottomDock?: DockLike;};};
        }).siyuan?.layout;
        const dock = [layout?.leftDock, layout?.rightDock, layout?.bottomDock]
            .find((d) => d && full in d.data);
        if (!dock) return false;
        dock.toggleModel(full);
        return true;
    }

    /** 设置 → 插件 → 温故：仿思源原生设置外观（左导航 + 分组条目）。 */
    openSetting() {
        openWenguSetting({
            i18n: this.i18n,
            pluginName: this.i18n.pluginName || this.name,
            version: (this as unknown as {manifest?: {version?: string;};}).manifest?.version ?? "0.1.0",
            settings: this.settings,
            onSettingsChange: () => this.activeView?.applySettings(),
        });
    }
}
