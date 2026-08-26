import { convertDocBatched } from "./ConvertBatch";
import type { BatchedResult, ConvertProgressRecord } from "./ConvertBatch";
import { getDocInfo, removeDoc, toConvertResult, writeExerciseDoc } from "./ConvertService";
import { waitForDocInList } from "../quiz/QuestionService";
import { esc, fmt } from "../ui/shared";

/**
 * 转换执行器（从转换弹窗拆出的单例运行器）：弹窗只负责收集参数，
 * 点「开始转换」即关窗，批次循环在这里跑完。状态条/停止/终止后的
 * 保留-丢弃二选一都渲染在温故页签内（ConvertHost.convertBar），
 * 页签每批渐进呈现（ProgressivePreview）照旧。
 */

/** 一次转换的全部参数（弹窗收集后传入）。 */
export interface ConvertRunCfg {
    srcDocId: string;
    modelId: string;
    fillToChoice: boolean;
    bigToSteps: boolean;
    parallel: number;
    writeMode: "inplace" | "newdoc";
    targetRaw: string;
    knowRoots: string[];
    resume?: { offset: number; docId?: string; kramdown?: string };
}

/** 页面侧事件（ConvertHost 组装：页内转换条 + 渐进呈现 + 收尾）。 */
export interface ConvertRunEvents {
    t: (k: string) => string;
    setConverting(v: boolean): void;
    /** 状态条 HTML（进度文案由这里拼好，条上的按钮由渲染方加）。 */
    onStatus(html: string, kind: "ok" | "err" | "muted"): void;
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
    /** 终止后的部分结果（保留/丢弃二选一期间持有）。 */
    pending?: BatchedResult;
}

let active: ActiveRun | undefined;

/** 终止后待抉择的部分结果（保留/丢弃的执行体用）。 */
let aborted: { r: BatchedResult; cfg: ConvertRunCfg; ev: ConvertRunEvents } | undefined;

/** 是否有转换在跑（含终止后待抉择）。 */
export function convertRunActive(): boolean {
    return !!active;
}

/** 启动一次转换（已有在途运行则拒绝，返回 false）。 */
export function startConvertRun(cfg: ConvertRunCfg, ev: ConvertRunEvents): boolean {
    if (active) return false;
    const controller = new AbortController();
    active = { cfg, ev, abort: () => controller.abort() };
    const t = ev.t;
    ev.setConverting(true);
    ev.onStatus(esc(t("converting")), "muted");
    void (async () => {
        try {
            const r = await convertDocBatched(cfg.srcDocId, {
                t,
                modelId: cfg.modelId,
                fillToChoice: cfg.fillToChoice,
                bigToSteps: cfg.bigToSteps,
                parallel: cfg.parallel,
                signal: controller.signal,
                resume: cfg.resume,
                writeMode: cfg.writeMode,
                targetRaw: cfg.targetRaw,
                knowRoots: cfg.knowRoots,
                onProgress: (p) => {
                    if (p.phase === "detect") {
                        ev.onStatus(esc(t("convertDetecting")), "muted");
                        return;
                    }
                    if (p.phase === "writing") {
                        ev.onStatus(esc(t("settling")), "muted");
                        if (p.docId) ev.onBatch(p.docId, p.title ?? "", p.count, p.batch, p.total);
                        return;
                    }
                    // batch=i 表示第 i+1 批进行中；lastBatch 是刚完成那批的题数
                    if (p.docId) ev.onBatch(p.docId, p.title ?? "", p.count, p.batch, p.total);
                    const totalHint =
                        p.detected !== undefined && p.detected > 0
                            ? ` · ${esc(fmt(t("convertDetected"), { n: String(p.detected) }))}${
                                  p.detectedTruncated ? "+" : ""
                              }`
                            : p.total > 1
                              ? ` · ${esc(t("convertTotalUnknown"))}`
                              : "";
                    const lastDelta =
                        p.lastBatch > 0 ? ` · ${esc(fmt(t("convertLastBatch"), { k: String(p.lastBatch) }))}` : "";
                    const main =
                        cfg.parallel > 1
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
                    ev.onStatus(`${main}${lastDelta}${totalHint}`, "muted");
                },
            });
            if (r.status === "done") {
                active = undefined;
                ev.setConverting(false);
                await finishRun(ev, r);
                return;
            }
            if (r.status === "aborted") {
                active = undefined;
                ev.setConverting(false);
                if (!r.kramdown.trim()) {
                    ev.onStatus(esc(t("convertStoppedEmpty")), "err");
                    return;
                }
                const head = r.message ? `${esc(r.message)}<br>` : "";
                ev.onStopChoice({ count: r.count, batches: r.batches, total: r.total, message: head });
                aborted = { r, cfg, ev };
                return;
            }
            ev.setConverting(false);
            // 中途失败但已有部分内容：保留 + 记进度（可继续生成）
            const partial = r.count > 0 ? `<br>${esc(t("convertPartialKept"))}` : "";
            ev.onStatus(`${esc(r.message || t("convertNoQuestions"))}${partial}`, "err");
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
        } catch (e) {
            ev.setConverting(false);
            ev.onStatus(esc(String((e as Error)?.message ?? e)), "err");
        }
    })();
    return true;
}

/** 页内「停止」：中止批次循环，转保留/丢弃抉择。 */
export function stopConvertRun(): void {
    active?.abort();
}

/** 页内「保留进度」：另存=渐进文档已在只记进度；原位=kramdown 进记录；首批前终止现写一份。 */
export function keepConvertRun(): Promise<void> {
    const a = aborted;
    if (!a) return Promise.resolve();
    aborted = undefined;
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
        if (a.cfg.writeMode === "inplace") {
            const info = await getDocInfo(a.cfg.srcDocId);
            saveProgress(a.cfg.srcDocId, {
                title: info?.title ?? "",
                offset: a.r.doneOffset,
                batches: a.r.batches,
                total: a.r.total,
                count: a.r.count,
                kramdown: a.r.kramdown,
            });
            a.ev.onStatus(esc(fmt(t("convertKeepProgress"), { c: String(a.r.count) })), "muted");
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
    })().catch((e) => a.ev.onStatus(esc(String((e as Error)?.message ?? e)), "err"));
}

/** 页内「全部丢弃」：删渐进文档、清进度、页面复位。 */
export function discardConvertRun(): void {
    const a = aborted;
    if (!a) return;
    aborted = undefined;
    void (a.r.docId ? removeDoc(a.r.docId) : Promise.resolve());
    a.ev.saveProgress(a.cfg.srcDocId, undefined);
    a.ev.onCancel?.();
    a.ev.onStatus(esc(a.ev.t("convertDiscarded")), "muted");
}

/** 转换收尾：等索引可见 → 通知宿主（切文档/重载/状态条）。 */
async function finishRun(ev: ConvertRunEvents, r: BatchedResult): Promise<void> {
    if (!r.docId) return;
    ev.onStatus(esc(ev.t("settling")), "muted");
    await waitForDocInList(r.docId, 15000);
    const c = toConvertResult(r);
    ev.onDone({ docId: c.docId ?? "", title: c.title ?? "", count: c.count, message: c.message });
}
