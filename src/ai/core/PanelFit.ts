/**
 * 「整页不滚动」的宿主档位判定与开关（Issue #96，纯逻辑带单测）。
 *
 * 规范第 11 条（docs/design-review.md §〇）：面板高度一律适配宿主视口，
 * 滚动收进面板**内部的滚动窗**（长列表列 / 详情区各自内滚），工作区主区
 * 不出现页面级滚动条。
 *
 * 宿主 `.wengu-ws-main`（scss/rail.scss）是**共用骨架**：它自带
 * `overflow-y:auto`，其余管理面板（专题/知识/统计/学伴）都靠它自滚——
 * 那条声明一个字都不能动。收内滚的面板经 `.wengu-ws-main--fit` 一档改写
 * 主区（改 flex 列 + `overflow:hidden`），高度链才能从主区传到面板内的卡。
 *
 * ⚠️ **档位是按工作区选的，且只动本面板那一份**：主区容器是**共享骨架**
 * （`renderWorkspaceFor` 四分支共用一个 `<div data-ws-root>`，随整壳重建），
 * 挂载/卸载必须在同一处配对开关——漏关（或反过来不开）会让下一块面板继承
 * 上一个面板的档：开了档而面板不收内滚 ⇒ 内容被 `overflow:hidden` 切掉且
 * **滚不到**（比「整页滚」更坏）。
 *
 * ⚠️⚠️ **禁 document 级全选**（20260915 复审修正）：`.wengu-ws-main` 在一个
 * 文档里**不一定只有本面板一份**（另一个温故页签、将来新增的收内滚面板都
 * 可能带一个）。全局 `querySelectorAll` 会把**别的面板**的同名骨架一并改
 * 成 flex 列 + `overflow:hidden`——那块面板不收内滚，内容被切且滚不到，
 * 正是上面点名要避免的坏形态；卸载时的 `false` 同理会把别人的档误关。
 * 故开关一律**只在挂载时拿到的那份宿主子树内**动作（`fitTargetOf`），
 * 越界的写法在单测里被假体记账断言挡下。
 *
 * 本单只把 AI 会话面板列为收内滚（Issue #96 范围外明示：其余管理面板的
 * 迁移等用户另行发话，规范是总则）。新增面板要收内滚时，**改本表**并把
 * 面板页根补上 `.wengu-aipage` 与对应 scss（树/详情两列各自内滚）。
 */

import type { WenguWorkspace } from "../../quiz/render/RailMount";

/** 宿主主区上的「收内滚」档类（scss/rail.scss 的
 *  `.wengu-ws-main.wengu-ws-main--fit` 规则与之逐字对应）。 */
export const WS_FIT_CLS = "wengu-ws-main--fit";

/** 主区骨架类（档位的挂点；`fitTargetOf` 认它）。 */
export const WS_MAIN_CLS = "wengu-ws-main";

/** 收内滚的工作区白名单（当前仅 AI 会话，见文件头注）。 */
const FIT_WORKSPACES: ReadonlySet<string> = new Set(["ai"]);

/** 该工作区的主区是否收内滚（= 高度链打通、滚动收进面板内部滚动窗）。 */
export function workspaceFits(ws: WenguWorkspace | string | undefined): boolean {
    return !!ws && FIT_WORKSPACES.has(ws);
}

/** 收内滚开关用到的最小元素契约：真机传 `HTMLElement`；单测传假体
 *  （本仓单测不带 DOM，vitest 环境为 node）。只声明实际用到的两件。 */
export interface FitEl {
    classList: { contains(c: string): boolean; toggle(c: string, on: boolean): void };
    querySelector(sel: string): FitEl | null;
}

/**
 * 本面板要收内滚的那**一份**主区：宿主自身即 `.wengu-ws-main` 时就是它
 * （`WorkspaceShell` 传的 `[data-ws-root]` 当前正是这个），否则退化为在
 * **宿主子树内**下探一次（壳结构将来多包一层也不越界）。找不到返回
 * undefined——宁可不收内滚（退化成现状整页滚），也不乱改别人的骨架。
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
