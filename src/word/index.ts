import { mount, unmount } from "svelte";
import WordApp from "./comp/WordApp.svelte";
import { initialWordUi } from "./core/WordUi";
import type { WordStore } from "./core/WordStore";
import { WordView } from "./core/WordView";

/**
 * 单词域入口：Dock/页签的挂载编排（Svelte 化改造）。控制器本体在
 * WordView.ts（会话状态机 + 语义动作），渲染组件在 comp/，响应态形状
 * 在 WordUi.ts——三者由 WordApp.svelte 组装（$state 代理只能在
 * Svelte 编译单元里创建，故挂载入口在此收敛）。
 */

/** WordApp 组件入参形状。 */
export interface WordAppProps {
    i18n: Record<string, string>;
    store: WordStore;
}

/** Svelte 挂载结果：控制器 + 卸载函数（Dock destroy 时调用）。 */
export interface MountedWordView {
    view: WordView;
    unmount: () => void;
}

/** 挂载背单词面板（Dock 面板与兜底页签共用；WordStore 单例共享进度缓存）。 */
export function mountWordView(el: HTMLElement, i18n: Record<string, string>, store: WordStore): MountedWordView {
    const app = mount(WordApp, {
        target: el,
        props: { i18n, store } satisfies WordAppProps,
    });
    const view = (app as { view: WordView }).view;
    return {
        view,
        unmount: () => {
            view.destroy();
            unmount(app);
        },
    };
}

export { initialWordUi };
export type { WordUi } from "./core/WordUi";
export { WordView };
