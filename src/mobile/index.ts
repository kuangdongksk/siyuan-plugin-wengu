import MobileApp from "./components/MobileApp.svelte";
import { MobileDrill } from "./core/MobileDrill";
import type { MobileDeps } from "./types";
import { mountSvelteApp, type MountedSvelteApp } from "../ui/mountApp";

/**
 * 移动端刷题域入口（Issue #59）：dock 面板挂载编排。
 *
 * 思源移动端没有可用的 `openTab`（插件 API 的 MOBILE 分支是空桩），
 * 唯一能承载插件界面的通道是 dock（`addDock` 被包装成 mobileModel，
 * init/destroy 生命周期与桌面 Custom 同构 ⇒ 挂载链零改动兼容）。
 * 本域只做「仅刷题」：管理类功能（转换 / rail 工作区 / 统计 / 词书）
 * 不进移动端。
 *
 * 桌面零回归：本域不在桌面挂载路径上（index.ts 按 `isMobileUi()` 分流），
 * 且样式一律写成 `.wengu-mobile` 后代选择器——无标记时逐字节不变。
 */

/** 挂载移动端刷题面板（dock init）。 */
export function mountMobileDrill(el: HTMLElement, deps: MobileDeps): MountedSvelteApp<{ drill: MobileDrill }> {
    // 控制器在壳组件里创建（$state 深代理只能在 Svelte 编译单元生成）；
    // 装载在壳 onMount 里起——见 components/MobileApp.svelte。
    // *.svelte 的环境声明不带实例导出类型，这里收口一次（KnowPicker 同款）
    return mountSvelteApp(MobileApp, el, { deps }) as unknown as MountedSvelteApp<{ drill: MobileDrill }>;
}

export { MobileDrill };
export type { MobileDeps };
