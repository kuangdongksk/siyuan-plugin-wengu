import type { DrillUnit } from "../render/DrillUnits";

/**
 * 阅读面作用域判定（Issue #81 纯逻辑层，Issue #83 **改结构判据**，单测覆盖）。
 *
 * 阅读面（材料区改凹槽阅读栏 + 衬线正文 + ¶ 段落序号 + 题卡间距阶梯）
 * 的判据是**材料组结构**，与学科/题型**零关系**——材料组（阅读组单元 =
 * 材料块 + 依附小题，即「一题多问」）是**全学科通用结构**：英语（阅读
 * 理解/完形）、语文（文言文阅读）、政治（材料分析）、历史（史料阅读）、
 * 工科/数学（题干带背景材料的大题）都产出材料组。
 *
 * ⚠️ **#81/#82 把阅读面绑在「英语卷判别」上是修错方向**（#83 根因）：
 * 题型是**作答形态**不是学科，拿它当学科代理任何方向都判不准——「英语
 * 阅读训练卷全是 single」漏判、「语文卷的作文 essay + 文言文翻译 trans」
 * 误判；更要命的是**判别不出英语时材料组结构还在，美化却没了**。英语
 * 判别（`AnnoScope.isEnglishScope`）从此**只服务「标生词」**这一语言
 * 专属功能，不再决定任何视觉。
 *
 * **唯一真判据 = 单元是不是材料组单元**（`isReadingUnit`）：
 * - **组单元**（`GroupUnitApp`）：自身就是材料组 ⇒ **无条件**挂
 *   `.wengu-reading`（组件内写死 true，不消费壳层传值、零学科依赖）；
 * - **整壳题卡列表**（`.wengu-card-list.wengu-reading`）：**全部单元都是
 *   材料组单元**时才挂（纯材料/一题多问卷 ⇒ 产物与改造前同形、零包装）；
 *   混合（聚合「全部习题」/跨学科专题、或同卷既有独立题又一题多问）下
 *   不挂整壳，改由 `scopedUnits` 逐个包装材料组单元——**独立题卡始终
 *   零装饰**（`wengu-reading` 的样式全是后代选择器，类挂在哪个祖先决定
 *   作用域，故独立题卡所在的祖先链上没有它）。
 *
 * 段（题集）只是**边界**：`buildSetGroups` 的连续题集段是「一题集一域」，
 * 段内单元归属同一题集，故「该段/该题集含材料组」在落点上就等价于
 * 「该段的材料组单元挂类」——本模块按单元判定即同时满足两者，且比按段
 * 整段包装更精确（不会把同段的独立题卡一起染上阅读面）。
 */

/**
 * 单元级阅读面判定（**唯一真判据**）：材料组单元（`kind === "group"`，
 * 即带材料块 + 依附小题的「一题多问」）判真，独立题（数学单选/填空）
 * 判假。**不吃任何学科/题型输入**——正是 #83「零学科依赖」的回归锁。
 */
export function isReadingUnit(u: DrillUnit): boolean {
    return u.kind === "group";
}

/**
 * 单元的**整卷题下标**（独立题=`idx`，材料组=组内首题；空单元 -1）——
 * 与 `buildSetGroups` 的 `start` 同口径（题集标题行落位也用它）。
 */
export function unitStartIdx(u: DrillUnit): number {
    return u.kind === "group" ? (u.qs?.[0]?.idx ?? -1) : (u.idx ?? -1);
}

/**
 * **整壳类名**口径（Issue #83）：题卡列表挂 `.wengu-reading` 的条件 =
 * **全部单元都是材料组单元且非空**。
 *
 * 满足时整卷每一处都是材料组 ⇒ 直接挂整壳、一个包装都不加（渲染产物
 * 与改造前同形，`.wengu-card-list.wengu-reading`）；不满足（含独立题
 * 单元）时**不挂**——挂上去会让独立题卡也吃到阅读面（衬线正文/间距
 * 阶梯），故改由 `scopedUnits` 逐个包装。
 */
export function readingShellScope(units: readonly DrillUnit[]): boolean {
    return units.length > 0 && units.every(isReadingUnit);
}

/**
 * **需逐个包装**的单元下标（Issue #83）：整壳类名已覆盖全部单元时为空
 * （零包装 ⇒ 默认渲染产物逐字节不变）；否则只列材料组单元——独立题单元
 * 既不带类名也不多套一层 DOM。
 */
export function scopedUnits(units: readonly DrillUnit[]): number[] {
    if (readingShellScope(units)) return [];
    const out: number[] = [];
    for (let i = 0; i < units.length; i++) if (isReadingUnit(units[i])) out.push(i);
    return out;
}
