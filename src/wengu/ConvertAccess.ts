import type { ConvertProgressRecord } from "./ConvertBatch";
import type { ConvertViewAccess } from "./ConvertHost";
import { convertDoneText, showStatus, updateConvertBtn } from "./ConvertHost";
import type { ProgressivePreview } from "./ProgressivePreview";
import type { WenguSettingsShape as SettingsDialogShape } from "./SettingsDialog";
import type { WenguMaterial, WenguQuestion } from "./types";

/**
 * QuizView 的 ConvertViewAccess 实现体（从 QuizView 拆出压行数）：
 * 转换弹窗的全部可变状态（上次选择/进行中标记/渐进进度）与收尾动作
 * 集中在这里，宿主只提供视图能力（选中/重载/偏好落盘）。
 */

/** ConvertAccess 的宿主能力（QuizView 实现，成员名与视图既有访问器一致）。 */
export interface ConvertAccessHost {
    readonly el: HTMLElement;
    t(key: string): string;
    activeDocIdOf(): string;
    settingsOf(): SettingsDialogShape | undefined;
    convertParallelOf(): number;
    progressiveOf(): ProgressivePreview;
    isStarted(): boolean;
    currentDocId(): string;
    persistPrefs(): void;
    stopRoundNow(): void;
    /** 渐进文档切换（pendingDoc 补位 + 选中 + 旧轮清理）。 */
    switchPreviewDoc(id: string, title: string, count: number): void;
    applyQuizList(list: WenguQuestion[], materials?: WenguMaterial[]): void;
    reloadView(): Promise<void>;
}

export class ConvertAccess implements ConvertViewAccess {
    private curModelId = "";
    private curFill = false;
    private curSteps = false;
    private curKnow = "";
    private progress: Record<string, ConvertProgressRecord> = {};
    private busy = false;

    constructor(private readonly host: ConvertAccessHost) {}

    get t(): (key: string) => string {
        return this.host.t;
    }

    get converting(): boolean {
        return this.busy;
    }

    get modelId(): string {
        return this.curModelId;
    }

    container(): HTMLElement {
        return this.host.el;
    }

    activeDocIdOf(): string {
        return this.host.activeDocIdOf();
    }

    settingsOf(): SettingsDialogShape | undefined {
        return this.host.settingsOf();
    }

    lastConvert(): { modelId: string; fill: boolean; steps: boolean; know: string } {
        return { modelId: this.curModelId, fill: this.curFill, steps: this.curSteps, know: this.curKnow };
    }

    convertParallelOf(): number {
        return this.host.convertParallelOf();
    }

    saveConvertChoice(modelId: string, fill: boolean, steps: boolean, know: string): void {
        this.curModelId = modelId;
        this.curFill = fill;
        this.curSteps = steps;
        this.curKnow = know;
        this.host.persistPrefs();
    }

    convertProgressOf(docId: string): ConvertProgressRecord | undefined {
        return this.progress[docId];
    }

    saveConvertProgress(docId: string, rec: ConvertProgressRecord | undefined): void {
        if (rec) this.progress[docId] = rec;
        else delete this.progress[docId];
        this.host.persistPrefs();
    }

    setConvertingState(v: boolean): void {
        this.busy = v;
        updateConvertBtn(this.host.el, v, this.host.t);
    }

    progressiveOf(): ProgressivePreview {
        return this.host.progressiveOf();
    }

    isStarted(): boolean {
        return this.host.isStarted();
    }

    stopRoundNow(): void {
        this.host.stopRoundNow();
    }

    currentDocId(): string {
        return this.host.currentDocId();
    }

    switchPreviewDoc(id: string, title: string, count: number): void {
        this.host.switchPreviewDoc(id, title, count);
    }

    applyQuizList(list: WenguQuestion[], materials?: WenguMaterial[]): void {
        this.host.applyQuizList(list, materials);
    }

    reloadView(): void {
        void this.host.reloadView();
    }

    onConvertDone(r: { docId: string; title: string; count: number; message?: string }): void {
        this.host.progressiveOf().clear();
        this.host.switchPreviewDoc(r.docId, r.title, r.count);
        void this.host
            .reloadView()
            .then(() => showStatus(this.host.el, convertDoneText(this.host.t, r.title, r.count), "ok"));
    }

    /** load 恢复（QuizView.load 读到 prefs 后回填）。 */
    restore(r: {
        lastConvertModelId?: string;
        lastConvertFill?: boolean;
        lastConvertSteps?: boolean;
        lastConvertKnow?: string;
        convertProgress?: Record<string, ConvertProgressRecord>;
    }): void {
        this.curModelId = r.lastConvertModelId ?? "";
        this.curFill = !!r.lastConvertFill;
        this.curSteps = !!r.lastConvertSteps;
        this.curKnow = r.lastConvertKnow ?? "";
        this.progress = r.convertProgress ?? {};
    }

    /** persistPrefs 快照（savePrefs 的转换组字段）。 */
    prefsSnapshot(): {
        lastConvertModelId: string;
        lastConvertFill: boolean;
        lastConvertSteps: boolean;
        lastConvertKnow: string;
        convertProgress: Record<string, ConvertProgressRecord>;
    } {
        return {
            lastConvertModelId: this.curModelId,
            lastConvertFill: this.curFill,
            lastConvertSteps: this.curSteps,
            lastConvertKnow: this.curKnow,
            convertProgress: this.progress,
        };
    }
}
