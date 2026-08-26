import { addDocTotalTime } from "./QuestionService";
import { showTimeUpChoice } from "./RoundReport";
import { renderTimerLabel, TimerController } from "./TimerController";

/**
 * 计时编排（自 QuizView 外移，行数受限）：每秒 tick、total-time 落库、
 * 头部标签刷新、倒计时归零的选择条。状态仍在视图侧，经 TimerHost 读取。
 */

export interface TimerHost {
    el: HTMLElement;
    t: (k: string) => string;
    timer: TimerController;
    /** tick / 刷新标签时要读的动态状态。 */
    tickState(): {
        docId: string;
        started: boolean;
        activeQid: string;
        docTotalSec: number;
    };
    /** 本段秒数推进到会话（session.elapsedSec = elapsed）。 */
    syncSession(elapsed: number): void;
    /** total-time 落库前先累加到视图的文档累计用时。 */
    addDocTotal(add: number): void;
    /** 倒计时归零后用户选择「结束本轮」的收卷流程。 */
    finishNow(): void;
}

export interface TimerHostAccess {
    container(): HTMLElement;
    t(key: string): string;
    timerController(): TimerController;
    docIdOf(): string;
    isStarted(): boolean;
    activeQidOf(): string;
    docTotalSecOf(): number;
    syncSession(elapsed: number): void;
    addDocTotal(add: number): void;
    finishNow(): void;
}

/** 由视图能力组装 TimerHost（QuizView.timerHost 的拆出体）。 */
export function timerHostFor(v: TimerHostAccess): TimerHost {
    return {
        el: v.container(),
        t: v.t,
        timer: v.timerController(),
        tickState: () => ({
            docId: v.docIdOf(),
            started: v.isStarted(),
            activeQid: v.activeQidOf(),
            docTotalSec: v.docTotalSecOf(),
        }),
        syncSession: (elapsed) => v.syncSession(elapsed),
        addDocTotal: (add) => v.addDocTotal(add),
        finishNow: () => v.finishNow(),
    };
}

export class TimerBinder {
    private int: number | undefined;

    constructor(private readonly host: TimerHost) {}

    start(): void {
        if (this.int !== undefined) return;
        this.int = window.setInterval(() => {
            const s = this.host.tickState();
            if (!s.started || this.host.timer.mode === "none") return;
            const justTimeUp = this.host.timer.tick();
            this.host.syncSession(this.host.timer.elapsed());
            if (justTimeUp) this.showTimeUpBar();
            this.updateLabel();
            if (this.host.timer.pending % 15 === 0) void this.flush();
        }, 1000);
    }

    stop(): void {
        if (this.int !== undefined) {
            window.clearInterval(this.int);
            this.int = undefined;
        }
    }

    /** 文档切换/收卷/销毁时结算未落库秒数（total-time 属性）。 */
    async flush(): Promise<void> {
        const id = this.host.tickState().docId;
        if (!id) return;
        const add = this.host.timer.consume();
        if (add <= 0) return;
        this.host.addDocTotal(add);
        try {
            await addDocTotalTime(id, add);
        } catch (_) {
            // 尽力而为
        }
    }

    updateLabel(): void {
        const s = this.host.tickState();
        renderTimerLabel(
            this.host.el.querySelector<HTMLElement>("[data-timer]"),
            this.host.timer,
            this.host.t,
            s.docTotalSec + this.host.timer.pending,
            s.activeQid ? this.host.timer.questionSec(s.activeQid) : 0
        );
    }

    /** 倒计时归零：给出「继续作答 / 结束本轮」的选择条。 */
    private showTimeUpBar(): void {
        const slot = this.host.el.querySelector<HTMLElement>("[data-timeup-slot]");
        if (!slot || slot.childElementCount > 0) return;
        showTimeUpChoice(slot, this.host.t, {
            onOvertime: () => this.host.timer.beginOvertime(),
            onFinish: () => this.host.finishNow(),
        });
    }
}
