import type { ConvertProgressRecord } from "../service/run/ConvertBatch";
import type { ConvertRunCfg } from "../service/run/ConvertRun";
import { extractBlockId, getDocInfo } from "../service/core/ConvertService";
import { buildBatchQueue, isBatchQueue, planSubDocs } from "../service/source/SubDocs";
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
    /** 子文档探查的竞态序号（与回显分开：探查只改 subDocs/docEmpty）。 */
    private subSeq = 0;
    /** 本次打开是否来自「继续生成」的**队列恢复**（Issue #62）：由 deps
     *  传入，子文档探查落定后自动勾上「连同子文档」，让弹窗直接展开整个
     *  队列（否则源=根通常无进度记录，用户看不到任何 resume 提示，
     *  一眼像是「继续生成」失灵）。 */
    private resumeQueue = false;

    attach(ui: ConvertDialogUi, deps: ConvertDialogDeps, close: () => void): void {
        this.ui = ui;
        this.deps = deps;
        this.closeFn = close;
        this.alive = true;
        ui.docId = deps.activeDocId;
        this.resumeQueue = deps.resumeQueue === true;
        ui.modelId = deps.initialModelId;
        ui.fillToChoice = deps.initialFillToChoice;
        ui.bigToSteps = deps.initialBigToSteps;
        ui.parallel = deps.initialParallel;
        ui.knowRoots = deps.initialKnowRoots;
        ui.running = deps.isRunning();
        this.syncResume();
        this.resolveDocEcho();
        void this.resolveSubDocs();
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
        void this.resolveSubDocs();
    }

    /** 「连同子文档」勾选（只改回显，起点跑时才定队列）。 */
    setIncludeSub(v: boolean): void {
        if (this.ui) this.ui.includeSub = v;
    }

    /** 「重转已转换过的篇」勾选（Issue #62，仅队列模式显示）。 */
    setReconvert(v: boolean): void {
        if (this.ui) this.ui.reconvertDone = v;
    }

    /** 探查源文档的子文档清单（文件夹式文档提示与批量队列都靠它）。
     *  与回显共用竞态口径：序列号对不上/已卸载则丢弃结果。 */
    private async resolveSubDocs(): Promise<void> {
        const ui = this.ui;
        const d = this.deps;
        if (!ui || !d) return;
        const seq = ++this.subSeq;
        const raw = extractBlockId(ui.docId.trim());
        if (!raw) {
            ui.subDocs = [];
            ui.docEmpty = false;
            return;
        }
        const plan = await planSubDocs(raw).catch((): undefined => undefined);
        if (seq !== this.subSeq || !this.alive) return;
        // 中间层空壳已在 planSubDocs 里剔掉：清单即队列成员，弹窗展示的
        // 子文档数与真跑队列逐一对得上（Issue #42 验收 1/3）。
        ui.subDocs = plan?.children ?? [];
        ui.docEmpty = plan?.rootEmpty ?? false;
        // 队列恢复预勾（Issue #62）：有子文档才勾得上——空壳根本来就会自动
        // 展开，两种形态殊途同归
        if (this.resumeQueue && ui.subDocs.length > 0) ui.includeSub = true;
    }

    /** 队列标题（=根文档标题；回显为空时用 id 兜底）。 */
    private batchTitle(): string {
        const ui = this.ui;
        if (!ui) return "";
        return ui.docEcho || extractBlockId(ui.docId.trim());
    }

    /** 批量队列（未勾选且源非空壳=空队列，start 走单篇流程）。 */
    private batchQueue(): import("../service/source/SubDocs").SubDocRef[] {
        const ui = this.ui;
        if (!ui) return [];
        return buildBatchQueue(
            {
                root: { id: extractBlockId(ui.docId.trim()), title: ui.docEcho || "" },
                children: ui.subDocs,
                rootEmpty: ui.docEmpty,
            },
            ui.includeSub
        );
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
        // 批量队列（Issue #37）：「连同子文档」勾选或源为空壳子文档文件夹时
        // 展开。**单篇**续跑记录（无 batch 键，如面板对单篇记录点「继续
        // 生成」）仍不展开队列——只恢复那一篇，防意外转换别的篇；**带
        // batch 的队列记录**照常展开队列、逐篇自查续跑（Issue #62，
        // resume 不传：队列逐篇按 id 各自查记录）
        const queue = resumeRec && !resumeRec.batch ? [] : this.batchQueue();
        // 队列与「单篇=源自身」等价时才退化（判据见 isBatchQueue——空壳
        // 文件夹只有 1 个子文档时也必须走队列，否则转的是空壳源本身）
        const asQueue = isBatchQueue(queue, extractBlockId(target));
        const batchTitle = this.batchTitle();
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
            resume: resumeRec && !resumeRec.batch ? { offset: resumeRec.offset, setId: resumeRec.setId } : undefined,
            subDocs: asQueue ? queue : undefined,
            batchTitle: asQueue ? batchTitle : undefined,
            reconvertDone: ui.reconvertDone,
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
