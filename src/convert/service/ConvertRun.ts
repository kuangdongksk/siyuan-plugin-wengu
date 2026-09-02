import { convertDocBatched } from "./ConvertBatch";
import type { BatchedResult, ConvertProgress, ConvertProgressRecord } from "./ConvertBatch";
import { getDocInfo, removeDoc, toConvertResult, writeExerciseDoc } from "./ConvertService";
import { waitForDocInList } from "../../quiz/service/QuestionService";
import { newAiGroupId } from "../../ai/client";
import { esc, fmt } from "../../ui/shared";
import { notifyError, notifyInfo } from "../../ui/Notify";

/**
 * 转换执行器（从转换弹窗拆出的单例运行器）：弹窗只负责收集参数，
 * 点「开始转换」即关窗，批次循环在这里跑完。状态条/停止/终止后的
 * 保留-丢弃二选一都渲染在温故页签内（ConvertHost.convertBar），
 * 页签每批渐进呈现（ProgressivePreview）照旧。
 *
 * 状态机注意：failed/异常收口必须清 active——批次超时等失败若不清，
 * convertRunActive 永远为 true，之后任何「开始/继续转换」都被拒，
 * 弹窗只能报「已有转换在进行中」（真机踩坑：一次超时后继续转换
 * 永久不可用）。当前运行状态通过 convertRunSnapshot/subscribeConvertRun
 * 暴露给转换管理面板（ConvertPanel）单独呈现。
 */

/** 一次转换的全部参数（弹窗收集后传入）。 */
export interface ConvertRunCfg {
    srcDocId: string;
    modelId: string;
    fillToChoice: boolean;
    bigToSteps: boolean;
    parallel: number;
    targetRaw: string;
    knowRoots: string[];
    resume?: { offset: number; docId?: string; kramdown?: string };
}

/** 页面侧事件（ConvertHost 组装：页内转换条 + 渐进呈现 + 收尾）。 */
export interface ConvertRunEvents {
    t: (k: string) => string;
    setConverting(v: boolean): void;
    /** 状态条 HTML（进度文案由这里拼好，条上的按钮由渲染方加）。 */
    onStatus(html: string, kind: "ok" | "err" | "muted", terminal?: boolean): void;
    onBatch(docId: string, title: string, count: number, batch: number, total: number): void;
    /** 终止后的二选一：页面渲染「保留进度/全部丢弃」。 */
    onStopChoice(info: { count: number; batches: number; total: number; message?: string }): void;
    /** 全部丢弃后的页面复位。 */
    onCancel?(): void;
    onDone(r: { docId: string; title: string; count: number; message: string }): void;
    saveProgress(srcDocId: string, rec: ConvertProgressRecord | undefined): void;
}

/** 在途运行（含终止后待抉择的部分结果）。 */
interface ActiveRun {
    cfg: ConvertRunCfg;
    ev: ConvertRunEvents;
    abort: () => void;
    /** 面板快照用：最近一次进度。 */
    progress?: ConvertProgress;
    /** 渐进文档标题（onBatch 里累积，面板展示用）。 */
    title?: string;
}

let active: ActiveRun | undefined;

/** 终止后待抉择的部分结果（保留/丢弃的执行体用）。 */
let aborted: { r: BatchedResult; cfg: ConvertRunCfg; ev: ConvertRunEvents } | undefined;

/** 运行状态变化订阅（转换管理面板刷新用）。 */
const listeners = new Set<() => void>();

/** 订阅运行状态变化（进度推进/终止/收口/抉择落定都通知），返回退订函数。 */
export function subscribeConvertRun(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function notify(): void {
    for (const l of [...listeners]) l();
}

/** 是否有转换在跑（含终止后待抉择——此时开新转换会让旧抉择悬空）。 */
export function convertRunActive(): boolean {
    return !!active || !!aborted;
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
    /** 渐进文档标题。 */
    title?: string;
    /** 待抉择部分结果（pendingChoice 时有）。 */
    pending?: { count: number; batches: number; total: number };
}

/** 当前运行状态快照（running=false 且无待抉择时返回 undefined）。 */
export function convertRunSnapshot(): ConvertRunSnapshot | undefined {
    if (aborted) {
        return {
            running: false,
            pendingChoice: true,
            srcDocId: aborted.cfg.srcDocId,
            parallel: aborted.cfg.parallel,
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
    };
}

/** 进度行文案（页内转换条与转换管理面板共用；返回 HTML 安全串）。 */
export function progressStatusText(t: (k: string) => string, parallel: number, p: ConvertProgress): string {
    if (p.phase === "detect") return esc(t("convertDetecting"));
    if (p.phase === "writing") return esc(t("settling"));
    const totalHint =
        p.detected !== undefined && p.detected > 0
            ? ` · ${esc(fmt(t("convertDetected"), { n: String(p.detected) }))}${p.detectedTruncated ? "+" : ""}`
            : p.total > 1
              ? ` · ${esc(t("convertTotalUnknown"))}`
              : "";
    const lastDelta = p.lastBatch > 0 ? ` · ${esc(fmt(t("convertLastBatch"), { k: String(p.lastBatch) }))}` : "";
    const main =
        parallel > 1
            ? esc(
                  fmt(t("convertBatchParallel"), {
                      b: String(p.batch),
                      n: String(p.total),
                      c: String(p.count),
                  })
              )
            : esc(
                  fmt(t("convertBatchProgress"), {
                      i: String(p.batch + 1),
                      n: String(p.total),
                      c: String(p.count),
                  })
              );
    return `${main}${lastDelta}${totalHint}`;
}

/** 启动一次转换（已有在途运行/待抉择则拒绝，返回 false）。 */
export function startConvertRun(cfg: ConvertRunCfg, ev: ConvertRunEvents): boolean {
    if (active || aborted) return false;
    const controller = new AbortController();
    active = { cfg, ev, abort: () => controller.abort() };
    const t = ev.t;
    ev.setConverting(true);
    ev.onStatus(esc(t("converting")), "muted");
    notify();
    void (async () => {
        let r: BatchedResult;
        try {
            r = await convertDocBatched(cfg.srcDocId, {
                t,
                modelId: cfg.modelId,
                fillToChoice: cfg.fillToChoice,
                bigToSteps: cfg.bigToSteps,
                parallel: cfg.parallel,
                signal: controller.signal,
                resume: cfg.resume,
                targetRaw: cfg.targetRaw,
                knowRoots: cfg.knowRoots,
                trackGroup: newAiGroupId(), // 检测/生成/路由挂同组（AI 会话面板树归并）
                onProgress: (p) => {
                    if (active) {
                        active.progress = p;
                        if (p.title) active.title = p.title;
                    }
                    if (p.phase === "detect") {
                        ev.onStatus(esc(t("convertDetecting")), "muted");
                        notify();
                        return;
                    }
                    if (p.phase === "writing") {
                        ev.onStatus(esc(t("settling")), "muted");
                        if (p.docId) ev.onBatch(p.docId, p.title ?? "", p.count, p.batch, p.total);
                        notify();
                        return;
                    }
                    // batch=i 表示第 i+1 批进行中；lastBatch 是刚完成那批的题数
                    if (p.docId) ev.onBatch(p.docId, p.title ?? "", p.count, p.batch, p.total);
                    ev.onStatus(progressStatusText(t, cfg.parallel, p), "muted");
                    notify();
                },
            });
        } catch (e) {
            // 意外异常同样必须清 active，否则单例卡死（见文件头注释）
            active = undefined;
            ev.setConverting(false);
            const msg = String((e as Error)?.message ?? e);
            ev.onStatus(esc(msg), "err", true); // 终态：状态条不再带终止钮/replay
            notifyError({ key: "notifyConvertFail", vars: { msg } }); // 用户可能已切走页签
            notify();
            return;
        }
        if (r.status === "done") {
            active = undefined;
            ev.setConverting(false);
            // 完成即清进度记录：残留会让面板永远显示「有未完成转换」，
            // 「丢弃」按钮更会直接删掉已完成的整本文档、「继续生成」会
            // 复制/重删同一文档（20260829 三轮审查 P1）
            ev.saveProgress(cfg.srcDocId, undefined);
            notify();
            await finishRun(ev, r);
            return;
        }
        if (r.status === "aborted") {
            active = undefined;
            ev.setConverting(false);
            if (!r.kramdown.trim()) {
                ev.onStatus(esc(t("convertStoppedEmpty")), "err", true);
                notify();
                return;
            }
            const head = r.message ? `${esc(r.message)}<br>` : "";
            ev.onStopChoice({ count: r.count, batches: r.batches, total: r.total, message: head });
            aborted = { r, cfg, ev };
            notify();
            return;
        }
        // 中途失败但已有部分内容：保留 + 记进度（可继续生成）。
        // active 必须清（失败收口，转换管理面板/继续生成都依赖它复位）
        active = undefined;
        ev.setConverting(false);
        const partial = r.count > 0 ? `<br>${esc(t("convertPartialKept"))}` : "";
        ev.onStatus(`${esc(r.message || t("convertNoQuestions"))}${partial}`, "err", true);
        notifyError({ key: "notifyConvertFail", vars: { msg: r.message || t("convertNoQuestions") } });
        if (r.count > 0) {
            ev.saveProgress(
                cfg.srcDocId,
                r.docId && r.title
                    ? {
                          docId: r.docId,
                          title: r.title,
                          offset: r.doneOffset,
                          batches: r.batches,
                          total: r.total,
                          count: r.count,
                      }
                    : {
                          title: "",
                          offset: r.doneOffset,
                          batches: r.batches,
                          total: r.total,
                          count: r.count,
                          kramdown: r.kramdown,
                      }
            );
        }
        notify();
    })();
    return true;
}

/** 页内/面板「停止」：中止批次循环，转保留/丢弃抉择。 */
export function stopConvertRun(): void {
    active?.abort();
}

/** 独占运行槽（增量重转换等非整卷流程共用）：占住 active 单例防并发
 *  开跑（convertRunActive 对所有入口生效），执行体自带进度与收尾；
 *  「停止」走同一条 stopConvertRun → signal 中止，由执行体自行收口
 *  （增量已追加部分自带指纹，重跑分类即跳过，无需抉择态）。 */
export function startExclusiveConvertRun(
    ev: ConvertRunEvents,
    srcDocId: string,
    run: (signal: AbortSignal) => Promise<void>
): boolean {
    if (active || aborted) return false;
    const controller = new AbortController();
    active = {
        cfg: {
            srcDocId,
            modelId: "",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 1,
            targetRaw: "",
            knowRoots: [],
        },
        ev,
        abort: () => controller.abort(),
    };
    ev.setConverting(true);
    notify();
    void run(controller.signal)
        .catch((e) => {
            ev.onStatus(esc(String((e as Error)?.message ?? e)), "err", true);
        })
        .finally(() => {
            active = undefined;
            ev.setConverting(false);
            notify();
        });
    return true;
}

/** 页内/面板「保留已生成」：渐进文档已在只记进度；首批前终止现写一份。 */
export function keepConvertRun(): Promise<void> {
    const a = aborted;
    if (!a) return Promise.resolve();
    aborted = undefined;
    notify();
    const { t, saveProgress } = a.ev;
    return (async () => {
        if (a.r.docId && a.r.title) {
            saveProgress(a.cfg.srcDocId, {
                docId: a.r.docId,
                title: a.r.title,
                offset: a.r.doneOffset,
                batches: a.r.batches,
                total: a.r.total,
                count: a.r.count,
            });
            await finishRun(a.ev, a.r);
            return;
        }
        const info = await getDocInfo(a.cfg.srcDocId);
        if (!info) return;
        const created = await writeExerciseDoc(info, a.r.kramdown, a.cfg.srcDocId, a.cfg.targetRaw, t);
        saveProgress(a.cfg.srcDocId, {
            docId: created.id,
            title: created.title,
            offset: a.r.doneOffset,
            batches: a.r.batches,
            total: a.r.total,
            count: a.r.count,
        });
        await finishRun(a.ev, { ...a.r, status: "done", docId: created.id, title: created.title });
    })()
        .catch((e) => a.ev.onStatus(esc(String((e as Error)?.message ?? e)), "err", true))
        .then(() => notify());
}

/** 页内/面板「全部丢弃」：删渐进文档、清进度、页面复位。 */
export function discardConvertRun(): void {
    const a = aborted;
    if (!a) return;
    aborted = undefined;
    void (a.r.docId ? removeDoc(a.r.docId) : Promise.resolve());
    a.ev.saveProgress(a.cfg.srcDocId, undefined);
    a.ev.onCancel?.();
    a.ev.onStatus(esc(a.ev.t("convertDiscarded")), "muted", true);
    notify();
}

/** 转换收尾：等索引可见 → 通知宿主（切文档/重载/状态条）。 */
async function finishRun(ev: ConvertRunEvents, r: BatchedResult): Promise<void> {
    if (!r.docId) return;
    ev.onStatus(esc(ev.t("settling")), "muted");
    await waitForDocInList(r.docId, 15000);
    const c = toConvertResult(r);
    notifyInfo({ key: "notifyConvertDone", vars: { n: String(r.count) } }); // 长任务完成，用户可能已切走
    ev.onDone({ docId: c.docId ?? "", title: c.title ?? "", count: c.count, message: c.message });
}
