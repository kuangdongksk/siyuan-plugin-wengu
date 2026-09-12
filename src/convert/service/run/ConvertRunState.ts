import type { BatchedResult, ConvertProgress } from "../run/ConvertBatch";
import type { ConvertRunCfg, ConvertRunEvents, ConvertBatchItem } from "./ConvertRun";

/**
 * ConvertRun 单例运行器的**共享状态**（Issue #37 拆出压 ConvertRun
 * 500 行红线）：运行槽 active / 终止待抉择 aborted / 订阅通知，被
 * ConvertRun（单篇与入口编排）与 ConvertBatchQueue（批量队列串行循环）
 * 共用。本模块只放状态与读写，不含流程——流程在两者里。
 */

/** 在途运行（含终止后待抉择的部分结果）。 */
export interface ActiveRun {
    cfg: ConvertRunCfg;
    ev: ConvertRunEvents;
    abort: () => void;
    /** 面板快照用：最近一次进度。 */
    progress?: ConvertProgress;
    /** 题集标题（onBatch 里累积，面板展示用）。 */
    title?: string;
    /** 批量队列分篇状态（cfg.subDocs 非空时；每篇一行）。 */
    items?: ConvertBatchItem[];
    /** 队列标题（cfg.batchTitle）。 */
    batchTitle?: string;
}

/** 在途运行槽（undefined=空闲）。 */
let active: ActiveRun | undefined;

/** 终止后待抉择的部分结果（保留/丢弃的执行体用）。批量队列下 items
 *  随记录一起留下——面板在抉择态仍要显示各篇终态。 */
export interface AbortedRun {
    r: BatchedResult;
    cfg: ConvertRunCfg;
    ev: ConvertRunEvents;
    items?: ConvertBatchItem[];
}

let aborted: AbortedRun | undefined;

/** 运行状态变化订阅（转换管理面板刷新用）。 */
const listeners = new Set<() => void>();

/** 订阅运行状态变化（进度推进/终止/收口/抉择落定都通知），返回退订函数。 */
export function subscribeConvertState(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

/** 广播状态变化（流程每推进一步调用）。 */
export function notifyState(): void {
    for (const l of [...listeners]) l();
}

export function getActive(): ActiveRun | undefined {
    return active;
}

export function setActive(run: ActiveRun | undefined): void {
    active = run;
}

export function getAborted(): AbortedRun | undefined {
    return aborted;
}

export function setAborted(a: AbortedRun | undefined): void {
    aborted = a;
}
