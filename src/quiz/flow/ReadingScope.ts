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
 * - **组单元**（`GroupUnitApp`）：自身就是材料组 ⇒ 根元素**静态**带
 *   `.wengu-reading`（不消费壳层传值、零学科依赖）；
 * - **整壳题卡列表**（`.wengu-card-list.wengu-reading`）：**全部单元都是
 *   材料组单元**时才挂（纯材料/一题多问卷 ⇒ 产物与改造前同形、零包装）；
 *   混合（聚合「全部习题」/跨学科专题、或同卷既有独立题又一题多问）下
 *   不挂整壳，改由 `wrapPlanOf` 出逐单元包装计划——**独立题卡始终
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
 * 阶梯），故改由 `wrapPlanOf` 出逐单元包装计划。
 */
export function readingShellScope(units: readonly DrillUnit[]): boolean {
    return units.length > 0 && units.every(isReadingUnit);
}

/**
 * **包装计划**（Issue #83，渲染层施工的唯一依据）：逐单元给出**包装序号**
 * ——`-1` = 落在外层（不带类名、不多套 DOM），`>=0` = 落进第 n 个
 * `.wengu-set-seg.wengu-reading` 包装（序号单调递增、按首次出现分配）。
 *
 * 三条口径（缺一条就是真机可见的顺序/作用域缺陷）：
 * - **整壳已覆盖 ⇒ 全 -1**：整卷都是材料组单元时 `.wengu-card-list` 自己
 *   就带类名（产物与改造前同形），一个包装都不加；
 * - **只在材料组单元上开包装**：独立题单元一律 -1（`wengu-reading` 的样式
 *   全是后代选择器，它落在外层、祖先链上没有该类 ⇒ 零装饰）；
 * - ⚠️ **连续且同段（`segOf` 相同）才复用同一个包装**：题集标题行插在
 *   包装**外**，跨段复用会让后一段的标题行落在复用包装**之后**、而该段首题
 *   被追加进复用包装（在标题行**前**）——真机表现「第二套的题跑到它自己那
 *   行题集标题上面去了」，两套的材料组还挤进同一个包装里。故段界必须断链。
 *
 * `segOf` = 各单元的题集段下标（`buildSetGroups` 的段序），与 `units` 等长；
 * 越界/缺省按 -1 段（同段兜底，不影响「跨段断链」这条性质）。
 */
export function wrapPlanOf(units: readonly DrillUnit[], segOf: readonly number[]): number[] {
    const shell = readingShellScope(units);
    const plan: number[] = [];
    // counter=下一个待分配的包装序号；openOrdinal/openSeg=当前**仍可复用**的
    // 包装（-1=不处于可复用态）。两者分开：复用标记归零后序号仍须单调。
    let counter = 0;
    let openOrdinal = -1;
    let openSeg = Number.NaN;
    for (let i = 0; i < units.length; i++) {
        if (shell || !isReadingUnit(units[i])) {
            openOrdinal = -1;
            plan.push(-1);
            continue;
        }
        const seg = segOf[i] ?? -1;
        if (openOrdinal < 0 || seg !== openSeg) {
            openOrdinal = counter++;
            openSeg = seg;
        }
        plan.push(openOrdinal);
    }
    return plan;
}
