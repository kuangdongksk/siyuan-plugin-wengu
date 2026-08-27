import { mount, unmount, type Component } from "svelte";

/**
 * Svelte 挂载帮手（各域渐进 Svelte 化的公共地基，模式见
 * docs/svelte-migration.md）：收敛「mount → 持有实例 → unmount」的
 * 域内手写样板。约定控制器清理由根组件 onMount 的 cleanup 返回函数
 * 负责（WordApp 先例），本帮手只管挂载与卸载，不感知控制器。
 */

/** 挂载结果：app=根组件实例（可读 `export const view` 等实例导出）。 */
export interface MountedSvelteApp<E = unknown> {
    app: E;
    unmount(): void;
}

/** 挂载一个根组件（props 缺省为空对象）；卸载统一走返回的 unmount。 */
export function mountSvelteApp<P extends Record<string, any>, E = unknown>(
    root: Component<P, E>,
    el: HTMLElement,
    props?: P
): MountedSvelteApp<E> {
    const app = mount(root, { target: el, props: (props ?? {}) as P });
    return { app, unmount: () => unmount(app) };
}
