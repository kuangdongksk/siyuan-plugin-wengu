import type { ConvertProgressRecord } from "./ConvertBatch";
import { openConvertDialog } from "./ConvertDialog";
import type { ProgressivePreview } from "./ProgressivePreview";
import { showBatchPreview } from "./ProgressivePreview";
import type { WenguSettingsShape as SettingsDialogShape } from "./SettingsDialog";
import type { WenguQuestion } from "./types";
import { fmt } from "./ui";

/**
 * 转换编排（从 QuizView 拆出）：组装 ConvertDialog 的依赖、转换按钮
 * 状态与页内状态条。视图只提供状态与回调，不碰弹窗细节。
 */

/** 视图侧能力（QuizView 组装，风格同 StartRoundCtx/ViewBindCtx）。 */
export interface ConvertHostCtx {
    t: (key: string) => string;
    el: HTMLElement;
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
    /** 记录/清除未完成转换进度（prefs 持久化）。 */
    saveProgress(srcDocId: string, rec: ConvertProgressRecord | undefined): void;
    /** 转换状态变化（按钮禁用/文案）。 */
    setConverting(v: boolean): void;
    /** 每批渐进落盘后回调（页签以做题界面渐进呈现）。 */
    onBatch?(docId: string, title: string, count: number, batch: number, total: number): void;
    /** 全部丢弃后回调（页签恢复原状）。 */
    onCancel?(): void;
    /** 成功收尾：切到新文档、重载、报状态（视图实现）。 */
    onDone(r: { docId: string; title: string; count: number }): void;
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
        saveProgress: ctx.saveProgress,
        setConverting: ctx.setConverting,
        onBatch: ctx.onBatch,
        onCancel: ctx.onCancel,
        onDone: ctx.onDone,
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
    setConvertingState(v: boolean): void;
    /** 渐进预览宿主（showBatchPreview 用）。 */
    progressiveOf(): ProgressivePreview;
    isStarted(): boolean;
    currentDocId(): string;
    /** 渐进文档切换（pendingDoc 补位 + 选中）。 */
    switchPreviewDoc(id: string, title: string, count: number): void;
    applyQuizList(list: WenguQuestion[]): void;
    reloadView(): void;
    /** 转换完成收尾（pendingDoc/选中/刷新/状态条）。 */
    onConvertDone(r: { docId: string; title: string; count: number; message?: string }): void;
}

/** 由视图能力组装 ConvertHostCtx 并打开弹窗（openConvert 的拆出体）。 */
export function openConvertForView(v: ConvertViewAccess): void {
    openWenguConvert({
        t: v.t,
        el: v.container(),
        activeDocId: v.activeDocIdOf(),
        settings: v.settingsOf(),
        lastConvertModelId: v.lastConvert().modelId,
        lastConvertFill: v.lastConvert().fill,
        lastConvertSteps: v.lastConvert().steps,
        lastConvertKnow: v.lastConvert().know,
        convertParallel: v.convertParallelOf(),
        saveChoice: (modelId, fill, steps, know) => v.saveConvertChoice(modelId, fill, steps, know),
        getProgress: (srcDocId) => v.convertProgressOf(srcDocId),
        saveProgress: (srcDocId, rec) => v.saveConvertProgress(srcDocId, rec),
        setConverting: (flag) => v.setConvertingState(flag),
        onBatch: (docId, title, count, batch, total) =>
            showBatchPreview(v.progressiveOf(), previewHostOf(v), docId, title, count, batch, total),
        onCancel: () => {
            v.progressiveOf().clear();
            v.reloadView();
        },
        onDone: (r) => v.onConvertDone(r),
    });
}

/** 渐进预览宿主（原 QuizView.previewHost 拆出体）。 */
function previewHostOf(v: ConvertViewAccess): {
    t: (key: string) => string;
    el: HTMLElement;
    isStarted(): boolean;
    currentDocId(): string;
    switchDoc(id: string, title: string, count: number): void;
    applyList(list: WenguQuestion[]): void;
} {
    return {
        t: v.t,
        el: v.container(),
        isStarted: () => v.isStarted(),
        currentDocId: () => v.currentDocId(),
        switchDoc: (id, title, count) => v.switchPreviewDoc(id, title, count),
        applyList: (list) => v.applyQuizList(list),
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

/** 转换成功后的统一收尾文案（onDone 里展示用）。 */
export function convertDoneText(t: (k: string) => string, title: string, count: number): string {
    return fmt(t("convertDone"), { title, n: String(count) });
}
