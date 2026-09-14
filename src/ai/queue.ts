/**
 * 全局 AI 在途并发闸（Issue #76）：任何走 `agentChatOnce` /
 * `agentChatContinued` 的调用都必须**先取到槽位再发请求**，全仓在途
 * AI 笔数不超过容量（默认 {@link AI_SLOTS_DEFAULT}，由 index.ts onload
 * 按设置里的转换并行度注入）——转换 4 并发跑动中再点面板「重试」时，
 * 重试排队等槽，而不是直发第 5 笔。
 *
 * 与既有两道闸的关系（三条正交、互不替代）：
 *  - `aiFlowBegin` 单飞闸（flow.ts）= 六个重型批流之间的互斥，管
 *    「同一时间只放一条流」；
 *  - 转换 worker 池（ConvertBatch）= 转换内部的片流水线数；
 *  - 本闸 = **所有** AI 调用的总在途上限，前两者发的每一笔都过它。
 *
 * 两条硬口径（都是防自锁，20260914 用户定夺）：
 *  1. **abort 感知**：排队等待期间 signal 中止要立刻出队并抛中止——
 *     不得出现「点了停止还挂在队里等槽」；
 *  2. **槽释放 FIFO 唤醒链不吞异常**：槽只在调用收口（成功/失败/中止）
 *     时释放；释放后必须按 FIFO 唤醒队首，唤醒链本身（队首的后续逻辑、
 *     整条 drain）**任何异常都不得中断**——吞掉一次异常就会让后续所有
 *     排队者永久挂起（同落盘链的面吞错惯例）。
 *
 * 实现依赖 Promise 微任务 FIFO 语义（es6-promises-spec）：`p.then(cb)`
 * 回调按注册序执行 ⇒ 唤醒顺序 = 入队顺序。因此**绝不能**给等待链加
 * 去抖/宏任务延迟换「稳」，那会让 FIFO 失序。
 */

/** 未注入时的默认容量（index.ts onload 会按设置注入 1~4）。 */
export const AI_SLOTS_DEFAULT = 4;

/** 在途上限（{@link aiSlotCapacity} 读）。 */
let capacity = AI_SLOTS_DEFAULT;
/** 已占用的槽数（= 已放行未收口的 AI 笔数）。 */
let used = 0;
/**
 * 缩容时「已在途、超出新容量」的那部分**存量债**。口径「缩容不打断
 * 在途、只拦新来的」= 这批在途笔数挂账、逐笔偿还：每次释放先抵一笔债，
 * 抵完才真正腾出准入位。不挂这笔债会**自锁**——缩容后在途数恰好等于
 * 新容量时，释放把 used 降到 capacity，drain 的 `used < capacity` 不成立，
 * 队首永远等不到唤醒（这正是队列被「存量在途」堵死的形态）。 */
let debt = 0;
/** FIFO 等待队列（队首 = 最早入队的等待者）。等待者收的是**转交的槽
 *  句柄**（不是「轮到你了」的信号）——见 drain 的槽转交口径。 */
const waiters: ((release: () => void) => void)[] = [];

/** 注入/更新容量（index.ts onload 与设置页改转换并行度时调用）。
 *  非法值（非有限数/<1）按默认 {@link AI_SLOTS_DEFAULT}。
 *  **缩容不打断在途**：只拦新来的——用满 N 槽后、容量降到 N' 时不再放
 *  行新的，已在途的照常收口释放（真正的在途笔数由使用者自己的在途
 *  计数决定，槽位账只对齐「已放行未收口」）。 */
export function setAiSlotCapacity(n: number): void {
    capacity = Number.isFinite(n) && n >= 1 ? Math.floor(n) : AI_SLOTS_DEFAULT;
    // 缩容留债（见 debt）：新容量之下多出来的在途笔数挂账，逐笔偿还
    debt = Math.max(0, used - capacity);
    drain();
}

/**
 * 设置值 → 容量（index.ts onload 注入用；纯函数便于单测）。
 * **未设置/非法值一律回落默认 4**：设置里的 `convertParallel` 在用户没动过
 * 设置页时是 `undefined`（转换弹窗的「1 = 串行」是它自己的默认口径），
 * 若拿它当容量就会把**全仓** AI 在途数默认压成 1——判分/伴学等单笔调用
 * 在转换跑动期间全排在后面，与「未注入默认 4」的设计口径相反。
 * 用户**显式**选 1（设置页写入了 1）时才真的按 1 收窄。
 */
export function aiSlotCapacityOf(setting: unknown): number {
    return typeof setting === "number" && Number.isFinite(setting) && setting >= 1
        ? Math.floor(setting)
        : AI_SLOTS_DEFAULT;
}

/** 当前容量（测试与诊断用）。 */
export function aiSlotCapacity(): number {
    return capacity;
}

/** 在途/等待/容量快照（测试与诊断用）。 */
export function aiSlotUsage(): { used: number; waiting: number; capacity: number } {
    return { used, waiting: waiters.length, capacity };
}

/** 槽空闲则按 FIFO 依次唤醒：**先出队、再把槽转交给它**（口径 2）。
 *
 *  ⚠️ **转交而不是「自由释放 + 让它回头再抢」**：唤醒只是把 resolve 排进
 *  微任务，被唤醒者要等下一个微任务才回来占槽；若此刻把槽算成「空闲」，
 *  同一微任务里新来的调用（`acquireAiSlot` 的同步段就会 `takeSlot`）能
 *  直接抢走——队首被推回队尾，持续有新来的就**永远轮不到它**（真机形态：
 *  转换收口紧接着起下一批时把排队中的重试饿死）。故这里保持 `used` 不变
 *  （槽原地过户给队首）并把释放句柄一并交给它。
 *
 *  唤醒链的异常一律面吞——单笔唤醒出问题不许连累后面排队的人（口径 2）。 */
function drain(): void {
    while (used - debt < capacity && waiters.length > 0) {
        const wake = waiters.shift();
        if (!wake) break;
        used++; // 槽转交：腾出的槽直接过户给队首，不给新来的插队窗口
        try {
            wake(releaser());
        } catch (_) {
            // 唤醒链绝不因单笔异常断裂（口径 2）：**槽退回池里、循环接着
            // 唤醒下一位**——不许 break（后面的人会白等一次释放），也不许
            // 把已出队者塞回队首（重入会把它唤醒两次、槽账算花）。
            used = Math.max(0, used - 1);
        }
    }
}

/** 立刻占一个空闲槽；满载返回 undefined（不产生微任务）。 */
function takeSlot(): (() => void) | undefined {
    if (used - debt >= capacity) return undefined;
    used++;
    return releaser();
}

/** 幂等释放句柄：重复调用只放一次（调用方 catch/finally 双保险时
 *  不会把槽账算花，也不会触发多余的唤醒）。 */
function releaser(): () => void {
    let freed = false;
    return (): void => {
        if (freed) return;
        freed = true;
        used = Math.max(0, used - 1);
        // 先抵存量债（缩容遗留）：抵完这笔，准入位才真正腾出来给队首
        if (debt > 0) debt--;
        drain();
    };
}

/** 中止异常（与 client 两条通道已有的 abort 形态一致：DOMException
 *  AbortError，调用方的 Error 分支照常认）。 */
function abortErr(): DOMException {
    return new DOMException("aborted", "AbortError");
}

/**
 * 取槽（在途闸的唯一入口，client 两条通道发送前调）。返回的释放函数
 * **幂等**，必须在调用收口（成功/失败/中止）时调。
 *
 *  - 空闲：同步占位（正常路径零微任务延迟）；
 *  - 满载：FIFO 排队。等待期间 `signal` 中止 → 立刻出队 + 抛 AbortError
 *    （口径 1）；`signal` 已中止则根本不进队；
 *  - 被唤醒后重新判槽（`takeSlot` 失败就再排队）——唤醒只是「轮到你了」，
 *    真正的槽仍要竞争，否则同一批唤醒会把 `used` 顶破。
 */
export async function acquireAiSlot(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw abortErr();
    for (;;) {
        const free = takeSlot();
        if (free) return free;
        const handed = await new Promise<(() => void) | undefined>((resolve, reject) => {
            let done = false;
            /** 被唤醒（口径 2）：收下转交来的槽句柄——**不回头重抢**，
             *  否则队首会被同一微任务里新来的调用挤回队尾。 */
            const wake = (release: () => void): void => {
                if (done) return;
                done = true;
                signal?.removeEventListener("abort", onAbort);
                resolve(release);
            };
            /** 中止（口径 1）：出队 + 抛——队列里不留残影，也不会等下一个槽。 */
            const onAbort = (): void => {
                if (done) return;
                done = true;
                const i = waiters.indexOf(wake);
                if (i >= 0) waiters.splice(i, 1);
                reject(abortErr());
            };
            waiters.push(wake);
            signal?.addEventListener("abort", onAbort);
            // 入队竞态：`takeSlot` 失败到 push 之间若有槽释放，那次 drain
            // 看不到我们（还没入队）——补一次 drain 兜住这个窗口
            drain();
        });
        if (handed) return handed;
    }
}
