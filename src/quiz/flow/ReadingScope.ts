import type { QuestionBank } from "../../bank/data/QuestionBank";
import { peekSetTypeUnion } from "../../bank/data/BankSets";
import { isEnglishTypes } from "./AnnoScope";
import type { WenguQuestion } from "../../types";

/**
 * 阅读面作用域判定（Issue #81 纯逻辑层，单测覆盖）——「材料区改阅读面
 * + 题卡间距阶梯」是**英语卷专属**视觉：`.wengu-reading` 只许挂在英语卷
 * 的渲染产物上，数学卷/政治卷的组题若被误挂会得到衬线正文与英语阅读的
 * 间距阶梯（外观回归）。
 *
 * 判定口径与 Issue #45 的「标生词」卷级判定**同源**（`isEnglishTypes`）：
 * 题级判不开（英语阅读的 single 与数学单选都是 single），只能看该卷的
 * **题型并集**里有没有英语四类（cloze/match/essay/trans）任一。
 *
 * 本模块是**唯一判定点**：两条渲染链（字符串壳 `CardHtml.renderMainShell`
 * 与 Svelte 组单元 `GroupUnitApp`）都只消费它的返回值，不许各写一份。
 */

/**
 * 给定题列表所在卷是否英语卷（阅读面作用域判定）。
 *
 * 取用**同步窥视**（`bank.peek()`）——壳渲染是同步路径（Issue #46 审查：
 * 渲染期任何 await 会把壳落推后到微任务、破坏一众同步调用方），不能查库。
 * 题库已装载即当场判定；未装载/反查不到题集 ⇒ **false**（宁窄勿宽：
 * 「非英语卷逐字节不变」比「英语卷早一帧出阅读面」重要得多）。
 *
 * `list` 的门径与 `buildSetGroups` 一致（`q.rootId` = 源题集 id，
 * `setQuestions` 落解析时已归位）：取**首题**所在卷。字符串壳的一次判定
 * 传**整卷**，组单元传**组内题**——聚合/专题混合刷下多集各拼一段时，按
 * 各自范围判（与题集分组口径同构）。
 */
export function readingScopeOf(list: readonly WenguQuestion[], bank?: QuestionBank): boolean {
    const setId = list[0]?.rootId ?? "";
    if (!setId || !bank) return false;
    if (!bank.peek()) return false;
    return isEnglishTypes(peekSetTypeUnion(bank, setId));
}
