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

/** 壳组件的实例导出面（`MobileApp.svelte` 的 `export const ctl`）。
 *  ⚠️ 键名必须与组件**逐字一致**：dock destroy 的兜底路靠它取控制器
 *  （Issue #173——此前这里声明成 `drill`、`Docks` 也读 `app.drill`，
 *  与组件的 `ctl` 错位 ⇒ 取到 `undefined`，兜底路整条**静默死掉**，
 *  而 `as unknown as` 双重断言把这处不一致声明成了合法类型）。
 *  ⚠️ `*.svelte` 的环境声明不带实例导出类型，故此处仍要收口一次
 *  （KnowPicker 同款）——收口后**键名由 `RoundReport.contract.test.ts`
 *  的源级断言锁住**，别再靠断言自证。 */
export interface MobileAppExports {
    ctl: MobileDrill;
}

/** 挂载移动端刷题面板（dock init）。 */
export function mountMobileDrill(el: HTMLElement, deps: MobileDeps): MountedSvelteApp<MobileAppExports> {
    // 控制器在壳组件里创建（$state 深代理只能在 Svelte 编译单元生成）；
    // 装载在壳 onMount 里起——见 components/MobileApp.svelte。
    const mounted = mountSvelteApp(MobileApp, el, { deps });
    return { app: mounted.app as unknown as MobileAppExports, unmount: mounted.unmount };
}

export { MobileDrill };
export type { MobileDeps };
