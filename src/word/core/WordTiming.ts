import { buildQueue, type WenguWordProgress } from "./WordStore";

/**
 * 作答计时与组边界调度（docs/word-timing.md 决策 2/3/6）。
 *
 * 计时只累计「可见且非输入」的时间：切应用/最小化暂停（技术上
 * 检测得到，不冤枉）；输入框聚焦/打字暂停——打字速度慢不该被当成
 * 犹豫，spell 的决策信号实际成为「看题到开始输入的首键延迟」。
 * 可见、非输入状态下的超时（走神，无法与深度思考区分）按「忘记」
 * 处理（不对称设计：误伤成本一次重见，漏抓成本假熟词流进长间隔）。
 */

/** 题型超时阈值（毫秒），不在表内的题型不判。 */
const OVER_MS: Record<string, number> = {
    choiceEn: 12_000,
    choiceZh: 12_000,
    spell: 10_000,
    recallEn: 8_000,
    recallZh: 8_000,
    listen: 12_000,
};

/** 一次作答的结算结果（over=1 即按「忘记」处理）。 */
export interface SettledTiming {
    mode: string;
    ms: number;
    over: 0 | 1;
}

/** 一张卡的计时器：进入 prompt 态 begin，作答/翻面时 settle。 */
export class WordTimer {
    private mode = "";
    private accMs = 0;
    private segStart = 0;
    private typing = false;
    private readonly offs: (() => void)[] = [];

    constructor(el: HTMLElement) {
        const onVis = () => this.flip();
        document.addEventListener("visibilitychange", onVis);
        this.offs.push(() => document.removeEventListener("visibilitychange", onVis));
        const onFocusIn = (ev: Event): void => {
            const t = ev.target as HTMLElement;
            this.typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
            this.flip();
        };
        const onFocusOut = (): void => {
            this.typing = false;
            this.flip();
        };
        el.addEventListener("focusin", onFocusIn);
        el.addEventListener("focusout", onFocusOut);
        this.offs.push(() => el.removeEventListener("focusin", onFocusIn));
        this.offs.push(() => el.removeEventListener("focusout", onFocusOut));
    }

    dispose(): void {
        for (const off of this.offs) off();
    }

    /** 当前段是否计入：已 begin 且可见且非输入。 */
    private active(): boolean {
        return this.mode !== "" && !document.hidden && !this.typing;
    }

    /** 活性翻转时结束/重启当前段。 */
    private flip(): void {
        const live = this.active();
        if (live === this.segStart > 0) return;
        if (live) this.segStart = Date.now();
        else {
            this.accMs += Date.now() - this.segStart;
            this.segStart = 0;
        }
    }

    begin(mode: string): void {
        this.mode = mode;
        this.accMs = 0;
        this.segStart = this.active() ? Date.now() : 0;
    }

    /** 结算并复位；未 begin 过返回 undefined。 */
    settle(): SettledTiming | undefined {
        if (this.mode === "") return undefined;
        if (this.segStart > 0) {
            this.accMs += Date.now() - this.segStart;
            this.segStart = 0;
        }
        const lim = OVER_MS[this.mode];
        const out: SettledTiming = {
            mode: this.mode,
            ms: this.accMs,
            over: lim !== undefined && this.accMs > lim ? 1 : 0,
        };
        this.mode = "";
        return out;
    }
}

/* ── 组边界：重排未消费队列（决策 3/6，本地算法即时，不等 AI） ── */

/** 组边界重排队列余量（队列轨 review/star 用；fresh 滚动窗口不消费
 * 队列，不走这里）：已刷过（doneSet）剔除、错词重现卡按 REINSERT_GAP
 * 间隔散布进新 tail（贴队首会让同一词连出两张，20260824 真机踩坑）、
 * review 其余按到期书序重排——AI 已落盘的 due 变化由此吃到；star
 * 队列原样返回。 */
export const REINSERT_GAP = 3;

export function rebuildTail(
    p: WenguWordProgress,
    kind: "review" | "star",
    queue: number[],
    pos: number,
    hardList: number[],
    doneSet: Set<number>
): number[] {
    if (kind === "star") return queue;
    const hardPending: number[] = [];
    for (const i of queue.slice(pos)) {
        if (hardList.includes(i) && !hardPending.includes(i)) hardPending.push(i);
    }
    const pend = buildQueue(p).review.filter((i) => !doneSet.has(i) && !hardPending.includes(i));
    const merged: number[] = [];
    let h = 0;
    for (const i of pend) {
        if (h < hardPending.length && merged.length >= (h + 1) * REINSERT_GAP) {
            merged.push(hardPending[h++]);
        }
        merged.push(i);
    }
    merged.push(...hardPending.slice(h));
    return [...queue.slice(0, pos), ...merged];
}
