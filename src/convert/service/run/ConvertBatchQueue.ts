import { esc, fmt } from "../../../ui/shared";
import { notifyError, notifyInfo } from "../../../ui/Notify";
import type { BatchedResult } from "../run/ConvertBatch";
import { runSingleDoc, type ConvertBatchItem, type ConvertRunEvents } from "./ConvertRun";
import { notifyState, setActive, type ActiveRun } from "./ConvertRunState";

/**
 * 批量转换串行队列（Issue #37）：转换弹窗选中的「文件夹式文档」展开成
 * 一棵子文档清单后，本模块按序**逐篇串行**跑 ConvertRun 的单篇执行体
 * （runSingleDoc）——一篇完整跑完（或终止）再起下一篇，与
 * ConvertIncrement 的串行补生成循环、BankHealth.regenRecords 的后台批量
 * 同款。
 *
 * 四条硬口径：
 *  1. **串行**：内层 await 逐篇 resolve，绝不并发起第二篇；
 *  2. **队列全程占住 active 槽**：换篇时 `setActive(run)` 把槽再占回来
 *     （内层单篇 done/failed 收口会清空槽）+ `setConverting(true)` 复位
 *     页内「转换中」标记；只有整队列收口或转抉择态才真正释放——否则用户
 *     能在换篇间隙插队（页内转换按钮也会误判成空闲）；
 *  3. **单篇失败不打断队列**：记一行失败、继续下一篇；终态汇总
 *     「N 篇完成、M 篇失败：清单」走 Notify + 状态条。
 *  4. **「停止」= 整队列停**：当前篇若已有产物转保留/丢弃抉择（沿用单篇
 *     aborted 语义），剩余篇全部标 cancelled 并给汇总。
 */

/** 队列汇总（终态通知/状态条）。四段之和 = 队列总篇数（不许有篇被漏计）。 */
interface QueueTail {
    done: number;
    /** 用户终止时**正在跑**的那篇（未跑完，也无产物可保留）。 */
    stopped: number;
    failed: string[];
    /** 因终止而**没跑**的剩余篇。 */
    cancelled: number;
}

/** items 缺失时的兜底元素（理论不可达，防御）。 */
function itemOf(run: ActiveRun, i: number): ConvertBatchItem {
    const doc = run.cfg.subDocs?.[i];
    return {
        index: i,
        total: run.cfg.subDocs?.length ?? 1,
        docId: doc?.id ?? "",
        title: doc?.title ?? "",
        status: "failed",
        count: 0,
    };
}

/** 翻牌某篇状态并广播（面板分篇行刷新）。 */
function flip(run: ActiveRun, i: number, patch: Partial<ConvertBatchItem>): void {
    const item = run.items?.[i] ?? itemOf(run, i);
    Object.assign(item, patch);
    run.ev.onBatchItem?.(item);
    notifyState();
}

/** 跑一个批量队列（`startConvertRun` 在 cfg.subDocs 非空时调）。 */
export async function runBatchQueue(run: ActiveRun, signal: AbortSignal): Promise<void> {
    const { cfg, ev } = run;
    const t = ev.t;
    const docs = cfg.subDocs ?? [];
    const failed: string[] = [];
    let done = 0;
    /** 已标取消的篇数（循环 break 与停止两条路径都会累计）。 */
    let cancelled = 0;
    /** 最后一篇成功产物（队列收口时切到它——与单篇 onDone 同口径）。 */
    let last: BatchedResult | undefined;

    /** 从 from 起把仍未跑的篇标取消（停止时：剩余篇一篇都别跑）。
     *  返回本次翻掉的篇数——**必须真翻**：只算总数不改状态的话，面板
     *  分篇行会永远停在「排队中」，而汇总却报「已取消 N 篇」。 */
    const cancelRest = (from: number): number => {
        let n = 0;
        for (let j = from; j < docs.length; j++) {
            if (run.items?.[j]?.status === "queued") {
                flip(run, j, { status: "cancelled" });
                n++;
            }
        }
        return n;
    };

    for (let i = 0; i < docs.length; i++) {
        if (signal.aborted) {
            // 停止后剩余篇一篇都不跑（当前篇的收口已在上轮循环处理）
            cancelled += cancelRest(i);
            break;
        }
        flip(run, i, { status: "running" });
        // 换篇：清掉上一篇的进度/标题，面板切到本篇；槽与「转换中」标记
        // **不**释放（内层单篇 failed 收口会清槽 + 复位该标记，这里占回来）
        run.progress = undefined;
        ev.setConverting(true);
        ev.onStatus(
            esc(fmt(t("convertBatchHead"), { i: String(i + 1), n: String(docs.length), title: run.batchTitle ?? "" })),
            "muted"
        );
        setActive(run);
        notifyState();
        // 各篇续跑记录按 id 各自查（队列里排队中的篇通常还没有记录）
        const resume = resumeOf(ev, docs[i].id);
        const r = await runSingleDoc(run, signal, docs[i].id, resume, i, true);
        if (!r) {
            // 意外异常（runSingleDoc 已收口为 err 终态）：记失败继续下一篇
            flip(run, i, { status: "failed", message: t("convertAiFailed").trim() });
            failed.push(docs[i].title);
            continue;
        }
        if (r.status === "done") {
            done++;
            if (r.setId) last = r;
            flip(run, i, { status: "done", count: r.count });
            continue;
        }
        if (r.status === "aborted") {
            // 本篇=用户终止时**正在跑**的那篇（已生成部分待抉择），与剩余
            // 未跑的篇（cancelled）是两回事——面板分篇行据此区分显示
            flip(run, i, { status: "stopped", count: r.count });
            cancelled += cancelRest(i + 1);
            if (!r.setId) {
                // 首批前终止（该篇零产物）：无保留/丢弃可言 → 队列直接收口
                await finishQueue(ev, t, { done, stopped: 1, failed, cancelled }, last);
                return;
            }
            // 有产物：该篇转抉择态（runSingleDoc 已置 aborted，items 随之
            // 落进抉择记录——面板在抉择态仍显示各篇终态），剩余篇已取消。
            // **释放 active 槽**：队列无剩余可跑，槽交给抉择态持有
            //（convertRunActive 仍为真，防插队），抉择落定后 keep/discard 清。
            setActive(undefined);
            ev.setConverting(false);
            notifyState();
            notifyQueueTail(ev, t, { done, stopped: 1, failed, cancelled });
            return;
        }
        // 中途失败：有部分产物则记续跑进度（该篇可「继续生成」），继续下一篇
        failed.push(docs[i].title);
        flip(run, i, { status: "failed", message: r.message || t("convertNoQuestions"), count: r.count });
    }
    await finishQueue(ev, t, { done, stopped: 0, failed, cancelled }, last);
}

/** 队列收口：释放槽 + 切到最后一篇产物（onDone）+ 汇总状态条/通知。
 *  onDone 只在真正有产物时调（全失败/全取消没有可加载的题集）。 */
async function finishQueue(
    ev: ConvertRunEvents,
    t: (k: string) => string,
    tail: QueueTail,
    last?: BatchedResult
): Promise<void> {
    setActive(undefined);
    ev.setConverting(false);
    notifyState();
    notifyQueueTail(ev, t, tail);
    if (last?.setId) {
        await ev.bank?.flush().catch((): void => undefined);
        ev.onDone({ setId: last.setId, title: last.title ?? "", count: last.count, message: last.message });
    }
}

/** 队列汇总文案（成功/失败/取消三段拼装）→ 状态条 + Notify。 */
function notifyQueueTail(ev: ConvertRunEvents, t: (k: string) => string, tail: QueueTail): void {
    const parts: string[] = [];
    // 成功段在「一篇没成」且另有说法时省掉——「完成 0 篇 · 3 篇已取消」的
    // 前半句是噪音，用户只关心后段
    if (tail.done > 0 || (tail.failed.length === 0 && tail.cancelled === 0 && tail.stopped === 0)) {
        parts.push(fmt(t("convertBatchTailDone"), { n: String(tail.done) }));
    }
    if (tail.stopped > 0) parts.push(fmt(t("convertBatchTailStopped"), { n: String(tail.stopped) }));
    if (tail.failed.length > 0) {
        parts.push(fmt(t("convertBatchTailFail"), { n: String(tail.failed.length), list: tail.failed.join("；") }));
    }
    if (tail.cancelled > 0) parts.push(fmt(t("convertBatchTailCancel"), { n: String(tail.cancelled) }));
    const msg = parts.join(" · ");
    ev.onStatus(esc(msg), tail.failed.length > 0 ? "err" : "ok", true);
    if (tail.failed.length > 0) notifyError({ key: "notifyConvertFail", vars: { msg } });
    else notifyInfo(msg);
}

/** 某篇的续跑记录（事件里透传的 getProgress；无则该篇从头转）。 */
function resumeOf(ev: ConvertRunEvents, docId: string): { offset: number; setId?: string } | undefined {
    const rec = ev.getProgress?.(docId);
    return rec ? { offset: rec.offset, setId: rec.setId } : undefined;
}
