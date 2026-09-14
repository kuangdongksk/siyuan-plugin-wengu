/**
 * 材料区限高内滚判定（Issue #87 纯逻辑层，带单测）。
 *
 * 背景：阅读面（材料组，`#81` 落地、`#83` 改结构判据）在**长材料**下把
 * 题目挤出视口——英语真题一篇阅读 4 段 400+ 词，材料区占满整屏，用户要
 * 来回滚整页（看一半滚下去答题、再滚回来看材料）。
 *
 * 对策：材料区**限高 + 内部滚动**，下缘一条渐隐分界线提示「下面还有内容」。
 *
 * 本模块只出**两个判定**（DOM 层只许接这两个结论，不各自写一份）：
 * - `materialScrollCap`：要不要限高（= 内容是否真的溢出）——`0` 表示**不
 *   限高**（短材料自然展开，产物与改造前逐字节同形）；
 * - `fadeVisible`：渐隐显隐判定（Issue #87 验收 2）——**只有「还能往下滚」
 *   才显示**。滚到底/滚到一半但内容已尽都不显示。
 *
 * ⚠️ 限高值走 CSS 的 `--wengu-mat-cap`（视口比例），JS **不重复计算像素**：
 * 这里的 `clientHeight/scrollHeight` 读的正是限高生效后的布局尺寸，
 * CSS 改比例时本判定自动跟随，不存在两处口径漂移。
 */

/** 溢出判定的取整容差（px）：`scrollHeight` 是整数、有的缩放比下
 *  `clientHeight` 带小数，亚像素差会让「刚好不溢出」的短材料误挂滚动条。
 *  1px 远小于任何一行的行高，不会把「最后一行差 1px 露不全」判成不溢出。 */
const EPS = 1;

/** 材料区是否需要限高内滚（`0` = 不限高）。内容未溢出视口的材料
 *  （短材料、折叠后重新展开前的量算）一律判 0 —— 宁可不滚也不错滚。 */
export function materialScrollCap(el: { clientHeight: number; scrollHeight: number }): 0 | 1 {
    if (el.scrollHeight - el.clientHeight > EPS) return 1;
    return 0;
}

/** 渐隐分界线是否可见：**只有「下方还有内容」才显示**。
 *  `el` 走当前几何（`scrollTop + clientHeight < scrollHeight`），已滚到底
 *  （或内容不足一屏）即隐藏——「下面还有内容可滚」是这条提示的全部语义，
 *  内容读完了还留着它就是在骗人。 */
export function fadeVisible(el: { scrollTop: number; clientHeight: number; scrollHeight: number }): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight > EPS;
}
