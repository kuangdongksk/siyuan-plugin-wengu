import { errText } from "./../../../ui/shared";
import { convertDocBatched } from "../run/ConvertBatch";
import type { BatchedResult, ConvertProgress, ConvertProgressRecord } from "../run/ConvertBatch";
import { SetWriter } from "../output/SetWriter";
import { esc, fmt } from "../../../ui/shared";
import { notifyError, notifyInfo } from "../../../ui/Notify";
import type { QuestionBank } from "../../../bank/data/QuestionBank";
import type { SubDocRef } from "../source/SubDocs";
import { runBatchQueue } from "./ConvertBatchQueue";
import {
    getAborted,
    getActive,
    notifyState,
    setAborted,
    setActive,
    subscribeConvertState,
    type ActiveRun,
} from "./ConvertRunState";

/**
 * 转换执行器（从转换弹窗拆出的单例运行器）：弹窗只负责收集参数，
 * 点「开始转换」即关窗，批次循环在这里跑完。状态条/停止/终止后的
 * 保留-丢弃二选一都渲染在温故页签内（ConvertHost.convertBar），
 * 页签每批渐进呈现（题库直写后的内存视图，无内核轮询）。
 *
 * 状态机注意：failed/异常收口必须清 active——批次超时等失败若不清，
 * convertRunActive 永远为 true，之后任何「开始/继续转换」都被拒，
 * 弹窗只能报「已有转换在进行中」（真机踩坑：一次超时后继续转换
 * 永久不可用）。当前运行状态通过 convertRunSnapshot/subscribeConvertRun
 * 暴露给转换管理面板（ConvertPanel）单独呈现。
 *
 * **批量队列**（Issue #37）：`cfg.subDocs` 非空时同一单例运行器改跑
 * 一个串行队列——见 ConvertBatchQueue。队列**全程占住 active 槽**
 * （篇与篇之间不释放，防用户中途点别的转换插队）。
 */

/** 一次转换的全部参数（弹窗收集后传入）。 */
export interface ConvertRunCfg {
    srcDocId: string;
    modelId: string;
    fillToChoice: boolean;
    bigToSteps: boolean;
    /** 并发片流水线数（分片并行：片间并行、片内仍由 AI 自推进；1=串行）。
     *  上限 4，由转换弹窗/设置面板给值。 */
    parallel: number;
    knowRoots: string[];
    resume?: { offset: number; setId?: string };
    /** 批量队列（Issue #37）：非空时按序串行转换这些源文档（每篇各自成
     *  题集）。长度 1 与不传等价（单篇流程的退化形态）。 */
    subDocs?: SubDocRef[];
    /** 队列标题（=根文档标题，面板总行展示「第 x/N 篇 · 队列名」）。 */
    batchTitle?: string;
}

/** 页面侧事件（ConvertHost 组装：页内转换条 + 渐进呈现 + 收尾）。 */
export interface ConvertRunEvents {
    t: (k: string) => string;
    /** 题库（转换产物落库与终止丢弃都走它）。 */
    bank?: QuestionBank;
    setConverting(v: boolean): void;
    /** 状态条 HTML（进度文案由这里拼好，条上的按钮由渲染方加）。 */
    onStatus(html: string, kind: "ok" | "err" | "muted", terminal?: boolean): void;
    /** 一批已落库（渐进呈现：切题集 + 应用内存题目视图）。 */
    onBatch(p: ConvertProgress): void;
    /** 终止后的二选一：页面渲染「保留进度/全部丢弃」。 */
    onStopChoice(info: { count: number; batches: number; total: number; message?: string }): void;
    /** 全部丢弃后的页面复位。 */
    onCancel?(): void;
    onDone(r: { setId: string; title: string; count: number; message: string }): void;
    saveProgress(srcDocId: string, rec: ConvertProgressRecord | undefined): void;
    /** 批量队列里一篇的终态（进度行翻牌用；单篇流程不调）。 */
    onBatchItem?(item: ConvertBatchItem): void;
    /** 某源文档的未完成续跑记录（批量队列逐篇查用；单篇走 cfg.resume）。 */
    getProgress?(srcDocId: string): ConvertProgressRecord | undefined;
}

/** 批量队列里一篇的状态（面板分篇进度行）。 */
export interface ConvertBatchItem {
    /** 队列序号（0 起）。 */
    index: number;
    /** 队列总篇数。 */
    total: number;
    docId: string;
    title: string;
    status: "queued" | "running" | "done" | "failed" | "cancelled";
    /** 该篇已落库题数（done/failed 时有意义）。 */
    count: number;
    /** 该篇最近一次进度（running 时）。 */
    progress?: ConvertProgress;
    /** 失败原因（status=failed）。 */
    message?: string;
}

/** 订阅运行状态变化（进度推进/终止/收口/抉择落定都通知），返回退订函数。 */
export const subscribeConvertRun: (cb: () => void) => () => void = subscribeConvertState;

/** 是否有转换在跑（含终止后待抉择——此时开新转换会让旧抉择悬空）。 */
export function convertRunActive(): boolean {
    return !!getActive() || !!getAborted();
}

/** 运行快照（转换管理面板渲染用；无任何在途状态返回 undefined）。 */
export interface ConvertRunSnapshot {
    /** 批次循环运行中（含前置检测）。 */
    running: boolean;
    /** 终止后待「保留/丢弃」抉择。 */
    pendingChoice: boolean;
    srcDocId: string;
    parallel: number;
    /** 最近一次进度（面板进度行）。 */
    progress?: ConvertProgress;
    /** 题集标题。 */
    title?: string;
    /** 批量队列分篇进度（cfg.subDocs 非空时；每篇一行）。 */
    batch?: { title?: string; items: ConvertBatchItem[] };
    /** 待抉择部分结果（pendingChoice 时有）。 */
    pending?: { count: number; batches: number; total: number };
}

/** 当前运行状态快照（running=false 且无待抉择时返回 undefined）。 */
export function convertRunSnapshot(): ConvertRunSnapshot | undefined {
    const aborted = getAborted();
    const active = getActive();
    if (aborted) {
        const items = aborted.items;
        return {
            running: false,
            pendingChoice: true,
            srcDocId: aborted.cfg.srcDocId,
            parallel: aborted.cfg.parallel,
            batch: items ? { title: aborted.cfg.batchTitle, items } : undefined,
            pending: { count: aborted.r.count, batches: aborted.r.batches, total: aborted.r.total },
        };
    }
    if (!active) return undefined;
    return {
        running: true,
        pendingChoice: false,
        srcDocId: active.cfg.srcDocId,
        parallel: active.cfg.parallel,
        progress: active.progress,
        title: active.title,
        batch: active.items ? { title: active.batchTitle, items: active.items } : undefined,
    };
}

/** 进度行文案（页内转换条与转换管理面板共用；返回 HTML 安全串）。逐段
 *  自推进的总批数事前未知，进度按「已读原文百分比 + 累计题数」呈现。 */
export function progressStatusText(t: (k: string) => string, p: ConvertProgress): string {
    if (p.phase === "detect") return esc(t("convertDetecting"));
    if (p.phase === "writing") return esc(t("settling"));
    const lastDelta = p.lastBatch > 0 ? ` · ${esc(fmt(t("convertLastBatch"), { k: String(p.lastBatch) }))}` : "";
    const main =
        p.readPct !== undefined
            ? esc(fmt(t("convertStepProgress"), { p: String(p.readPct), c: String(p.count) }))
            : esc(fmt(t("convertBatchProgress"), { i: String(p.batch + 1), n: String(p.total), c: String(p.count) }));
    return `${main}${lastDelta}`;
}

/** 批量队列的分篇进度行文案（面板每篇一行 + 总行）。 */
export function batchItemStatusText(t: (k: string) => string, item: ConvertBatchItem): string {
    switch (item.status) {
        case "queued":
            return esc(t("convertBatchQueued"));
        case "cancelled":
            return esc(t("convertBatchCancelled"));
        case "failed":
            return esc(fmt(t("convertBatchFailed"), { msg: item.message || t("convertNoQuestions") }));
        case "done":
            return esc(fmt(t("convertBatchDoneItem"), { c: String(item.count) }));
        default:
            return item.progress ? progressStatusText(t, item.progress) : esc(t("converting"));
    }
}

/** 队列总行文案（「第 x/N 篇 · 队列名」）；cur=当前进行中（或最后收口）那篇。 */
export function batchHeadText(t: (k: string) => string, batch: { title?: string; items: ConvertBatchItem[] }): string {
    const items = batch.items ?? [];
    const total = items.length;
    const running = items.findIndex((x) => x.status === "running");
    const settled = items.filter(
        (x) => x.status === "done" || x.status === "failed" || x.status === "cancelled"
    ).length;
    const cur = running >= 0 ? running + 1 : Math.max(1, settled);
    return esc(
        fmt(t("convertBatchHead"), { i: String(Math.min(total, cur)), n: String(total), title: batch.title ?? "" })
    );
}

/** 启动一次转换（已有在途运行/待抉择则拒绝，返回 false）。 */
export function startConvertRun(cfg: ConvertRunCfg, ev: ConvertRunEvents): boolean {
    if (getActive() || getAborted()) return false;
    const controller = new AbortController();
    const run: ActiveRun = { cfg, ev, abort: () => controller.abort() };
    if (cfg.subDocs && cfg.subDocs.length > 0) {
        run.batchTitle = cfg.batchTitle ?? cfg.subDocs[0].title;
        run.items = cfg.subDocs.map((d, index) => ({
            index,
            total: cfg.subDocs!.length,
            docId: d.id,
            title: d.title,
            status: "queued",
            count: 0,
        }));
    }
    setActive(run);
    const t = ev.t;
    ev.setConverting(true);
    ev.onStatus(esc(t("converting")), "muted");
    notifyState();
    void (async () => {
        if (cfg.subDocs && cfg.subDocs.length > 0) {
            await runBatchQueue(run, controller.signal);
        } else {
            await runSingleDoc(run, controller.signal, cfg.srcDocId, cfg.resume, 0);
        }
    })();
    return true;
}

/**
 * 单篇执行全过程（批量队列里也逐篇走它——队列只是它外面的一层串行
 * 循环）。收口时按三种终态分别落定：done→清槽+收尾；aborted→抉择态；
 * failed→清槽+（有产物则记续跑进度）+通知。
 */
export async function runSingleDoc(
    run: ActiveRun,
    signal: AbortSignal,
    docId: string,
    resume: { offset: number; setId?: string } | undefined,
    batchIndex: number,
    /** 队列内（批量）逐篇：清槽/记进度/收尾都按篇来，由调用方收口；
     *  单篇（false）沿用原行为。 */
    inQueue = false
): Promise<BatchedResult | undefined> {
    const { cfg, ev } = run;
    const t = ev.t;
    let r: BatchedResult;
    try {
        if (!ev.bank) throw new Error("bank unavailable");
        r = await convertDocBatched(docId, {
            t,
            modelId: cfg.modelId,
            fillToChoice: cfg.fillToChoice,
            bigToSteps: cfg.bigToSteps,
            parallel: cfg.parallel,
            signal,
            resume,
            knowRoots: cfg.knowRoots,
            bank: ev.bank,
            onProgress: (p) => {
                if (getActive() === run) {
                    run.progress = p;
                    if (p.title) run.title = p.title;
                    const item = run.items?.[batchIndex];
                    if (item) {
                        item.status = "running";
                        item.progress = p;
                        item.count = p.count;
                    }
                }
                if (p.phase === "detect") {
                    ev.onStatus(esc(t("convertDetecting")), "muted");
                    notifyState();
                    return;
                }
                if (p.phase === "writing") {
                    ev.onStatus(esc(t("settling")), "muted");
                    if (p.setId) ev.onBatch(p);
                    notifyState();
                    return;
                }
                // batch=i 表示第 i+1 批进行中；lastBatch 是刚完成那批的题数
                if (p.setId) ev.onBatch(p);
                ev.onStatus(progressStatusText(t, p), "muted");
                notifyState();
            },
        });
    } catch (e) {
        // 意外异常同样必须清 active，否则单例卡死（见文件头注释）
        if (getActive() === run) {
            setActive(undefined);
            ev.setConverting(false);
        }
        const msg = errText(e);
        ev.onStatus(esc(msg), "err", true);
        notifyError({ key: "notifyConvertFail", vars: { msg } });
        notifyState();
        return undefined;
    }
    if (r.status === "done") {
        settleDone(run, r, docId, inQueue);
        return r;
    }
    if (r.status === "aborted") {
        settleAborted(run, r, docId);
        return r;
    }
    settleFailed(run, r, docId);
    return r;
}

/** done：清槽 + 清**本篇**的残留进度记录（残留会让面板永远显示「有未完成
 *  转换」，「丢弃」按钮更会直接删掉已完成的题集、「继续生成」会重复收口
 *  ——20260829 三轮审查 P1）。inQueue=false（单篇）才由本处收尾；队列内
 *  由 ConvertBatchQueue 记分篇终态、逐篇清进度，整队列末尾只收尾一次。 */
function settleDone(run: ActiveRun, r: BatchedResult, docId: string, inQueue: boolean): void {
    const { ev } = run;
    if (!inQueue && getActive() === run) {
        setActive(undefined);
        ev.setConverting(false);
    }
    ev.saveProgress(docId, undefined);
    notifyState();
    if (!inQueue) void finishRun(ev, r);
}

/** aborted：首批前零产物=无保留/丢弃可言（直接终态）；否则转抉择态。
 *  抉择记录里的 cfg 换成**本篇**的副本——单篇的 keep/discard 用
 *  cfg.srcDocId 记/清进度，队列里那必须是当前篇而不是根。 */
function settleAborted(run: ActiveRun, r: BatchedResult, docId: string): void {
    const { cfg, ev } = run;
    const t = ev.t;
    if (getActive() === run) {
        setActive(undefined);
        ev.setConverting(false);
    }
    if (!r.setId) {
        ev.onStatus(esc(t("convertStoppedEmpty")), "err", true);
        notifyState();
        return;
    }
    const head = r.message ? `${esc(r.message)}<br>` : "";
    ev.onStopChoice({ count: r.count, batches: r.batches, total: r.total, message: head });
    setAborted({ r, cfg: { ...cfg, srcDocId: docId }, ev, items: run.items });
    notifyState();
}

/** failed：清槽；有部分产物则记**本篇**进度可「继续生成」。 */
function settleFailed(run: ActiveRun, r: BatchedResult, docId: string): void {
    const { ev } = run;
    const t = ev.t;
    if (getActive() === run) {
        setActive(undefined);
        ev.setConverting(false);
    }
    const partial = r.count > 0 ? `<br>${esc(t("convertPartialKept"))}` : "";
    ev.onStatus(`${esc(r.message || t("convertNoQuestions"))}${partial}`, "err", true);
    notifyError({ key: "notifyConvertFail", vars: { msg: r.message || t("convertNoQuestions") } });
    if (r.count > 0 && r.setId) {
        ev.saveProgress(docId, {
            setId: r.setId,
            title: r.title ?? "",
            offset: r.doneOffset,
            batches: r.batches,
            total: r.total,
            count: r.count,
        });
    }
    notifyState();
}

/** 页内/面板「停止」：中止批次循环，转保留/丢弃抉择。
 *  批量队列下=当前篇转抉择 + 剩余篇取消（见 ConvertBatchQueue）。 */
export function stopConvertRun(): void {
    getActive()?.abort();
}

/** 独占运行槽（增量重转换等非整卷流程共用）：占住 active 单例防并发
 *  开跑（convertRunActive 对所有入口生效），执行体自带进度与收尾；
 *  「停止」走同一条 stopConvertRun → signal 中止，由执行体自行收口
 *  （增量已落库部分自带指纹，重跑分类即跳过，无需抉择态）。 */
export function startExclusiveConvertRun(
    ev: ConvertRunEvents,
    srcDocId: string,
    run: (signal: AbortSignal) => Promise<void>
): boolean {
    if (getActive() || getAborted()) return false;
    const controller = new AbortController();
    setActive({
        cfg: {
            srcDocId,
            modelId: "",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 1,
            knowRoots: [],
        },
        ev,
        abort: () => controller.abort(),
    });
    ev.setConverting(true);
    notifyState();
    void run(controller.signal)
        .catch((e) => {
            ev.onStatus(esc(errText(e)), "err", true);
        })
        .finally(() => {
            setActive(undefined);
            ev.setConverting(false);
            notifyState();
        });
    return true;
}

/** 页内/面板「保留已生成」：题目记录已在题库（每批已 flush），只记
 *  断点进度供「继续生成」。 */
export function keepConvertRun(): Promise<void> {
    const a = getAborted();
    if (!a) return Promise.resolve();
    setAborted(undefined);
    notifyState();
    const { saveProgress } = a.ev;
    return (async () => {
        if (!a.r.setId) return; // 无产物无保留（入口已拦，防御）
        saveProgress(a.cfg.srcDocId, {
            setId: a.r.setId,
            title: a.r.title ?? "",
            offset: a.r.doneOffset,
            batches: a.r.batches,
            total: a.r.total,
            count: a.r.count,
        });
        await finishRun(a.ev, a.r);
    })()
        .catch((e) => a.ev.onStatus(esc(errText(e)), "err", true))
        .then(() => notifyState());
}

/** 页内/面板「全部丢弃」：按本次写入 qid 回收题库记录（题集清空连
 *  元数据一起删）、清进度、页面复位。 */
export function discardConvertRun(): void {
    const a = getAborted();
    if (!a) return;
    setAborted(undefined);
    if (a.ev.bank) void new SetWriter(a.ev.bank).discard(a.r.setId, a.r.writtenQids);
    a.ev.saveProgress(a.cfg.srcDocId, undefined);
    a.ev.onCancel?.();
    a.ev.onStatus(esc(a.ev.t("convertDiscarded")), "muted", true);
    notifyState();
}

/** 转换收尾：题库最终 flush → 通知宿主（切题集/重载/状态条）。 */
async function finishRun(ev: ConvertRunEvents, r: BatchedResult): Promise<void> {
    if (!r.setId) return;
    await ev.bank?.flush().catch((): void => undefined);
    notifyInfo({ key: "notifyConvertDone", vars: { n: String(r.count) } }); // 长任务完成，用户可能已切走
    ev.onDone({ setId: r.setId, title: r.title ?? "", count: r.count, message: r.message });
}
