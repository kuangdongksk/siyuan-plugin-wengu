/**
 * 「整页不滚动」（Issue #96 / 规范 §12）的宿主档位：**判定 + 开关**。
 *
 * 面板高度适配宿主视口、滚动收进面板内部的滚动窗，工作区主区不出页面级
 * 滚动条。落地四处咬合，本模块管前两处：
 *  ① 宿主主区经 `.wengu-ws-main--fit` 改写（flex 列 + `overflow:hidden`）
 *     ——**原始** `.wengu-ws-main` 的 `overflow-y:auto` 是四块管理面板共用的
 *     骨架，一个字都不动，这里只加一条更高特异性的覆写；
 *  ② 开/关在面板**挂载/卸载处配对**（`ai/SessionPanel.ts`），别散落；
 *  ③ 高度链在 `scss/aipanel.scss`（页根 → 卡 → 两列，每级 `min-height:0`
 *     + grid 行高 `auto minmax(0,1fr)`）；
 *  ④ 内滚窗落在**列**上（`scss/aipanel.scss` 的树列/详情列 + 窄窗折单列）。
 * 缺任一级，卡都拿不到「剩余高」⇒ 内滚窗不出现、整页照滚（本项目已回归两次：
 * 20260916 Issue #146）。
 *
 * ⚠️ **只动本面板那一份骨架**：主区容器是**共享骨架**（`renderWorkspaceFor`
 * 四分支共用一个 `<div data-ws-root>`，随整壳重建）。开了档而那块面板不收
 * 内滚 ⇒ 内容被 `overflow:hidden` 切掉且**滚不到**（比「整页滚」更坏）；
 * 反过来误关别人的档同理。故开关一律只在**挂载时拿到的那份宿主子树内**
 * 动作（`fitTargetOf`）——**禁 document 级全选**（一个文档里可能有不止一份
 * `.wengu-ws-main`：另一个温故页签）。越界的写法在单测里被假体记账断言挡下。
 *
 * ⚠️ **本机制只碰 `.wengu-ws-main` 这一层，不 emit 任何事件**：面板折单列
 * 后要重算内滚窗（`.wengu-aipanel.scroll 与 window resize`）在 ai 面板自己的
 * 视图层接线，别把别的面板的尺寸逻辑拖进来。
 */

import type { WenguWorkspace } from "../../quiz/render/RailMount";

/** 收内滚档的类名（与 scss/rail.scss 的
 *  `.wengu-ws-main.wengu-ws-main--fit` 规则逐字对应）。 */
export const WS_FIT_CLS = "wengu-ws-main--fit";

/** 主区骨架类（档位的挂点；`fitTargetOf` 认它）。 */
export const WS_MAIN_CLS = "wengu-ws-main";

/** 收内滚的工作区白名单（当前仅 AI 会话，见文件头注）。 */
const FIT_WORKSPACES: ReadonlySet<string> = new Set(["ai"]);

/** 本工作区是否收内滚（判定走纯函数，别在挂载处写死 "ai"）。 */
export function workspaceFits(ws: WenguWorkspace | string | undefined): boolean {
    return !!ws && FIT_WORKSPACES.has(ws);
}

/** 开关用到的最小元素契约：真机传 `HTMLElement`；单测传假体
 *  （本仓单测不带 DOM，vitest 环境为 node）。只声明实际用到的两件。 */
export interface FitEl {
    classList: { contains(c: string): boolean; toggle(c: string, on: boolean): void };
    querySelector(sel: string): FitEl | null;
}

/**
 * 本面板要收内滚的那**一份**主区：宿主自身即 `.wengu-ws-main` 时就是它
 * （`WorkspaceShell` 传的 `[data-ws-root]` 当前正是这个），否则退化为在
 * **宿主子树内**下探一次（壳结构将来多包一层也不越界）。找不到返回
 * undefined——宁可不收内滚（退化成整页滚），也不乱改别人的骨架。
 */
export function fitTargetOf(root: FitEl | undefined | null): FitEl | undefined {
    if (!root) return undefined;
    if (root.classList.contains(WS_MAIN_CLS)) return root;
    return root.querySelector(`.${WS_MAIN_CLS}`) ?? undefined;
}

/** 把档开/关到 `on`（el 为空零动作）。只碰传进来的这一个元素。 */
export function toggleFit(el: FitEl | undefined, on: boolean): void {
    el?.classList.toggle(WS_FIT_CLS, on);
}
