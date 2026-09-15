import { describe, expect, it, vi } from "vitest";

/**
 * WordTimer 结算与组边界重排（Issue #115，P3）：计时只累计「可见且非输入」
 * 的时间（docs/word-timing.md 决策 2/3/6），超时按「忘记」处理——这条
 * 不对称设计若写错，用户切个应用回来就被判超时。这里用假时钟钉死：
 *  ① 可见/输入两把闸各自的暂停与恢复；
 *  ② settle 的累计值与 over 阈值（含恰好等于阈值不算超时）；
 *  ③ begin/settle 生命周期（未 begin 结算 undefined、结算后复位）；
 *  ④ rebuildTail 的错词重现间隔散布与 doneSet 剔除。
 */

/** 假时钟 + 可控可见性：WordTimer 直接读 document.hidden / Date.now。 */
class FakeClock {
    private now = 1_000_000;
    hidden = false;
    listeners = new Set<() => void>();
    nowFn(): number {
        return this.now;
    }
    advance(ms: number): void {
        this.now += ms;
    }
    setHidden(v: boolean): void {
        this.hidden = v;
        for (const l of [...this.listeners]) l();
    }
    install(): void {
        vi.stubGlobal("document", {
            get hidden() {
                return clock.hidden;
            },
            addEventListener: (type: string, cb: () => void): void => {
                if (type === "visibilitychange") clock.listeners.add(cb);
            },
            removeEventListener: (_t: string, cb: () => void): void => void clock.listeners.delete(cb),
        });
        vi.spyOn(Date, "now").mockImplementation(() => clock.nowFn());
    }
}

const clock = new FakeClock();

/** 假卡根元素：只在需要时为「输入聚焦」发事件。 */
class FakeEl {
    focusHandlers = new Set<(ev: Event) => void>();
    blurHandlers = new Set<() => void>();
    /** WordTimer 只注册 focusin/focusout 两个监听（签名与 DOM 对齐）。 */
    addEventListener(type: string, cb: (ev: Event) => void): void {
        if (type === "focusin") this.focusHandlers.add(cb);
        if (type === "focusout") this.blurHandlers.add(cb as unknown as () => void);
    }
    removeEventListener(type: string, cb: (ev: Event) => void): void {
        if (type === "focusin") this.focusHandlers.delete(cb);
        if (type === "focusout") this.blurHandlers.delete(cb as unknown as () => void);
    }
    focusIn(target: Record<string, unknown>): void {
        for (const h of [...this.focusHandlers]) h({ target } as unknown as Event);
    }
    focusOut(): void {
        for (const h of [...this.blurHandlers]) h();
    }
}

async function newTimer(): Promise<{ timer: import("./WordTiming").WordTimer; el: FakeEl }> {
    vi.resetModules();
    clock.install();
    clock.hidden = false;
    const { WordTimer } = await import("./WordTiming");
    const el = new FakeEl();
    return { timer: new WordTimer(el as unknown as HTMLElement), el };
}

describe("WordTimer · 可见性闸", () => {
    it("可见期间正常累计，切走暂停、回来续计", async () => {
        const { timer } = await newTimer();
        timer.begin("choiceEn");
        clock.advance(3000);
        clock.setHidden(true); // 切应用：当前段结算
        clock.advance(99_000); // 不可见时间不计
        clock.setHidden(false);
        clock.advance(2000);
        const out = timer.settle()!;
        expect(out.ms).toBe(5000);
        expect(out.mode).toBe("choiceEn");
        expect(out.over).toBe(0);
    });
});

describe("WordTimer · 输入闸", () => {
    it("输入框聚焦期间不计时（打字慢不算犹豫）", async () => {
        const { timer, el } = await newTimer();
        timer.begin("spell");
        clock.advance(1500);
        el.focusIn({ tagName: "INPUT", isContentEditable: false }); // 暂停
        clock.advance(60_000);
        el.focusOut(); // 恢复
        clock.advance(500);
        expect(timer.settle()!.ms).toBe(2000);
    });

    it("contentEditable 同样算输入", async () => {
        const { timer, el } = await newTimer();
        timer.begin("choiceEn");
        el.focusIn({ tagName: "DIV", isContentEditable: true });
        clock.advance(30_000);
        expect(timer.settle()!.ms).toBe(0);
    });

    it("非输入元素聚焦不暂停计时", async () => {
        const { timer, el } = await newTimer();
        timer.begin("choiceEn");
        el.focusIn({ tagName: "BUTTON", isContentEditable: false });
        clock.advance(1000);
        expect(timer.settle()!.ms).toBe(1000);
    });
});

describe("WordTimer · settle 生命周期与超时判据", () => {
    it("未 begin 结算返回 undefined", async () => {
        const { timer } = await newTimer();
        expect(timer.settle()).toBeUndefined();
    });

    it("结算后复位：再次 settle 仍是 undefined，重新 begin 从零计", async () => {
        const { timer } = await newTimer();
        timer.begin("choiceEn");
        clock.advance(1000);
        expect(timer.settle()!.ms).toBe(1000);
        expect(timer.settle()).toBeUndefined();
        timer.begin("choiceZh");
        clock.advance(700);
        expect(timer.settle()).toMatchObject({ mode: "choiceZh", ms: 700 });
    });

    it("恰在阈值上不算超时，超出 1ms 即算", async () => {
        const { timer } = await newTimer();
        timer.begin("choiceEn"); // 阈值 12000
        clock.advance(12_000);
        expect(timer.settle()!.over).toBe(0);
        timer.begin("choiceEn");
        clock.advance(12_001);
        expect(timer.settle()!.over).toBe(1);
    });

    it("不在阈值表内的题型不判超时（recallZh 8000 内同理）", async () => {
        const { timer } = await newTimer();
        timer.begin("readalong");
        clock.advance(999_999);
        expect(timer.settle()!.over).toBe(0);
        timer.begin("recallZh");
        clock.advance(8001);
        expect(timer.settle()!.over).toBe(1);
    });

    it("dispose 摘掉可见性监听：之后翻转不再结算当前段（继续累计）", async () => {
        const { timer } = await newTimer();
        timer.begin("spell");
        clock.advance(500);
        timer.dispose();
        // 监听摘干净了 → 切后台不会被观察到，计时照走（此处的语义就是
        // 「别再动这个计时器」；留一条锁防 dispose 后还被回调结算）
        clock.setHidden(true);
        clock.advance(5000);
        expect(timer.settle()!.ms).toBe(5500);
    });
});
