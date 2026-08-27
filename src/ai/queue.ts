/**
 * 无 sessionID agentChat 的共享串行队列：内核并发锁按 sessionID 键控，
 * 不传 sessionID 的调用全部撞在 "" 这一个 key 上（20260827 定论，
 * 20260823 的「全局互斥」假象即源于此）——判分/单词复盘等 "" 会话
 * 调用一律过这条队列（原 AiJudge/WordAi 各自的模块级队列合并为一条，
 * 顺带消掉跨域并发互撞）。agentChatOnce（独立 sessionID）不受此限。
 */
let queue: Promise<unknown> = Promise.resolve();

export function enqueueAi<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.then(
        (): void => undefined,
        (): void => undefined
    );
    return run;
}
