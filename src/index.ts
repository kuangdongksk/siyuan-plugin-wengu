import {Plugin, type Custom, type MobileCustom} from "siyuan";
import "./index.scss";

const DOCK_TYPE = "wengu";

/**
 * 温故 —— 刷题 · 错题复习 · 题目与笔记联动
 *
 * 骨架阶段：注册顶栏入口与右侧 dock 面板。
 * 后续在此挂载刷题（考试模式）、错题队列与统计视图。
 */
export default class WenguPlugin extends Plugin {
    onload() {
        const plugin = this;
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
                // TODO: 打开刷题面板（考试模式）
            },
        });

        this.addDock({
            config: {
                position: "RightBottom",
                size: {width: 360, height: 0},
                icon: "iconWengu",
                title: this.i18n.pluginName,
                hotkey: "",
            },
            data: {},
            type: DOCK_TYPE,
            resize() {
            },
            update() {
            },
            init(this: Custom | MobileCustom) {
                this.element.innerHTML = `<div class="wengu-dock">${plugin.i18n.welcome}</div>`;
            },
        });
    }
}
