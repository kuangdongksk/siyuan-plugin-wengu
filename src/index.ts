import {Plugin, openTab, getActiveEditor, type Custom, type MobileCustom} from "siyuan";
import "./index.scss";
import {QuizView} from "./wengu/QuizView";

/** 页签 type。openTab 的 custom.id 会拼成 plugin.name + type，addTab 用同 type 匹配。 */
const TAB_RESULT = "wengu-tab";

/** 打开页签时记录的目标文档 id（addTab 回调读不到 Tab.data，用模块级传递）。 */
let targetDocId = "";

/**
 * 温故 —— 刷题 · 错题复习 · 题目与笔记联动
 *
 * 顶栏 `温故` 按钮 → openTab 打开自定义页签（addTab 注册，同 type）。
 * 页签内容由 QuizView 渲染：题目列表 ↔ 单题答题，客观题自动判分。
 */
export default class WenguPlugin extends Plugin {
    /** 单例缓存，供 addTab 回调在拿不到插件实例时取 i18n。 */
    static instance: WenguPlugin | undefined;

    onload() {
        WenguPlugin.instance = this;
        this.addIcons(`<symbol id="iconWengu" viewBox="0 0 32 32">
<path d="M4 6h10a4 4 0 0 1 4 4v16a3 3 0 0 0-3-3H4z" fill="currentColor"/>
<path d="M28 6H18a4 4 0 0 0-4 4v16a3 3 0 0 1 3-3h11z" fill="currentColor" opacity="0.55"/>
<path d="M13 15.5l2.2 2.2 4.3-4.6" fill="none" stroke="var(--b3-theme-background)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</symbol>`);

        this.addTopBar({
            icon: "iconWengu",
            title: this.i18n.pluginName,
            position: "right",
            callback: () => {
                // 记录当前活动文档，页签据此渲染该文档的题目
                const editor = getActiveEditor();
                targetDocId = editor?.protyle.block.rootID ?? "";
                openTab({
                    app: this.app,
                    custom: {
                        icon: "iconWengu",
                        title: this.i18n.pluginName,
                        id: this.name + TAB_RESULT,
                    },
                });
            },
        });

        this.addTab({
            type: TAB_RESULT,
            init(this: Custom | MobileCustom) {
                const i18n = WenguPlugin.instance?.i18n ?? {};
                const view = new QuizView(this.element as HTMLElement, i18n, targetDocId);
                (this as any).wenguView = view;
                view.render();
            },
            update(this: Custom | MobileCustom) {
                (this as any).wenguView?.render?.();
            },
            destroy() {
            },
        });
    }
}