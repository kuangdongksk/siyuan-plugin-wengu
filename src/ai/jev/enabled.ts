/**
 * Jev 总闸（Issue #183 需求 5）：**全插件唯一的开关判据**，后续所有落点
 * （转换质检 / 切片预筛 / 填空判等 / 同义词判定…）一律从这里出。
 *
 * 口径：key 为空 **或** 开关关 → false（缺省视为开：只有用户显式关掉才关）。
 * 注意这是**能力闸**，不是「该不该发这一笔」的业务判据——各落点仍在
 * 判定失败/低置信时回落现状（规划稿 §二 纪律 2）。
 *
 * 与 UI 的关系：仅依赖设置项的两个可选字段（不 import ui 域），
 * 故 node 单测可直接调用，且未配置 key 时全插件行为零变化。
 */

/** 总闸所需的最小设置面（`WenguSettingsShape` 的子集，避免 ui 域依赖）。 */
export interface JevSettingsLike {
    /** Jev key（空/未填 = 未启用）。 */
    jevKey?: string;
    /** 总开关（undefined 视为开）。 */
    jevEnabled?: boolean;
}

/** Jev 是否可用：key 非空且开关未关。 */
export function isJevEnabled(settings: JevSettingsLike | undefined): boolean {
    if (!settings) return false;
    if (settings.jevEnabled === false) return false;
    return typeof settings.jevKey === "string" && settings.jevKey.trim() !== "";
}
