import {
    convertRunSnapshot,
    discardConvertRun,
    keepConvertRun,
    stopConvertRun,
    subscribeConvertRun,
} from "../service/ConvertRun";
import type { ConvertPanelDeps } from "../ui/ConvertPanel";
import type { ConvertPanelUi } from "./ConvertPanelUi";
import { Armed } from "../../ui/shared";

/**
 * 转换管理面板控制器（四件套之一）。面板两区：①进行中（ConvertRun
 * 单例快照，订阅刷新）：进度行 + 终止，终止后待抉择时给「保留已生成/
 * 全部丢弃」；②未完成进度（prefs 记录，跨重启仍在）：逐条「继续生成」
 * （回转换弹窗预填源文档，resume 提示接管）/「丢弃进度」——清记录，
 * 记录带 docId 时连同转换新建的习题文档一起删（已确认语义，勿改成
 * 「只清书签不删文档」）。丢弃两击确认防误删整份渐进文档。
 */
export class ConvertPanelCtl {
    private ui?: ConvertPanelUi;
    private deps?: ConvertPanelDeps;
    private closeFn?: () => void;
    private unsub?: () => void;
    /** 「丢弃进度」两击确认（3s 自动复位）。 */
    private armState = new Armed<string>((v) => {
        if (this.ui) this.ui.armedDoc = v;
    });

    attach(ui: ConvertPanelUi, deps: ConvertPanelDeps, close: () => void): void {
        this.ui = ui;
        this.deps = deps;
        this.closeFn = close;
        this.refreshRecords();
        ui.snap = convertRunSnapshot();
        // 订阅刷新（unmount 即退订——旧实现 document.contains 自清不需要了）
        this.unsub = subscribeConvertRun(() => {
            if (this.ui) this.ui.snap = convertRunSnapshot();
        });
    }

    detach(): void {
        this.unsub?.();
        this.unsub = undefined;
        this.armState.disarm();
        this.ui = undefined;
        this.deps = undefined;
    }

    refreshRecords(): void {
        if (this.ui && this.deps) this.ui.records = this.deps.listProgress();
    }

    /** 进行中「终止」（异步收口，先禁用防连点由组件 disabled 承担）。 */
    stopRun(): void {
        void stopConvertRun();
    }

    /** 待抉择「保留已生成」。 */
    keepRun(): void {
        void keepConvertRun();
    }

    /** 待抉择「全部丢弃」。 */
    discardRun(): void {
        discardConvertRun();
        if (this.ui) this.ui.snap = convertRunSnapshot();
    }

    /** 未完成记录「丢弃进度」（两击确认）。 */
    armDrop(srcDocId: string): void {
        const ui = this.ui;
        const deps = this.deps;
        if (!ui || !deps) return;
        if (ui.armedDoc === srcDocId) {
            this.disarm();
            const hit = deps.listProgress().find((r) => r.srcDocId === srcDocId);
            if (hit) deps.discardProgress(srcDocId, hit.rec);
            this.refreshRecords();
            return;
        }
        this.armState.arm(srcDocId);
    }

    private disarm(): void {
        this.armState.disarm();
    }

    /** 「继续生成」：关面板回转换弹窗预填该源文档。 */
    resume(srcDocId: string): void {
        this.closeFn?.();
        this.deps?.resumeProgress(srcDocId);
    }
}
