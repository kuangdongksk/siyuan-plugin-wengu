import {
    Plugin,
    Setting,
    openTab,
    getActiveEditor,
    type Custom,
    type MobileCustom,
} from "siyuan";
import "./index.scss";
import {HistoryStore} from "./wengu/HistoryStore";
import {QuizView} from "./wengu/QuizView";

/** 页签 type。openTab 的 custom.id 会拼成 plugin.name + type，addTab 用同 type 匹配。 */
const TAB_RESULT = "wengu-tab";

/** 打开页签时记录的目标文档 id（addTab 回调读不到 Tab.data，用模块级传递）。 */
let targetDocId = "";

/** 插件设置（loadData/saveData("settings") 持久）。 */
interface WenguSettings {
    /** 题目区左侧是否显示题号导航。 */
    showNums: boolean;
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
    settings: WenguSettings = {showNums: true};
    /** 当前打开的刷题视图（设置变更时通知重渲染）。 */
    activeView: QuizView | undefined;

    async onload() {
        WenguPlugin.instance = this;
        try {
            const saved = await this.loadData("settings") as Partial<WenguSettings> | "" | null | undefined;
            if (saved && typeof saved === "object") this.settings = {...this.settings, ...saved};
        } catch (_) {
            // 读不到就按默认
        }
        this.addIcons(`<symbol id="iconWengu" viewBox="0 0 32 32">
  <path d="M4 6h10a4 4 0 0 1 4 4v16a3 3 0 0 0-3-3H4z" fill="currentColor"/>
  <path d="M28 6H18a4 4 0 0 0-4 4v16a3 3 0 0 1 3-3h11z" fill="currentColor" opacity="0.55"/>
  <path d="M13 15.5l2.2 2.2 4.3-4.6" fill="none" stroke="var(--b3-theme-background)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
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

    /** 设置 → 插件 → 温故：显示题号开关（保存后立即作用于已打开的页签）。 */
    openSetting() {
        const setting = new Setting({width: "520px", height: "auto"});
        setting.addItem({
            title: this.i18n.settingShowNums,
            description: this.i18n.settingShowNumsDesc,
            createActionElement: () => {
                const input = document.createElement("input");
                input.className = "b3-switch fn__flex-center";
                input.type = "checkbox";
                input.checked = this.settings.showNums;
                input.addEventListener("change", () => {
                    this.settings.showNums = input.checked;
                    void this.saveData("settings", {...this.settings});
                    this.activeView?.applySettings();
                });
                return input;
            },
        });
        this.setting = setting;
        setting.open(this.i18n.pluginName);
    }
}
