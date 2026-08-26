import { Dialog } from "siyuan";
import type { ConvertProgressRecord } from "./ConvertBatch";
import type { ConvertRunCfg } from "./ConvertRun";
import { convertDialogHtml } from "./ConvertDialogHtml";
import { bindDocLink, echoKnowTitles } from "./ConvertPick";
import { extractBlockId } from "./ConvertService";
import { bindPdfImportRow } from "./PdfImportRow";
import { openKnowPicker, parseKnowIds } from "../ui/KnowPicker";
import { esc, fmt } from "../ui/shared";

/**
 * AI 转习题对话框（从 QuizView 拆出）：选模型 + 转换开关 + 并发批数 +
 * 文档 id + 转换方式（默认原位替换，可切另存）+ 从 PDF 导入。
 * 弹窗只收集参数——点「开始转换」即关窗，批次循环交给 ConvertRun
 * 单例运行器：温故页签渐进呈现做题界面，页内转换条展示进度并支持
 * 停止/保留进度/全部丢弃；有保留进度时弹窗内出现「继续生成」入口。
 */

/** 对话框依赖的宿主能力（QuizView 提供）。 */
export interface ConvertDialogDeps {
    t: (key: string) => string;
    /** 文档 id 输入框默认值（顶栏带来的活动文档）。 */
    activeDocId: string;
    /** MinerU API token（设置页配置，空=未配置）。 */
    mineruToken: string;
    /** 模型预选值（prefs 上次临时用 > 设置默认 > 空串=默认）。 */
    initialModelId: string;
    /** 填空转选择预选值（prefs 上次 > 设置默认）。 */
    initialFillToChoice: boolean;
    /** 大题拆多步预选值（prefs 上次 > 设置默认）。 */
    initialBigToSteps: boolean;
    /** 并发批数预选值（设置默认，1=串行）。 */
    initialParallel: number;
    /** 生成位置预选：same=原文档同目录；custom=指定父文档下面。 */
    initialTargetMode: "same" | "custom";
    /** 指定父文档 id 预选（生成位置=custom 时用）。 */
    initialTargetId: string;
    /** 知识点根文档预选（prefs 上次，多个 id 空格分隔的原始串）。 */
    initialKnowRoots: string;
    /** 用户本次的选择（记入 prefs；knowRoots 为原始输入串）。 */
    saveChoice(modelId: string, fillToChoice: boolean, bigToSteps: boolean, knowRoots: string): void;
    /** 读取某源文档的未完成转换进度（无则 undefined）。 */
    getProgress(srcDocId: string): ConvertProgressRecord | undefined;
    /** 转换状态变化（禁用/恢复目录底部的转换按钮；PDF 导入流程也用）。 */
    setConverting(v: boolean): void;
    /** 启动转换运行器（false=已有转换在跑）。 */
    startRun(cfg: ConvertRunCfg): boolean;
}

export function openConvertDialog(deps: ConvertDialogDeps): void {
    const { t } = deps;
    const dialog = new Dialog({
        title: t("convertBtn"),
        width: "560px",
        content: convertDialogHtml(deps),
    });
    const root = dialog.element;
    const input = root.querySelector<HTMLInputElement>("[data-act='dlg-docid']");
    const modelSel = root.querySelector<HTMLSelectElement>("[data-act='dlg-model']");
    const fillInput = root.querySelector<HTMLInputElement>("[data-act='dlg-fill']");
    const stepsInput = root.querySelector<HTMLInputElement>("[data-act='dlg-steps']");
    const parallelSel = root.querySelector<HTMLSelectElement>("[data-act='dlg-parallel']");
    const wmodeSel = root.querySelector<HTMLSelectElement>("[data-act='dlg-wmode']");
    const pdfBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-pdf']");
    const targetSel = root.querySelector<HTMLSelectElement>("[data-act='dlg-target']");
    const targetInput = root.querySelector<HTMLInputElement>("[data-act='dlg-targetid']");
    const knowInput = root.querySelector<HTMLInputElement>("[data-act='dlg-know']");
    const knowPickBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-knowpick']");
    const targetRows = root.querySelector<HTMLElement>("[data-act='dlg-target-rows']");
    const targetPickBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-targetpick']");
    const targetEcho = root.querySelector<HTMLElement>("[data-act='dlg-target-echo']");
    const docPickBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-docpick']");
    const docEcho = root.querySelector<HTMLElement>("[data-act='dlg-doc-echo']");
    const knowEcho = root.querySelector<HTMLElement>("[data-act='dlg-know-echo']");
    const okBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-ok']");
    const cancelBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-cancel']");
    const stopBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-stop']");
    const resumeRow = root.querySelector<HTMLElement>("[data-act='dlg-resume-row']");
    const status = root.querySelector<HTMLElement>("[data-act='dlg-status']");

    const showDlgStatus = (html: string, kind: "ok" | "err" | "muted", keptPartial = false) => {
        if (!status) return;
        status.innerHTML = html + (keptPartial ? `<br>${esc(t("convertPartialKept"))}` : "");
        status.className = `wengu-status wengu-status-${kind}`;
        status.removeAttribute("hidden");
    };
    const setBusy = (running: boolean) => {
        deps.setConverting(running);
        if (okBtn) okBtn.disabled = running;
        if (stopBtn) stopBtn.hidden = !running;
        if (cancelBtn) cancelBtn.disabled = running;
        if (resumeRow) resumeRow.hidden = running || resumeRow.dataset.has !== "1";
        [
            input,
            modelSel,
            fillInput,
            stepsInput,
            parallelSel,
            wmodeSel,
            targetSel,
            targetInput,
            pdfBtn,
            knowInput,
            knowPickBtn,
            targetPickBtn,
            docPickBtn,
        ].forEach((el) => {
            if (el) el.disabled = running;
        });
    };

    // 输入变化时探查该文档是否有未完成的转换进度
    const syncResumeHint = () => {
        const docId = (input?.value ?? "").trim();
        const rec = docId ? deps.getProgress(docId) : undefined;
        if (resumeRow) {
            resumeRow.dataset.has = rec ? "1" : "";
            resumeRow.hidden = !rec;
        }
        if (rec) {
            showDlgStatus(
                esc(
                    fmt(t("convertResumeHint"), {
                        c: String(rec.count),
                        b: String(rec.batches),
                        n: String(rec.total),
                        title: rec.title,
                    })
                ),
                "muted"
            );
        } else if (status && !status.hidden && status.classList.contains("wengu-status-muted")) {
            status.setAttribute("hidden", "");
        }
    };
    input?.addEventListener("input", syncResumeHint);
    input?.addEventListener("focus", syncResumeHint);

    // 知识点文档：纯选择器（无输入框），已选以标题路径回显
    root.querySelector<HTMLButtonElement>("[data-act='dlg-knowpick']")?.addEventListener("click", () => {
        openKnowPicker({
            t,
            current: parseKnowIds(knowInput?.value ?? ""),
            onConfirm: (ids) => {
                if (knowInput) knowInput.value = ids.join(" ");
                void echoKnowTitles(t, knowInput, knowEcho);
            },
        });
    });
    void echoKnowTitles(t, knowInput, knowEcho); // prefs 预选初始回显

    // 原位替换用不到生成位置——收起两行（值保留在控件里，PDF 导入的落点仍可读）
    const syncTargetRows = () => {
        if (targetRows) targetRows.hidden = (wmodeSel?.value ?? "inplace") !== "newdoc";
    };
    wmodeSel?.addEventListener("change", syncTargetRows);
    syncTargetRows();

    // 源文档/父文档动态联动：选择器按钮 + id→标题路径回显（父文档仅 custom 时显示）
    const echoDoc = bindDocLink({
        t,
        input,
        btn: docPickBtn,
        echo: docEcho,
        titleKey: "sourcePickTitle",
        onPick: syncResumeHint,
    });
    const echoTarget = bindDocLink({
        t,
        input: targetInput,
        btn: targetPickBtn,
        echo: targetEcho,
        active: () => targetSel?.value === "custom",
    });
    targetSel?.addEventListener("change", echoTarget);

    /** 开始转换：收集参数交运行器（页面接管状态与渐进呈现），随即关窗。 */
    const start = (resumeRec?: ConvertProgressRecord) => {
        const target = (input?.value ?? "").trim();
        if (!target) return;
        const modelId = modelSel?.value ?? "";
        const fill = fillInput?.checked ?? false;
        const bigSteps = stepsInput?.checked ?? false;
        const parallel = Math.max(1, Math.min(4, Number(parallelSel?.value ?? 1) || 1));
        const writeMode = wmodeSel?.value === "newdoc" ? "newdoc" : "inplace";
        const genTarget = targetSel?.value === "custom" ? (targetInput?.value ?? "").trim() : "";
        if (writeMode === "newdoc" && targetSel?.value === "custom" && !genTarget) {
            showDlgStatus(t("convertTargetMissing"), "err");
            return;
        }
        const knowRaw = (knowInput?.value ?? "").trim();
        deps.saveChoice(modelId, fill, bigSteps, knowRaw);
        const started = deps.startRun({
            srcDocId: target,
            modelId,
            fillToChoice: fill,
            bigToSteps: bigSteps,
            parallel,
            writeMode,
            targetRaw: genTarget,
            knowRoots: knowRaw
                .split(/[\s,;，；]+/)
                .map((s) => extractBlockId(s))
                .filter((s) => /^\d{14}-[a-z0-9]+$/i.test(s)),
            resume: resumeRec
                ? { offset: resumeRec.offset, docId: resumeRec.docId, kramdown: resumeRec.kramdown }
                : undefined,
        });
        if (!started) {
            showDlgStatus(t("convertBusy"), "err");
            return;
        }
        dialog.destroy();
    };

    if (okBtn) okBtn.onclick = () => start();
    if (cancelBtn) cancelBtn.onclick = () => dialog.destroy();

    // 从 PDF 导入（MinerU）：位置=custom 指定父文档，否则当前文档旁边
    bindPdfImportRow(root, {
        t,
        mineruToken: deps.mineruToken,
        hookStop: (c) => {
            if (stopBtn) stopBtn.onclick = () => c.abort();
        },
        resolveTarget: () => {
            const custom = (targetInput?.value ?? "").trim();
            return targetSel?.value === "custom" && custom
                ? { parentDocId: custom }
                : {
                      siblingDocId: (input?.value ?? "").trim() || deps.activeDocId,
                  };
        },
        showStatus: (html, kind) => showDlgStatus(html, kind),
        setBusy,
        onImported: (r) => {
            if (input) input.value = r.docId;
            echoDoc(); // 回填后刷新标题路径回显
            syncResumeHint();
        },
    });
    root.querySelector("[data-act='dlg-resume']")?.addEventListener("click", () => {
        const docId = (input?.value ?? "").trim();
        const rec = docId ? deps.getProgress(docId) : undefined;
        if (rec) start(rec);
    });
    syncResumeHint();
}
