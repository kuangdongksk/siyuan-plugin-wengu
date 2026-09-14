import type { QuestionBank } from "../../bank/data/QuestionBank";
import { peekSetSubject, peekSetTypeUnion } from "../../bank/data/BankSets";
import { isEnglishScope } from "./AnnoScope";
import type { WenguQuestion } from "../../types";

/**
 * 阅读面作用域判定（Issue #81 纯逻辑层，单测覆盖）——「材料区改阅读面
 * + 题卡间距阶梯」是**英语卷专属**视觉：`.wengu-reading` 只许挂在英语卷
 * 的渲染产物上，数学卷/政治卷的组题若被误挂会得到衬线正文与英语阅读的
 * 间距阶梯（外观回归）。
 *
 * 判定口径与 Issue #45 的「标生词」卷级判定**同源**（`AnnoScope.isEnglishScope`
 * 的两级口径，Issue #83）：**有学科以学科为准、无学科回退题型并集**。
 * 题级判不开（英语阅读的 single 与数学单选都是 single），只能看**卷**。
 *
 * 本模块是**唯一判定点**：两条渲染链（字符串壳 `CardHtml.renderMainShell`
 * 与 Svelte 组单元 `GroupUnitApp`）都只消费它的返回值，不许各写一份。
 * 混合刷按 `buildSetGroups` 的**连续题集段**逐段判（readingSegmentsOf）。
 */

/**
 * 单卷英语判定（阅读面作用域判定的**唯一计算体**，Issue #83 两级口径）：
 * 有学科以学科为准（`peekSetSubject`）、无学科回退题型并集
 * （`peekSetTypeUnion`），见 AnnoScope.isEnglishScope。
 *
 * 取用**同步窥视**（`bank.peek()`）——壳渲染是同步路径（Issue #46 审查：
 * 渲染期任何 await 会把壳落推后到微任务、破坏一众同步调用方），不能查库。
 * 题库已装载即当场判定；未装载/反查不到题集 ⇒ **false**（宁窄勿宽：
 * 「非英语卷逐字节不变」比「英语卷早一帧出阅读面」重要得多）。
 */
export function readingScopeOfSet(setId: string | undefined, bank?: QuestionBank): boolean {
    if (!setId || !bank) return false;
    if (!bank.peek()) return false;
    return isEnglishScope(peekSetSubject(bank, setId), peekSetTypeUnion(bank, setId));
}

/**
 * 给定题列表所在卷是否英语卷（**单卷口径**）：取**首题**所在卷
 * （`q.rootId` = 源题集 id，`setQuestions` 落解析时已归位）。
 *
 * ⚠️ 多集合刷（聚合「全部习题」/跨学科专题）下这只是「首题那一段」的
 * 判定，**不能**拿来当整壳的作用域（Issue #83 的作用域级缺陷即此）——
 * 混合刷一律走 readingSegmentsOf 按段判。
 */
export function readingScopeOf(list: readonly WenguQuestion[], bank?: QuestionBank): boolean {
    return readingScopeOfSet(list[0]?.rootId, bank);
}

/**
 * **段级**英语判定（Issue #83）：按 `buildSetGroups` 的连续题集段逐段各判
 * 各的卷（数组与 groups 等长、同序）。聚合/跨学科专题混合刷下英语段挂
 * 阅读面、数学段不挂，两段各自正确。
 *
 * 调用侧两条口径：
 * - 整壳作用域 = 段判定**全为真**才把 `.wengu-reading` 挂到题卡列表上
 *   （单段时逐字等价于 readingScopeOf；混合刷下数学段不被英语段的类名
 *   波及）；
 * - 组单元/单卡段的作用域由本数组逐段给出（组单元挂自己那段，见
 *   GroupUnitApp 的 m.reading）。
 */
export function readingSegmentsOf(groups: readonly { setId: string }[], bank?: QuestionBank): boolean[] {
    return groups.map((g) => readingScopeOfSet(g.setId, bank));
}

/**
 * **整壳类名**口径（Issue #83）：题卡列表挂 `.wengu-reading` 的条件 =
 * 段判定**全为真且非空**。
 *
 * 单题集（一段）⇒ 逐字等价于改造前的「首题所在卷判定」；混合刷下英语段
 * 与数学段并存 ⇒ 不挂整壳类名（否则数学段被英语段的类名波及），改由
 * scopedSegments 逐段包装各挂各的；全段皆英语的混合刷 ⇒ 直接挂整壳，
 * 省掉一层包装。
 */
export function readingShellScope(segs: readonly boolean[]): boolean {
    return segs.length > 0 && segs.every(Boolean);
}

/**
 * **需逐段包装**的段下标（Issue #83）：整壳类名已覆盖全部段时为空（单段
 * 与「全段皆英语」两种情形，一个包装都不加 ⇒ 默认渲染产物逐字节不变）；
 * 否则只列英语段——非英语段既不带类名也不多套一层 DOM。
 */
export function scopedSegments(segs: readonly boolean[]): number[] {
    if (readingShellScope(segs)) return [];
    const out: number[] = [];
    for (let i = 0; i < segs.length; i++) if (segs[i]) out.push(i);
    return out;
}
