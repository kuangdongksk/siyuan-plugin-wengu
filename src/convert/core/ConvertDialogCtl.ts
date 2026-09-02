import type { ConvertProgressRecord } from "../service/ConvertBatch";
import type { ConvertRunCfg } from "../service/ConvertRun";
import { extractBlockId, getDocInfo } from "../service/ConvertService";
import type { ConvertDialogDeps } from "../ui/ConvertDialog";
import { openKnowPicker, parseKnowIds } from "../../ui/KnowPicker";
import type { ConvertDialogUi } from "./ConvertDialogUi";

/**
 * 转换弹窗控制器（四件套之一，每开一次弹窗 new 一个——attach 时同步
 * deps 预选值进 ui）。旧实现散在 DOM 控件上的状态（值收集/回显/resume
 * 探查）全部收进本类；弹窗只收集参数，点「开始转换」即关窗，批次循环
 * 交给 ConvertRun 单例运行器。
 */
export class ConvertDialogCtl {
    private ui?: ConvertDialogUi;
    private deps?: ConvertDialogDeps;
    private alive = false;
    private closeFn?: () => void;
    /** 回显解析的竞态序号（输入又变了/已重挂则旧结果丢弃）。 */
    private echoSeq = 0;

    attach(ui: ConvertDialogUi, deps: ConvertDialogDeps, close: () => void): void {
        this.ui = ui;
        this.deps = deps;
        this.closeFn = close;
        this.alive = true;
        ui.docId = deps.activeDocId;
        ui.modelId = deps.initialModelId;
        ui.fillToChoice = deps.initialFillToChoice;
        ui.bigToSteps = deps.initialBigToSteps;
        ui.parallel = deps.initialParallel;
        ui.knowRoots = deps.initialKnowRoots;
        ui.running = deps.isRunning();
        this.syncResume();
        this.resolveDocEcho();
        void this.resolveKnowEcho();
    }

    detach(): void {
        this.alive = false;
    }

    private showStatus(html: string, kind: "ok" | "err" | "muted", keptPartial = false): void {
        if (this.ui) this.ui.status = { html, kind, keptPartial };
    }

    /** muted 状态清除（resume 探查无果时收掉旧提示；err/ok 不动）。 */
    private clearMuted(): void {
        const st = this.ui?.status;
        if (st && st.kind === "muted") this.ui!.status = undefined;
    }

    /* ── 表单字段 ── */

    setModel(id: string): void {
        if (this.ui) this.ui.modelId = id;
    }

    setFill(v: boolean): void {
        if (this.ui) this.ui.fillToChoice = v;
    }

    setSteps(v: boolean): void {
        if (this.ui) this.ui.bigToSteps = v;
    }

    setParallel(v: number): void {
        if (this.ui) this.ui.parallel = v;
    }

    /* ── 选择器与回显 ── */

    pickDoc(anchor: HTMLElement): void {
        const d = this.deps;
        if (!d || !this.ui) return;
        openKnowPicker({
            t: d.t,
            anchor,
            single: true,
            current: [extractBlockId(this.ui.docId)].filter(Boolean),
            onConfirm: (ids) => {
                if (ids[0]) this.setDocId(ids[0]);
            },
        });
    }

    pickKnow(anchor: HTMLElement): void {
        const d = this.deps;
        if (!d || !this.ui) return;
        openKnowPicker({
            t: d.t,
            anchor,
            current: parseKnowIds(this.ui.knowRoots),
            onConfirm: (ids) => {
                if (!this.ui) return;
                this.ui.knowRoots = ids.join(" ");
                void this.resolveKnowEcho();
            },
        });
    }

    setDocId(v: string): void {
        if (!this.ui) return;
        this.ui.docId = v;
        this.syncResume();
        this.resolveDocEcho();
    }

    private resolveDocEcho(): void {
        const ui = this.ui;
        const d = this.deps;
        if (!ui || !d) return;
        const seq = ++this.echoSeq;
        const raw = extractBlockId(ui.docId.trim());
        if (!raw) {
            ui.docEcho = "";
            return;
        }
        void getDocInfo(raw).then((info) => {
            if (seq !== this.echoSeq || !this.alive) return;
            ui.docEcho = info?.hPath || d.t("convertTargetNotFound");
        });
    }

    /** 知识点已选文档 → 标题路径串回显（逐个串行查询）。 */
    private async resolveKnowEcho(): Promise<void> {
        const ui = this.ui;
        const d = this.deps;
        if (!ui || !d) return;
        const seq = ++this.echoSeq;
        const ids = parseKnowIds(ui.knowRoots);
        if (!ids.length) {
            ui.knowEcho = "";
            return;
        }
        const titles: string[] = [];
        for (const id of ids) {
            const info = await getDocInfo(id);
            titles.push(info?.hPath || info?.title || id);
        }
        if (seq !== this.echoSeq || !this.alive) return; // 选择又变了
        ui.knowEcho = titles.join("　");
    }

    /* ── 未完成进度探查 ── */

    private syncResume(): void {
        const ui = this.ui;
        const d = this.deps;
        if (!ui || !d) return;
        const rec = ui.docId.trim() ? d.getProgress(ui.docId.trim()) : undefined;
        ui.resumeRec = rec;
        if (rec) {
            const kept = d
                .t("convertResumeHint")
                .replace("{c}", String(rec.count))
                .replace("{b}", String(rec.batches))
                .replace("{n}", String(rec.total))
                .replace("{title}", rec.title);
            this.showStatus(kept, "muted");
        } else {
            this.clearMuted();
        }
    }

    /* ── 动作 ── */

    /** 开始转换：收集参数交运行器（页面接管状态与渐进呈现），随即关窗。 */
    start(resumeRec?: ConvertProgressRecord): void {
        const d = this.deps;
        const ui = this.ui;
        if (!d || !ui) return;
        const target = ui.docId.trim();
        if (!target) {
            this.showStatus(d.t("convertNoDoc"), "err"); // 原静默 return 像按钮失灵
            return;
        }
        d.saveChoice(ui.modelId, ui.fillToChoice, ui.bigToSteps, ui.knowRoots);
        const cfg: ConvertRunCfg = {
            srcDocId: target,
            modelId: ui.modelId,
            fillToChoice: ui.fillToChoice,
            bigToSteps: ui.bigToSteps,
            parallel: Math.max(1, Math.min(4, ui.parallel || 1)),
            knowRoots: ui.knowRoots
                .split(/[\s,;，；]+/)
                .map((s) => extractBlockId(s))
                .filter((s) => /^\d{14}-[a-z0-9]+$/i.test(s)),
            resume: resumeRec ? { offset: resumeRec.offset, setId: resumeRec.setId } : undefined,
        };
        const started = d.startRun(cfg);
        this.closeFn?.();
        if (!started) {
            // 已有转换在跑：不再报错——直接转进转换管理面板单独管理
            d.openPanel();
        }
    }

    /** 「继续生成」（resume 记录就位时）。 */
    resume(): void {
        const d = this.deps;
        const ui = this.ui;
        if (!d || !ui) return;
        const rec = ui.docId.trim() ? d.getProgress(ui.docId.trim()) : undefined;
        if (rec) this.start(rec);
    }

    /** 「查看进行中的转换」：关窗转管理面板。 */
    manage(): void {
        this.closeFn?.();
        this.deps?.openPanel();
    }
}
