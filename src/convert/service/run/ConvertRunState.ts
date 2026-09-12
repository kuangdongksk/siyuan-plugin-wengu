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
    /** 所属队列维度（Issue #37）：保留记录据此落 batch 字段——面板「未完成
     *  记录」行要能标出「第 i/N 篇」，否则重开思源后分不清是哪一篇。 */
    batch?: BatchMeta;
}

/** 进度记录的批量维度（= ConvertProgressRecord.batch 的载荷）。 */
export interface BatchMeta {
    /** 队列内序号（0 起）。 */
    index: number;
    total: number;
    groupTitle?: string;
}

/** 某源文档在队列里的批量维度（纯函数）：不在队列里/队列为空 → undefined
 *  （单篇转换的记录**不带** batch 键，装载侧照旧——数据演进守则
 *  「optional + 只加不改名」，不 bump version、无 backfill）。 */
export function batchMetaOf(cfg: ConvertRunCfg, docId: string): BatchMeta | undefined {
    const list = cfg.subDocs;
    if (!list || list.length === 0) return undefined;
    const index = list.findIndex((d) => d.id === docId);
    if (index < 0) return undefined;
    return { index, total: list.length, groupTitle: cfg.batchTitle };
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
