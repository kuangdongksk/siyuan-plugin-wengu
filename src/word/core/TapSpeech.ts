/**
 * 听音卡自动播报的**落点**决策（Issue #10）：iOS 上 speechSynthesis 的首次
 * 播放必须在用户手势的同步调用栈里，脱离手势的调用（微任务/定时器里）会被
 * 系统静默丢弃。原来的自动播放在组件 `$effect`（微任务）里，移动端等于没声。
 *
 * 判定收口于此：
 * - **移动端 → 控制器 enterPrompt 的同步栈**。enterPrompt 由换卡动作同步
 *   调用——用户点「下一个/档位/选项」的 click 链路里，直接就在手势内；
 *   非手势路径（AI 刷新重进等）调用失败也只是静默，与改造前一致。
 * - **桌面 → 组件 $effect**（进卡即播），与改造前逐字同行为。
 * 两侧互斥，不会双播。
 */

/** 自动播报的落点（纯函数，单测锁）。 */
export function autoSpeakSite(mobile: boolean): "enterPrompt" | "effect" {
    return mobile ? "enterPrompt" : "effect";
}

/** 是否该自动播（纯函数，单测锁）：听音题 + 正面未作答。 */
export function mayAutoSpeak(cardMode: string, prompt: boolean, answered: boolean): boolean {
    return cardMode === "listen" && prompt && !answered;
}
