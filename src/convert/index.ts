import type { ConvertProgressRecord } from "./service/ConvertBatch";
import { openConvertDialog } from "./ui/ConvertDialog";
import { openConvertPanel } from "./ui/ConvertPanel";
import {
    convertRunActive,
    discardConvertRun,
    keepConvertRun,
    startConvertRun,
    stopConvertRun,
    type ConvertRunCfg,
    type ConvertRunEvents,
} from "./service/ConvertRun";
import type { ProgressivePreview } from "../quiz/service/ProgressivePreview";
import { showBatchPreview } from "../quiz/service/ProgressivePreview";
import type { WenguSettingsShape as SettingsDialogShape } from "../ui/SettingsDialog";
import type { WenguMaterial, WenguQuestion } from "../types";
import { esc, fmt } from "../ui/shared";

/**
 * 转换编排（从 QuizView 拆出）：组装 ConvertDialog 的依赖、转换按钮
 * 状态与页内状态条。视图只提供状态与回调，不碰弹窗细节。
 */

/** 视图侧能力（QuizView 组装，风格同 StartRoundCtx/ViewBindCtx）。 */
export interface ConvertHostCtx {
    t: (key: string) => string;
    /** 顶栏带来的活动文档（弹窗输入框默认值）。 */
    activeDocId: string;
    settings?: SettingsDialogShape;
    /** prefs 记住的上次临时选择。 */
    lastConvertModelId: string;
    lastConvertFill: boolean;
    lastConvertSteps: boolean;
    /** 并发批数默认值（设置页，1=串行）。 */
    convertParallel?: number;
    /** 知识点根文档上次输入（prefs，原始串）。 */
    lastConvertKnow: string;
    /** 弹窗内临时选择（记 prefs；knowRoots 为原始输入串）。 */
    saveChoice(modelId: string, fillToChoice: boolean, bigToSteps: boolean, knowRoots: string): void;
    /** 读取某源文档的未完成转换进度（无则 undefined）。 */
    getProgress(srcDocId: string): ConvertProgressRecord | undefined;
    /** 转换状态变化（按钮禁用/文案）。 */
    setConverting(v: boolean): void;
    /** 未完成进度记录（转换管理面板用）。 */
    listProgress(): { srcDocId: string; rec: ConvertProgressRecord }[];
    /** 丢弃一条进度记录（面板用：清 prefs + 删保留的渐进文档）。 */
    discardProgress(srcDocId: string, rec: ConvertProgressRecord): void;
    /** 面板「继续生成」：重开转换弹窗并预填该源文档。 */
    reopenWithDoc(srcDocId: string): void;
    /** 直接启动一次转换（弹窗「开始转换」的执行体，事件接线见
     *  convertRunEventsFor；返回 false=已有转换在跑）。 */
    startRun(cfg: ConvertRunCfg): boolean;
}

/** 组装并打开转换管理面板（弹窗被拒/「查看进行中的转换」入口）。 */
function openConvertPanelForView(ctx: ConvertHostCtx): void {
    openConvertPanel({
        t: ctx.t,
        listProgress: () => ctx.listProgress(),
        discardProgress: (srcDocId, rec) => ctx.discardProgress(srcDocId, rec),
        resumeProgress: (srcDocId) => ctx.reopenWithDoc(srcDocId),
    });
}

/** 打开 AI 转习题弹窗（预选值：prefs 上次 > 设置默认）。 */
export function openWenguConvert(ctx: ConvertHostCtx): void {
    openConvertDialog({
        t: ctx.t,
        activeDocId: ctx.activeDocId,
        initialModelId: ctx.lastConvertModelId || ctx.settings?.convertModelId || "",
        initialFillToChoice: ctx.lastConvertFill || ctx.settings?.fillToChoice === true,
        initialBigToSteps: ctx.lastConvertSteps || ctx.settings?.bigToSteps === true,
        initialParallel: ctx.convertParallel ?? 1,
        initialTargetMode: ctx.settings?.convertTargetMode === "custom" ? "custom" : "same",
        initialTargetId: ctx.settings?.convertTargetId ?? "",
        initialKnowRoots: ctx.lastConvertKnow,
        saveChoice: ctx.saveChoice,
        getProgress: ctx.getProgress,
        setConverting: ctx.setConverting,
        isRunning: () => convertRunActive(),
        openPanel: () => openConvertPanelForView(ctx),
        /** 点「开始转换」：关窗启动运行器，状态/停止/抉择全部转页内转换条。 */
        startRun: ctx.startRun,
    });
}

/** 转换编排所需的视图能力（QuizView 用箭头属性实现，openConvertForView 消费）。 */
export interface ConvertViewAccess {
    t: (key: string) => string;
    container(): HTMLElement;
    /** 顶栏带来的活动文档 id。 */
    activeDocIdOf(): string;
    settingsOf(): SettingsDialogShape | undefined;
    lastConvert(): { modelId: string; fill: boolean; steps: boolean; know: string };
    convertParallelOf(): number;
    /** 弹窗选择落 prefs。 */
    saveConvertChoice(modelId: string, fill: boolean, steps: boolean, know: string): void;
    convertProgressOf(docId: string): ConvertProgressRecord | undefined;
    saveConvertProgress(docId: string, rec: ConvertProgressRecord | undefined): void;
    /** 未完成进度记录清单（转换管理面板）。 */
    listProgress(): { srcDocId: string; rec: ConvertProgressRecord }[];
    /** 丢弃一条进度记录：清 prefs + 删保留的渐进文档。 */
    discardProgress(srcDocId: string, rec: ConvertProgressRecord): void;
    setConvertingState(v: boolean): void;
    /** 渐进预览宿主（showBatchPreview 用）。 */
    progressiveOf(): ProgressivePreview;
    isStarted(): boolean;
    /** 收卷（渐进呈现接管页签前调用）。 */
    stopRoundNow(): void;
    currentDocId(): string;
    /** 渐进文档切换（pendingDoc 补位 + 选中）。 */
    switchPreviewDoc(id: string, title: string, count: number): void;
    applyQuizList(list: WenguQuestion[], materials?: WenguMaterial[]): void;
    reloadView(): void;
    /** 转换完成收尾（pendingDoc/选中/刷新/状态条）。 */
    onConvertDone(r: { docId: string; title: string; count: number; message?: string }): void;
}

/** 页内转换事件组（弹窗「开始转换」与右键「重新导入」共用的接线：
 *  状态条渲染/渐进呈现/终止抉择/收尾清条）。 */
export function convertRunEventsFor(v: ConvertViewAccess): ConvertRunEvents {
    return {
        t: v.t,
        setConverting: (flag) => v.setConvertingState(flag),
        onStatus: (html, kind, terminal) =>
            renderConvertBar(v.container(), v.t, html, kind, terminal ? null : "running"),
        onBatch: (docId, title, count, batch, total) =>
            showBatchPreview(v.progressiveOf(), previewHostOf(v), docId, title, count, batch, total),
        onStopChoice: (info) =>
            renderConvertBar(
                v.container(),
                v.t,
                `${info.message ?? ""}${esc(
                    fmt(v.t("convertStopped"), {
                        c: String(info.count),
                        b: String(info.batches),
                        n: String(info.total),
                    })
                )}`,
                "muted",
                "choice"
            ),
        onCancel: () => {
            v.progressiveOf().clear();
            v.reloadView();
        },
        onDone: (r) => {
            clearConvertBar();
            v.onConvertDone(r);
        },
        saveProgress: (srcDocId, rec) => v.saveConvertProgress(srcDocId, rec),
    };
}

/** 由视图能力直接启动一次转换（弹窗 startRun 与右键「重新导入」共用；
 *  返回 false=已有转换在跑/待抉择）。 */
export function startConvertForView(v: ConvertViewAccess, cfg: ConvertRunCfg): boolean {
    return startConvertRun(cfg, convertRunEventsFor(v));
}

/** 由视图能力组装 ConvertHostCtx 并打开弹窗（openConvert 的拆出体）。
 *  prefillDocId：预填的源文档 id（面板「继续生成」/知识面板「转习题」）。
 *  prefillKnow：预填的知识点根文档 id（知识面板「转习题」——源=根=该
 *  知识文档，生成时即挂自身小节反链；空=回落 prefs 上次输入）。 */
export function openConvertForView(v: ConvertViewAccess, prefillDocId?: string, prefillKnow?: string): void {
    openWenguConvert({
        t: v.t,
        activeDocId: prefillDocId || v.activeDocIdOf(),
        settings: v.settingsOf(),
        lastConvertModelId: v.lastConvert().modelId,
        lastConvertFill: v.lastConvert().fill,
        lastConvertSteps: v.lastConvert().steps,
        lastConvertKnow: prefillKnow || v.lastConvert().know,
        convertParallel: v.convertParallelOf(),
        saveChoice: (modelId, fill, steps, know) => v.saveConvertChoice(modelId, fill, steps, know),
        getProgress: (srcDocId) => v.convertProgressOf(srcDocId),
        setConverting: (flag) => v.setConvertingState(flag),
        listProgress: () => v.listProgress(),
        discardProgress: (srcDocId, rec) => v.discardProgress(srcDocId, rec),
        reopenWithDoc: (srcDocId) => openConvertForView(v, srcDocId),
        startRun: (cfg) => startConvertForView(v, cfg),
    });
}

/** 渐进预览宿主（原 QuizView.previewHost 拆出体）。 */
function previewHostOf(v: ConvertViewAccess): {
    t: (key: string) => string;
    el: HTMLElement;
    isStarted(): boolean;
    stopRound(): void;
    currentDocId(): string;
    switchDoc(id: string, title: string, count: number): void;
    applyList(list: WenguQuestion[], materials?: WenguMaterial[]): void;
} {
    return {
        t: v.t,
        el: v.container(),
        isStarted: () => v.isStarted(),
        stopRound: () => v.stopRoundNow(),
        currentDocId: () => v.currentDocId(),
        switchDoc: (id, title, count) => v.switchPreviewDoc(id, title, count),
        applyList: (list, materials) => v.applyQuizList(list, materials),
    };
}

/** 反映转换中状态到目录顶部的转换按钮（图标不动，只换标签）。 */
export function updateConvertBtn(el: HTMLElement, converting: boolean, t: (k: string) => string): void {
    const btn = el.querySelector<HTMLButtonElement>("[data-act='convert']");
    if (!btn) return;
    btn.disabled = converting;
    const label = btn.querySelector<HTMLElement>("[data-convert-label]");
    if (label) label.textContent = converting ? t("converting") : t("convertBtn");
}

/** 页内状态条（成功/错误/弱化）。 */
export function showStatus(el: HTMLElement, text: string, kind: "ok" | "err" | "muted"): void {
    const status = el.querySelector<HTMLElement>("[data-status]");
    if (!status) return;
    status.textContent = text;
    status.className = `wengu-status wengu-status-${kind}`;
    status.removeAttribute("hidden");
}

/** 转换条最近一次内容（页签重渲染后 replay 用；终态清空）。 */
let lastBar:
    { t: (k: string) => string; html: string; kind: "ok" | "err" | "muted"; mode: "running" | "choice" } | undefined;

/**
 * 页内转换条（[data-status] 槽）：进度文案 + 停止按钮，终止后换成
 * 保留进度/全部丢弃二选一。mode=null 为纯状态（终态，清 replay）。
 */
export function renderConvertBar(
    el: HTMLElement,
    t: (k: string) => string,
    html: string,
    kind: "ok" | "err" | "muted",
    mode: "running" | "choice" | null
): void {
    const slot = el.querySelector<HTMLElement>("[data-status]");
    if (!slot) return;
    lastBar = mode ? { t, html, kind, mode } : undefined;
    const stopBtn =
        mode === "running"
            ? `<button class="b3-button b3-button--outline" data-act="convert-stop">${esc(t("convertStop"))}</button>`
            : "";
    const choice =
        mode === "choice"
            ? `<button class="b3-button b3-button--outline" data-act="convert-keep">${esc(t("convertKeep"))}</button>` +
              `<button class="b3-button b3-button--cancel" data-act="convert-discard">${esc(
                  t("convertDiscard")
              )}</button>`
            : "";
    slot.innerHTML = `<span class="wengu-convert-bar-text">${html}</span>${stopBtn}${choice}`;
    slot.className = `wengu-status wengu-status-${kind} wengu-convert-bar`;
    slot.removeAttribute("hidden");
    slot.querySelector<HTMLButtonElement>("[data-act='convert-stop']")?.addEventListener("click", stopConvertRun);
    slot.querySelector<HTMLButtonElement>("[data-act='convert-keep']")?.addEventListener("click", () => {
        clearConvertBar();
        void keepConvertRun();
    });
    slot.querySelector<HTMLButtonElement>("[data-act='convert-discard']")?.addEventListener("click", () => {
        clearConvertBar();
        discardConvertRun();
    });
}

/** 页签重渲染（每批渐进应用）后重放转换条；false=当前无可放内容。 */
export function replayConvertBar(el: HTMLElement): boolean {
    if (!lastBar) return false;
    renderConvertBar(el, lastBar.t, lastBar.html, lastBar.kind, lastBar.mode);
    return true;
}

/** 清空 replay 状态（终态后不再复活旧条）。 */
export function clearConvertBar(): void {
    lastBar = undefined;
}

/** 转换成功后的统一收尾文案（onDone 里展示用）。 */
export function convertDoneText(t: (k: string) => string, title: string, count: number): string {
    return fmt(t("convertDone"), { title, n: String(count) });
}
