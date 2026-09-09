import WordApp from "./components/WordApp.svelte";
import { initialWordUi } from "./core/WordUi";
import type { WordStore } from "./core/WordStore";
import { WordView } from "./core/WordView";
import { mountSvelteApp } from "../ui/mountApp";

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

/** 挂载背单词面板（Dock 面板与兜底页签共用；WordStore 单例共享进度缓存）。
 *  控制器清理由 WordApp onMount 的 cleanup（view.destroy）承担，unmount
 *  只卸组件——与 mountApp.ts 的约定一致。 */
export function mountWordView(el: HTMLElement, i18n: Record<string, string>, store: WordStore): MountedWordView {
    // *.svelte 的环境声明不带实例导出类型，view 这里收口一次（KnowPicker 同款）
    const mounted = mountSvelteApp<WordAppProps>(WordApp, el, { i18n, store });
    const view = (mounted.app as { view: WordView }).view;
    return { view, unmount: mounted.unmount };
}

export { initialWordUi };
export type { WordUi } from "./core/WordUi";
export { WordView };
