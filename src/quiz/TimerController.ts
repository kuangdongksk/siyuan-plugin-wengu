import type { WenguTimingMode } from "../types";
import { mmss } from "../ui/shared";

/**
 * 一轮刷题的计时状态机（design-review P1-2）。
 *
 * 语义（2026-08-22 起：逐题秒数在**所有模式**下都记录，供完成后的
 * 用时/得分报告分析）：
 * - `elapsed()` = baseSec + 本段秒数 → 写会话 elapsedSec（继续上轮时
 *   base 为该会话已用时）；
 * - `pending` 只算本段未落库秒数 → total-time 落库用（consume 取走
 *   清零，与 base 不重复累计）；
 * - 逐题秒数：每秒记到当前题（setQuestion 跟随题号导航/滚动），
 *   可从上轮会话的 result.sec 恢复；
 * - 倒计时：归零置 timeUp（视图层弹「继续作答/结束本轮」）；选择
 *   继续后 beginOvertime()，overtimeSec 单独累计、标签显示 +m:ss。
 */
export class TimerController {
    mode: WenguTimingMode = "countUp";
    countdownMin = 20;
    countdownLeft = 0;
    timeUp = false;
    overtimeSec = 0;
    private overtimeStarted = false;
    private baseSec = 0;
    private sec = 0;
    private readonly qSec = new Map<string, number>();
    private activeQid = "";

    constructor(private readonly onChange: () => void) {}

    /** 开轮：继续上轮传 prevElapsed（倒计时扣减、其余作累计基数）。 */
    start(mode: WenguTimingMode, countdownMin: number, prevElapsed = 0): void {
        this.mode = mode;
        this.countdownMin = countdownMin;
        this.baseSec = prevElapsed;
        this.sec = 0;
        this.overtimeSec = 0;
        this.overtimeStarted = false;
        this.qSec.clear();
        this.timeUp = false;
        if (mode === "countdown") {
            this.countdownLeft = Math.max(0, countdownMin * 60 - prevElapsed);
            this.timeUp = this.countdownLeft === 0;
        } else {
            this.countdownLeft = 0;
        }
        this.onChange();
    }

    /** 倒计时归零且用户选择了「继续作答」（进入超时正计时段）。 */
    get inOvertime(): boolean {
        return this.mode === "countdown" && this.timeUp && this.overtimeStarted;
    }

    /** 归零后用户点「继续作答」时调用。 */
    beginOvertime(): void {
        this.overtimeStarted = true;
        this.overtimeSec = 0;
        this.onChange();
    }

    /** 逐题计时恢复（继续上轮时从会话 results 逐题回填）。 */
    restoreQuestionSec(qid: string, sec: number): void {
        if (sec > 0) this.qSec.set(qid, sec);
    }

    /** 当前题切换（题号导航点击/滚动联动时调用）。 */
    setQuestion(qid: string): void {
        this.activeQid = qid;
    }

    /** 每秒走一步；返回 true 表示倒计时刚好归零（视图层弹选择）。 */
    tick(): boolean {
        this.sec++;
        if (this.activeQid) {
            this.qSec.set(this.activeQid, (this.qSec.get(this.activeQid) ?? 0) + 1);
        }
        if (this.mode === "countdown") {
            if (this.countdownLeft > 0) {
                this.countdownLeft--;
                if (this.countdownLeft === 0) {
                    this.timeUp = true;
                    return true;
                }
            } else if (this.overtimeStarted) {
                this.overtimeSec++;
            }
        }
        return false;
    }

    /** 会话总用时（继续语义：base + 本段）。 */
    elapsed(): number {
        return this.baseSec + this.sec;
    }

    /** 本段未落库秒数（只读）。 */
    get pending(): number {
        return this.sec;
    }

    /** 取走未落库秒数（total-time 落库用），取后清零、base 不动。 */
    consume(): number {
        const d = this.sec;
        this.sec = 0;
        return d;
    }

    /** 某题已用秒数（所有模式都记录）。 */
    questionSec(qid: string): number {
        return this.qSec.get(qid) ?? 0;
    }

    /** 提交时取本题秒数记入会话 result.sec。 */
    takeQuestionSec(qid: string): number {
        return this.questionSec(qid);
    }
    /** 头部标签文案（图标由视图侧 svgIcon 渲染，这里只给文本）。 */
    labelText(t: (k: string) => string, docTotalPending: number, currentQSec: number): string {
        if (this.inOvertime) return `+${mmss(this.overtimeSec)}`;
        if (this.mode === "perQuestion") return mmss(currentQSec);
        if (this.mode === "countdown") {
            return this.countdownLeft === 0 && this.timeUp ? t("timeUpShort") : mmss(this.countdownLeft);
        }
        return mmss(docTotalPending);
    }
}

/** 把计时标签渲染进头部元素（QuizView 的 updateTimerLabel 收敛于此）。 */
export function renderTimerLabel(
    el: HTMLElement | null,
    timer: TimerController,
    t: (k: string) => string,
    totalSec: number,
    qSec: number
): void {
    if (!el) return;
    if (timer.mode === "none") {
        el.style.display = "none";
        return;
    }
    el.style.display = "";
    const text = el.querySelector<HTMLElement>("[data-timer-text]") ?? el;
    text.textContent = timer.labelText(t, totalSec, qSec);
}
