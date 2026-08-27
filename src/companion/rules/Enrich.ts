/**
 * AI 增强层的自适应节流（纯函数，无 IO，单测覆盖）。
 *
 * 做题事件不固定间隔，按用户答题节奏自适应（20260828 用户定稿）：
 * 节奏慢（平均 ≥60s/题）时每题都值得单独反应（间隔 0）；节奏快时
 * 压到两分半一次，避免逐题请求打爆智能体。批次完成事件（一轮刷题/
 * 一组单词收工）不设间隔、仅互斥——「每批必点评」是用户明确预期。
 * 样本不足（刚开始刷、窗口未攒出 2 个间隔）按快节奏保守处理。
 */

/** 慢节奏分界：平均答题间隔 ≥ 此值视为做题慢（每题触发）。 */
export const QUIZ_SLOW_PACE_MS = 60_000;

/** 快节奏下的最小触发间隔（两分半，用户口径「两三分钟」）。 */
export const QUIZ_FAST_GAP_MS = 150_000;

/** 节奏窗口：最近 N 次答题时间戳 → N-1 个相邻间隔取均值。 */
export const PACE_WINDOW = 5;

/** 答题节奏 → 做题事件的 AI 触发最小间隔（慢=0 每题触发）。 */
export function enrichGapMs(paceMs: number | undefined): number {
    return paceMs !== undefined && paceMs >= QUIZ_SLOW_PACE_MS ? 0 : QUIZ_FAST_GAP_MS;
}
