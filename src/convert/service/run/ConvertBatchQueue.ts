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
 *  2. **队列全程占住 active 槽**：换篇时 `setActive(run)` + `setConverting(true)`
 *     都补一次——内层单篇 **failed 收口会清空槽并复位「转换中」标记**
 *     （done 分支的 inQueue=true 不清，故这里补的是兜底、不是唯一写入点）；
 *     只有整队列收口或转抉择态才真正释放——否则用户能在换篇间隙插队
 *     （页内转换按钮也会误判成空闲）；
 *  3. **单篇失败不打断队列**：记一行失败、继续下一篇；终态汇总
 *     「N 篇完成、M 篇失败：清单」走 Notify + 状态条。
 *  4. **「停止」= 整队列停**：当前篇若已有产物转保留/丢弃抉择（沿用单篇
 *     aborted 语义），剩余篇全部标 cancelled 并给汇总。
 *  5. **重发跳过已完成篇**（Issue #62）：起跑前建一次 `srcId → setId` 映射，
 *     无续跑记录、但题库里已有该源文档题集的篇=「转换完成过」→ 直接跳过
 *     （零 AI）；勾了 `reconvertDone` 则照常跑。判定收口在 `classifyQueueItem`。
 */

/** 队列汇总（终态通知/状态条）。**五段之和 = 队列总篇数**（不许有篇被
 *  漏计）：done + skipped + stopped + failed.length + cancelled。 */
interface QueueTail {
    done: number;
    /** 起跑前即判定「已转换过」而跳过的篇（Issue #62，零 AI）。 */
    skipped: number;
    /** 用户终止时**正在跑**的那篇（未跑完，也无产物可保留）。 */
    stopped: number;
    failed: string[];
    /** 因终止而**没跑**的剩余篇。 */
    cancelled: number;
}

/**
 * 起跑前的逐篇判定（Issue #62，纯函数、带单测）：
 *  1. 有续跑记录 → `resume`（照旧断点续跑）；
 *  2. 无记录但题库已有该源文档的题集 → 视为**已完成**（`skip`，零 AI）；
 *  3. 皆无 → 从头转（`fresh`）。
 *
 * 「已转换过」的判据是 `sets` 里存在 `srcId === 该篇 id` 的题集——题集由
 * 转换产物派生（每批即落库），误判面已由 Issue 论证：保留/失败篇必有进度
 * 记录（走分支 1）、丢弃与「删除此题集」会连题集一起删、崩溃时的进行中篇
 * 由逐批检查点兜住（也有记录）——故「无记录 + 有题集」基本等价于
 * 「转换完成过」，且**宁可不跳过**：任何一环查不到就按从头转（多烧一次
 * AI 好过静默漏转）。
 *
 * @param hasSet 该篇源文档是否已有题集（由调用方一次性建好的映射回答）
 */
export function classifyQueueItem(
    resume: { offset: number; setId?: string } | undefined,
    hasSet: boolean,
    reconvertDone: boolean
): "resume" | "skip" | "fresh" {
    if (resume) return "resume";
    if (hasSet && !reconvertDone) return "skip";
    return "fresh";
}

/** 建 `srcId → setId` 映射（**一次 `bank.all()`**，别逐篇 all()）。 */
async function setIdsBySrc(run: ActiveRun): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
        const data = await run.ev.bank?.all();
        for (const [id, set] of Object.entries(data?.sets ?? {})) {
            if (set.srcId && !map.has(set.srcId)) map.set(set.srcId, id);
        }
    } catch (_) {
        // 查库失败=全部按「无题集」处置（照常从头转，宁多烧不漏转）
    }
    return map;
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
    let skipped = 0;
    /** 已标取消的篇数（循环 break 与停止两条路径都会累计）。 */
    let cancelled = 0;
    /** 起跑前一次建好的 `srcId → setId` 映射（跳过判定用，零额外 SQL）。 */
    const setBySrc = await setIdsBySrc(run);
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
        // 各篇续跑记录按 id 各自查（队列里排队中的篇通常还没有记录）
        const resume = resumeOf(ev, docs[i].id);
        // 重发队列跳过已完成篇（Issue #62）：有记录照旧续跑；无记录但题库
        // 已有该篇题集=转换完成过 → 零 AI 跳过（勾了「重转已转换过的篇」则照跑）
        const kind = classifyQueueItem(resume, setBySrc.has(docs[i].id), cfg.reconvertDone === true);
        if (kind === "skip") {
            skipped++;
            flip(run, i, { status: "skipped" });
            continue;
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
                await finishQueue(ev, t, { done, skipped, stopped: 1, failed, cancelled }, last);
                return;
            }
            // 有产物：该篇转抉择态（runSingleDoc 已置 aborted，items 随之
            // 落进抉择记录——面板在抉择态仍显示各篇终态），剩余篇已取消。
            // **释放 active 槽**：队列无剩余可跑，槽交给抉择态持有
            //（convertRunActive 仍为真，防插队），抉择落定后 keep/discard 清。
            setActive(undefined);
            ev.setConverting(false);
            notifyState();
            notifyQueueTail(ev, t, { done, skipped, stopped: 1, failed, cancelled });
            return;
        }
        // 中途失败：有部分产物则记续跑进度（该篇可「继续生成」），继续下一篇
        failed.push(docs[i].title);
        flip(run, i, { status: "failed", message: r.message || t("convertNoQuestions"), count: r.count });
    }
    await finishQueue(ev, t, { done, skipped, stopped: 0, failed, cancelled }, last);
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
    // 前半句是噪音，用户只关心后段（跳过也算「另有说法」）
    if (
        tail.done > 0 ||
        (tail.failed.length === 0 && tail.cancelled === 0 && tail.stopped === 0 && tail.skipped === 0)
    ) {
        parts.push(fmt(t("convertBatchTailDone"), { n: String(tail.done) }));
    }
    if (tail.skipped > 0) parts.push(fmt(t("convertBatchTailSkipped"), { n: String(tail.skipped) }));
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
