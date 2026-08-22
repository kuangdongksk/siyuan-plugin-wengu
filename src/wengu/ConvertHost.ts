import {openConvertDialog} from "./ConvertDialog";
import type {WenguSettingsShape as SettingsDialogShape} from "./SettingsDialog";
import {fmt} from "./ui";

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
    /** 弹窗内临时选择（记 prefs）。 */
    saveChoice(modelId: string, fillToChoice: boolean, bigToSteps: boolean): void;
    /** 转换状态变化（按钮禁用/文案）。 */
    setConverting(v: boolean): void;
    /** 成功收尾：切到新文档、重载、报状态（视图实现）。 */
    onDone(r: {docId: string; title: string; count: number;}): void;
}

/** 打开 AI 转习题弹窗（预选值：prefs 上次 > 设置默认）。 */
export function openWenguConvert(ctx: ConvertHostCtx): void {
    openConvertDialog({
        t: ctx.t,
        activeDocId: ctx.activeDocId,
        initialModelId: ctx.lastConvertModelId || ctx.settings?.convertModelId || "",
        initialFillToChoice: ctx.lastConvertFill || ctx.settings?.fillToChoice === true,
        initialBigToSteps: ctx.lastConvertSteps || ctx.settings?.bigToSteps === true,
        initialTargetMode: ctx.settings?.convertTargetMode === "custom" ? "custom" : "same",
        initialTargetId: ctx.settings?.convertTargetId ?? "",
        saveChoice: ctx.saveChoice,
        setConverting: ctx.setConverting,
        onDone: ctx.onDone,
    });
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
    return fmt(t("convertDone"), {title, n: String(count)});
}
