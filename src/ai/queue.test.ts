import { describe, expect, it } from "vitest";
import { acquireAiSlot, aiSlotCapacityOf, aiSlotUsage, setAiSlotCapacity, AI_SLOTS_DEFAULT } from "./queue";

/** 微任务冲刷：Promise 回调按注册序执行，故用固定次数 await 即可推平
 *  唤醒链——不引 setTimeout，避免把 FIFO 语义验成「定时器序」。 */
const tick = async (n = 6): Promise<void> => {
    for (let i = 0; i < n; i++) await Promise.resolve();
};

/** 每个用例自定容量，用例内自清（模块单例，不引测试钩子做全局重置——
 *  任何在途槽都由本用例自己释放）。 */
const acquire = async (n: number, signal?: AbortSignal): Promise<() => void> => {
    setAiSlotCapacity(n);
    return acquireAiSlot(signal);
};

describe("AI 在途并发闸（acquireAiSlot）", () => {
    it("默认容量 4（未注入时）", async () => {
        expect(AI_SLOTS_DEFAULT).toBe(4);
        const free = await acquire(AI_SLOTS_DEFAULT);
        expect(aiSlotUsage()).toMatchObject({ capacity: AI_SLOTS_DEFAULT, used: 1 });
        free();
        expect(aiSlotUsage()).toMatchObject({ used: 0 });
    });

    it("容量 N 时第 N+1 笔排队，释放后 FIFO 唤醒", async () => {
        const r1 = await acquire(2);
        const r2 = await acquireAiSlot();
        const order: string[] = [];
        const p3 = acquireAiSlot().then((rel) => {
            order.push("c");
            return rel;
        });
        await tick();
        expect(order).toEqual([]);
        expect(aiSlotUsage()).toMatchObject({ used: 2, waiting: 1, capacity: 2 });
        r1(); // 释放一个槽 → 队首被唤醒（不是「第 3 笔直发」）
        await tick();
        expect(order).toEqual(["c"]);
        expect(aiSlotUsage()).toMatchObject({ used: 2, waiting: 0 });
        r2();
        (await p3)();
        await tick();
        expect(aiSlotUsage()).toMatchObject({ used: 0, waiting: 0 });
    });

    it("FIFO 顺序：三笔排队按入队序唤醒（不因释放次序错乱）", async () => {
        const held = await acquire(1);
        const got: string[] = [];
        const ps = ["a", "b", "c"].map((k) =>
            acquireAiSlot().then((rel) => {
                got.push(k);
                return rel;
            })
        );
        await tick();
        expect(got).toEqual([]);
        held();
        await tick();
        expect(got).toEqual(["a"]);
        (await ps[0])();
        await tick();
        expect(got).toEqual(["a", "b"]);
        (await ps[1])();
        await tick();
        expect(got).toEqual(["a", "b", "c"]);
        (await ps[2])();
        await tick();
        expect(aiSlotUsage()).toMatchObject({ used: 0, waiting: 0 });
    });

    it("等待中 abort 即刻出队并抛中止，槽账不留残影", async () => {
        const held = await acquire(1);
        const ctrl = new AbortController();
        const p = acquireAiSlot(ctrl.signal);
        ctrl.abort();
        await expect(p).rejects.toThrowError(/aborted/i);
        expect(aiSlotUsage()).toMatchObject({ used: 1, waiting: 0 });
        held(); // 出队者不再被唤醒（释放槽不产生幽灵占用）
        await tick();
        expect(aiSlotUsage()).toMatchObject({ used: 0, waiting: 0 });
    });

    it("已中止的 signal 不进队，直接抛中止", async () => {
        const held = await acquire(1);
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(acquireAiSlot(ctrl.signal)).rejects.toThrowError(/aborted/i);
        expect(aiSlotUsage()).toMatchObject({ used: 1, waiting: 0 });
        held();
    });

    it("释放句柄幂等：重复调用只放一次槽", async () => {
        const rel = await acquire(1);
        rel();
        rel();
        rel();
        expect(aiSlotUsage()).toMatchObject({ used: 0 });
        const p = acquireAiSlot();
        await tick();
        expect(aiSlotUsage()).toMatchObject({ used: 1, waiting: 0 });
        (await p)();
        await tick();
        expect(aiSlotUsage()).toMatchObject({ used: 0 });
    });

    it("唤醒链不因单笔异常断裂：队首的后续逻辑抛错，后面的人照样被唤醒", async () => {
        const r1 = await acquire(2);
        const r2 = await acquireAiSlot();
        const got: string[] = [];
        // x 被唤醒后**先释放自己的槽再抛**（模拟「收口时释放槽，紧接着
        // 自己的错误处理炸了」）；y 不得因此被永久挂起
        const p1 = acquireAiSlot().then((rel): void => {
            got.push("x");
            rel();
            throw new Error("被唤醒者的后续逻辑炸了");
        });
        const p2 = acquireAiSlot().then((rel): void => {
            got.push("y");
            rel();
        });
        await tick();
        expect(got).toEqual([]);
        r1(); // 放一个槽 → 只够唤醒 x
        await tick();
        // 注意：x 被唤醒后立刻 rel() 又把槽还了回去，同一次 drain 里若
        // 还能放行，y 会紧接着被唤醒（两者都在本轮微任务里）——这是允许
        // 且期望的：唤醒链没有被 x 的异常打断
        expect(got).toEqual(["x", "y"]);
        await p1.catch((): void => undefined); // 使用者面吞自己的异常
        r2();
        await p2;
        await tick();
        expect(aiSlotUsage()).toMatchObject({ used: 0, waiting: 0 });
    });

    it("容量运行期更新：缩容不打断在途、只拦新来的；在途降到容量以下即放行队首", async () => {
        setAiSlotCapacity(4);
        const rels = [await acquireAiSlot(), await acquireAiSlot(), await acquireAiSlot(), await acquireAiSlot()];
        setAiSlotCapacity(2); // 缩容：在途 4 笔照常在途（不打断）
        expect(aiSlotUsage()).toMatchObject({ used: 4, capacity: 2 });
        let newOne = false;
        let released: (() => void) | undefined;
        void acquireAiSlot().then((rel): void => {
            newOne = true;
            released = rel;
        });
        await tick();
        expect(newOne).toBe(false); // 新来的进队（缩容是「拦」，不是「拒」）
        expect(aiSlotUsage()).toMatchObject({ waiting: 1 });
        rels[0]();
        await tick();
        expect(newOne).toBe(false); // 在途 3 > 2，继续拦
        rels[1]();
        await tick();
        expect(newOne).toBe(false); // 在途 2 = 容量（缩容带进来的存量照常跑完）
        rels[2]();
        await tick();
        expect(newOne).toBe(true); // 在途 1 < 2，队首放行
        released?.();
        rels[3]();
        await tick();
        expect(aiSlotUsage()).toMatchObject({ used: 0, waiting: 0 });
    });
});

describe("转换 4 worker + 1 重试（Issue #76 场景模拟）", () => {
    it("在途数峰值恒 ≤ 容量，重试排队等槽而不是直发第 5 笔", async () => {
        setAiSlotCapacity(4);
        let inFlight = 0;
        let peak = 0;
        /** 4 个 worker 全部进场后才放重试——把「转换 4 并发跑动中」钉死。 */
        let entered = 0;
        let allIn!: () => void;
        const allEntered = new Promise<void>((r) => {
            allIn = r;
        });
        let releaseWorkers!: () => void;
        const workersMayEnd = new Promise<void>((r) => {
            releaseWorkers = r;
        });
        const trace: string[] = [];
        const call = async (name: string, joined: () => void): Promise<void> => {
            const release = await acquireAiSlot();
            inFlight++;
            peak = Math.max(peak, inFlight);
            trace.push(`+${name}`);
            joined();
            await workersMayEnd; // 在途期间不动（模拟 4 笔 AI 在跑）
            inFlight--;
            release();
        };
        const joined = (): void => {
            if (++entered === 4) allIn();
        };
        const workers = ["w1", "w2", "w3", "w4"].map((w) => call(w, joined));
        await allEntered;
        expect(aiSlotUsage()).toMatchObject({ used: 4, waiting: 0 });
        // 重试：满载 ⇒ 排队等槽（不是直发第 5 笔）
        const retry = call("retry", () => undefined);
        await tick();
        expect(trace).toEqual(["+w1", "+w2", "+w3", "+w4"]);
        expect(aiSlotUsage()).toMatchObject({ used: 4, waiting: 1 });
        releaseWorkers(); // 4 笔收口 → 重试被 FIFO 唤醒补位
        await Promise.all([...workers, retry]);
        expect(trace).toEqual(["+w1", "+w2", "+w3", "+w4", "+retry"]);
        expect(peak).toBeLessThanOrEqual(4); // 全程在途数 ≤ 容量
        expect(aiSlotUsage()).toMatchObject({ used: 0, waiting: 0 });
    });
});

describe("容量注入与 FIFO 饥饿（Issue #76 复审）", () => {
    it("aiSlotCapacityOf：未设置/非法值回落默认 4，显式 1~4 照收", () => {
        expect(aiSlotCapacityOf(undefined)).toBe(AI_SLOTS_DEFAULT);
        expect(aiSlotCapacityOf(null)).toBe(AI_SLOTS_DEFAULT);
        expect(aiSlotCapacityOf("2")).toBe(AI_SLOTS_DEFAULT);
        expect(aiSlotCapacityOf(NaN)).toBe(AI_SLOTS_DEFAULT);
        expect(aiSlotCapacityOf(0)).toBe(AI_SLOTS_DEFAULT);
        expect(aiSlotCapacityOf(1)).toBe(1);
        expect(aiSlotCapacityOf(4)).toBe(4);
    });

    it("释放的槽转交队首：新来的不得插队（否则队首会被无限推后饿死）", async () => {
        setAiSlotCapacity(1);
        const held = await acquireAiSlot();
        const order: string[] = [];
        const queued = acquireAiSlot().then((rel) => {
            order.push("queued");
            return rel;
        });
        await tick();
        expect(aiSlotUsage()).toMatchObject({ used: 1, waiting: 1 });
        // 释放旧槽的**同一同步栈**里立刻来一笔新的——若槽被当成「空闲」
        // 松开，新来的会在 takeSlot 里直接抢走，队首永远轮不到
        held();
        const barge = acquireAiSlot().then((rel) => {
            order.push("barge");
            return rel;
        });
        await tick();
        expect(order).toEqual(["queued"]);
        expect(aiSlotUsage()).toMatchObject({ used: 1, waiting: 1 });
        (await queued)();
        await tick();
        expect(order).toEqual(["queued", "barge"]);
        (await barge)();
        await tick();
        expect(aiSlotUsage()).toMatchObject({ used: 0, waiting: 0 });
    });
});
