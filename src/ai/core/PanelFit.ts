/**
 * 「整页不滚动」的宿主档位判定（Issue #96，纯逻辑带单测）。
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
 * ⚠️ **档位是按工作区选的，不是按面板**：主区容器是**共享骨架**
 * （`renderWorkspaceFor` 四分支共用一个 `<div data-ws-root>`），挂载/卸载
 * 必须在同一处配对开关——漏关（或反过来不开）会让下一块面板继承上一个
 * 面板的档：开了档而面板不收内滚 ⇒ 内容被 `overflow:hidden` 切掉且**滚不
 * 到**（比「整页滚」更坏）。
 *
 * 本单只把 AI 会话面板列为收内滚（Issue #96 范围外明示：其余管理面板的
 * 迁移等用户另行发话，规范是总则）。新增面板要收内滚时，**改本表**并把
 * 面板页根补上 `.wengu-aipage` 与对应 scss（树/详情两列各自内滚）。
 */

import type { WenguWorkspace } from "../../quiz/render/RailMount";

/** 宿主主区上的「收内滚」档类（scss/rail.scss 的
 *  `.wengu-ws-main.wengu-ws-main--fit` 规则与之逐字对应）。 */
export const WS_FIT_CLS = "wengu-ws-main--fit";

/** 收内滚的工作区白名单（当前仅 AI 会话，见文件头注）。 */
const FIT_WORKSPACES: ReadonlySet<string> = new Set(["ai"]);

/** 该工作区的主区是否收内滚（= 高度链打通、滚动收进面板内部滚动窗）。 */
export function workspaceFits(ws: WenguWorkspace | string | undefined): boolean {
    return !!ws && FIT_WORKSPACES.has(ws);
}
