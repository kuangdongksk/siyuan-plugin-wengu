import {
    manualFinishRound,
    showTimeUpChoice,
} from "./RoundReport";
import type {RoundFinishCtx} from "./RoundReport";
import type {TimerController} from "./TimerController";
import {renderTimerLabel} from "./TimerController";

/**
 * 刷题计时条（从 QuizView 拆出）：秒级 tick（会话用时回写、倒计时
 * 归零选择条、每 15s 落一次文档累计用时）与头部标签渲染。视图只提供
 * 状态读取与回调，不持计时循环。
 */
export interface TimerBarView {
    t(key: string): string;
    /** 头部标签所在的页签根元素。 */
    container(): HTMLElement;
    timer(): TimerController;
    /** 头部显示的文档累计用时（秒）。 */
    docTotalSec(): number;
    /** 当前题 id（逐题计时标签用，无则空）。 */
    activeQid(): string;
    /** 是否在计时（文档模式且已开刷）。 */
    running(): boolean;
    /** 每 tick 回写会话用时。 */
    onTick(elapsed: number): void;
    /** 倒计时归零：给出收卷上下文（undefined=不弹选择条）。 */
    timeUpCtx(): RoundFinishCtx | undefined;
    /** 每 15s 自动落一次累计用时。 */
    autoFlush(): void;
}

export class TimerBar {
    private int: number | undefined;

    constructor(private readonly v: TimerBarView) {}

    start(): void {
        if (this.int !== undefined) return;
        this.int = window.setInterval(() => this.tick(), 1000);
    }

    stop(): void {
        if (this.int !== undefined) {
            window.clearInterval(this.int);
            this.int = undefined;
        }
    }

    private tick(): void {
        const v = this.v;
        if (!v.running() || v.timer().mode === "none") return;
        const justTimeUp = v.timer().tick();
        v.onTick(v.timer().elapsed());
        if (justTimeUp) this.showTimeUp();
        this.update();
        if (v.timer().pending % 15 === 0) v.autoFlush();
    }

    /** 头部用时标签（视图重渲染后调用）。 */
    update(): void {
        const v = this.v;
        renderTimerLabel(
            v.container().querySelector<HTMLElement>("[data-timer]"),
            v.timer(),
            v.t,
            v.docTotalSec() + v.timer().pending,
            v.activeQid() ? v.timer().questionSec(v.activeQid()) : 0,
        );
    }

    private showTimeUp(): void {
        const v = this.v;
        const slot = v.container().querySelector<HTMLElement>("[data-timeup-slot]");
        if (!slot || slot.childElementCount > 0) return;
        const ctx = v.timeUpCtx();
        if (!ctx) return;
        showTimeUpChoice(slot, v.t, {
            onOvertime: () => v.timer().beginOvertime(),
            onFinish: () => manualFinishRound(ctx),
        });
    }
}
