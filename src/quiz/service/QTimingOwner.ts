import { QuestionTimer } from "./QuizTimer";
import type { TimerController } from "./TimerController";
import { syncAllCardTimers, syncCardTimer } from "../render/FocusSync";

/**
 * 单题计时的视图侧持有物（Issue #182）。
 *
 * 为什么单独一片：`quiz/index.ts` 的 574/561 行豁免**额度＝上限**
 * （#138 先例：直接往视图塞字段+访问器会顶破 590/577，就是这么破的）。
 * 本类收走「计时载体 + 切焦点 + 结算取数 + 卡面刷新」四件薄事，视图侧
 * 只剩一个字段与四个一行访问器（同 `MatSplitPrefs` / `ConvertAccess`
 * 的切法）。**后续再往视图加计时相关字段，先照这个切法走，别硬塞。**
 */
export class QTimingOwner {
    private readonly timer = new QuestionTimer();

    /** 计时载体（组件/流程/移动端读结算与冻结态）。 */
    get q(): QuestionTimer {
        return this.timer;
    }

    /** 点击切焦点（#182 R1）：切换时刻＝该题计时起点，并刷新前后两张卡面
     *  （旧卡卸流光、新卡起流光）。滚动跟踪不走这里。 */
    focus(qid: string): void {
        const prev = this.timer.active;
        this.timer.focus(qid);
        if (prev && prev !== qid) syncCardTimer(prev);
        if (qid) syncCardTimer(qid);
    }

    /** 结算取数（#182 R3/R4）：优先冻结结算值，无则回落整轮秒表
     *  （测试壳/非提交路径的兼容口径）。 */
    takeSec(qid: string, fallback: () => number): number {
        const frozen = this.timer.secOf(qid);
        return frozen > 0 ? frozen : fallback();
    }

    /** 结算后刷新卡面（#182 R4：流光定格 + 读数换静态注记）。 */
    refresh(qid: string): void {
        syncCardTimer(qid);
    }

    /** 开轮/恢复收尾：按落点把全部卡刷一遍（#182 R6）。 */
    syncCards(): void {
        syncAllCardTimers(this.timer);
    }

    /** 点击切焦点（#182 R1）：切换时刻＝该题计时起点。题号点击/组内导航/
     *  恢复落点三路共用——只有真正「换题」的意图才走这条（滚动只刷高亮，
     *  由 `NumRail.setActiveOnly` 承担，不经本方法）。整轮逐题累计
     *  （旧口径，头部「本题」标签快照）也在这条链上同步推进。 */
    switchTo(idx: number, qid: string, whole: TimerController): void {
        whole.setQuestion(qid);
        this.focus(qid);
    }
}
