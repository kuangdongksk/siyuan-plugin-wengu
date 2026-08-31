import { addDocTime } from "../../bank/data/BankRecording";
import type { QuestionBank } from "../../bank/data/QuestionBank";
import { showTimeUpChoice } from "../render/RoundReport";
import { renderTimerLabel, TimerController } from "./TimerController";

/**
 * 计时编排（自 QuizView 外移，行数受限）：每秒 tick、累计用时落库、
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
    /** 累计用时持久层（自托管后进题库 docStats；无 bank 时只保内存）。 */
    bankStore?(): QuestionBank | undefined;
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
    bankStore?(): QuestionBank | undefined;
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
        ...(v.bankStore ? { bankStore: () => v.bankStore!() } : {}),
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
            // 页签被切走（fn__none）或窗口最小化时不计时：「累计刷题
            // 用时」只反映真实面对题目的时间，挂后台的墙钟时间不计
            if (document.hidden || this.host.el.getClientRects().length === 0) return;
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

    /** 文档切换/收卷/销毁时结算未落库秒数（题库 docStats；专题模式
     *  col: 前缀是聚合视图非文档，不持久化——与原内核写失败吞掉同语义）。 */
    async flush(): Promise<void> {
        const id = this.host.tickState().docId;
        if (!id) return;
        const add = this.host.timer.consume();
        if (add <= 0) return;
        this.host.addDocTotal(add);
        const bank = this.host.bankStore?.();
        if (bank && !id.startsWith("col:")) {
            try {
                await addDocTime(bank, id, add);
            } catch (_) {
                // 尽力而为
            }
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
