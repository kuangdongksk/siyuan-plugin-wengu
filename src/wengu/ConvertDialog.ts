import {Dialog} from "siyuan";
import {modelOptionsHtml} from "./AgentClient";
import {
    convertDocBatched,
    removeDoc,
    toConvertResult,
    writeExerciseDoc,
} from "./ConvertBatch";
import type {
    BatchedResult,
    ConvertProgressRecord,
} from "./ConvertBatch";
import {
    extractBlockId,
    getDocInfo,
} from "./ConvertService";
import {
    formGroup,
    formInput,
    formOption,
    formRow,
    formSelect,
    formSwitch,
} from "./FormHtml";
import {listQuestionDocs} from "./QuestionService";
import {
    esc,
    fmt,
} from "./ui";

/**
 * AI 转习题对话框（从 QuizView 拆出）：选模型 + 转换开关 + 文档 id。
 * 分批生成长文档：状态行实时展示「检测到 N 题 / 第 x/y 批 · 已 n 题」，
 * 生成中可终止——终止后选择保留已生成（建文档并可日后继续生成）或
 * 全部丢弃；上次终止保留过的文档弹出「继续生成」入口。
 */

/** 对话框依赖的宿主能力（QuizView 提供）。 */
export interface ConvertDialogDeps {
    t: (key: string) => string;
    /** 文档 id 输入框默认值（顶栏带来的活动文档）。 */
    activeDocId: string;
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
    /** 记录/清除未完成转换进度（prefs 持久化）。 */
    saveProgress(srcDocId: string, rec: ConvertProgressRecord | undefined): void;
    /** 转换状态变化（禁用/恢复目录底部的转换按钮）。 */
    setConverting(v: boolean): void;
    /** 每批渐进落盘后回调（页签以做题界面渐进呈现；id 每批会变）。 */
    onBatch?(docId: string, title: string, count: number, batch: number, total: number): void;
    /** 全部丢弃后回调（页签清掉渐进呈现、恢复原状）。 */
    onCancel?(): void;
    /** 成功：docId/title/count + 摘要 message。 */
    onDone(r: {docId: string; title: string; count: number; message: string;}): void;
}

export function openConvertDialog(deps: ConvertDialogDeps): void {
    const {t} = deps;
    const dialog = new Dialog({
        title: t("convertBtn"),
        width: "560px",
        content: `<div class="b3-dialog__content wengu-convert-dialog">
      <div class="wengu-muted">${esc(t("convertDialogHint"))}</div>
      ${
            formGroup(
                t("convertBtn"),
                formRow(
                    t("modelLabel"),
                    t("setModelHint"),
                    formSelect("dlg-model", modelOptionsHtml(deps.initialModelId), "data-act"),
                ) +
                    formRow(
                        t("fillToChoice"),
                        t("fillToChoiceHint"),
                        formSwitch("dlg-fill", deps.initialFillToChoice, "data-act"),
                    ) +
                    formRow(
                        t("bigToSteps"),
                        t("bigToStepsHint"),
                        formSwitch("dlg-steps", deps.initialBigToSteps, "data-act"),
                    ) +
                    formRow(
                        t("convertParallelLabel"),
                        t("convertParallelHint"),
                        formSelect(
                            "dlg-parallel",
                            formOption("1", t("convertParallel1"), deps.initialParallel <= 1) +
                                formOption("2", fmt(t("convertParallelN"), {n: "2"}), deps.initialParallel === 2) +
                                formOption("3", fmt(t("convertParallelN"), {n: "3"}), deps.initialParallel === 3) +
                                formOption("4", fmt(t("convertParallelN"), {n: "4"}), deps.initialParallel === 4),
                            "data-act",
                        ),
                    ) +
                    formRow(
                        t("docIdLabel"),
                        t("docIdPlaceholder"),
                        formInput(
                            "dlg-docid",
                            deps.activeDocId,
                            `spellcheck="false" placeholder="${esc(t("docIdPlaceholder"))}"`,
                            "data-act",
                        ),
                    ) +
                    formRow(
                        t("convertTarget"),
                        t("convertTargetHint"),
                        formSelect(
                            "dlg-target",
                            formOption("same", t("convertTargetSame"), deps.initialTargetMode !== "custom") +
                                formOption("custom", t("convertTargetCustom"), deps.initialTargetMode === "custom"),
                            "data-act",
                        ),
                    ) +
                    formRow(
                        t("convertTargetDoc"),
                        t("convertTargetDocHint"),
                        formInput(
                            "dlg-targetid",
                            deps.initialTargetId,
                            `spellcheck="false" placeholder="${esc(t("docIdPlaceholder"))}"`,
                            "data-act",
                        ),
                    ) +
                    formRow(
                        t("convertKnowLabel"),
                        t("convertKnowHint"),
                        formInput(
                            "dlg-know",
                            deps.initialKnowRoots,
                            `spellcheck="false" placeholder="${esc(t("convertKnowPlaceholder"))}"`,
                            "data-act",
                        ),
                    ),
            )
        }
      <div class="wengu-status" data-act="dlg-status" hidden></div>
      <div class="wengu-convert-preview" data-act="dlg-preview" hidden></div>
      <div data-act="dlg-resume-row" hidden>
        <button class="b3-button b3-button--text" data-act="dlg-resume">${esc(t("convertResumeBtn"))}</button>
      </div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="dlg-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--outline" data-act="dlg-stop" hidden>${esc(t("convertStop"))}</button>
      <button class="b3-button b3-button--outline" data-act="dlg-ok">${esc(t("convertStart"))}</button>
    </div>`,
    });
    const root = dialog.element;
    const input = root.querySelector<HTMLInputElement>("[data-act='dlg-docid']");
    const modelSel = root.querySelector<HTMLSelectElement>("[data-act='dlg-model']");
    const fillInput = root.querySelector<HTMLInputElement>("[data-act='dlg-fill']");
    const stepsInput = root.querySelector<HTMLInputElement>("[data-act='dlg-steps']");
    const parallelSel = root.querySelector<HTMLSelectElement>("[data-act='dlg-parallel']");
    const targetSel = root.querySelector<HTMLSelectElement>("[data-act='dlg-target']");
    const targetInput = root.querySelector<HTMLInputElement>("[data-act='dlg-targetid']");
    const knowInput = root.querySelector<HTMLInputElement>("[data-act='dlg-know']");
    const okBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-ok']");
    const cancelBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-cancel']");
    const stopBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-stop']");
    const resumeRow = root.querySelector<HTMLElement>("[data-act='dlg-resume-row']");
    const status = root.querySelector<HTMLElement>("[data-act='dlg-status']");
    const preview = root.querySelector<HTMLElement>("[data-act='dlg-preview']");

    /** 渐进预览：追加本批题目的「题号 题型 题干片段」行并滚到底。 */
    const appendStems = (stems: {no: number; type: string; stem: string;}[] | undefined): void => {
        if (!preview || !stems?.length) return;
        preview.removeAttribute("hidden");
        for (const s of stems) {
            const row = document.createElement("div");
            row.className = "wengu-preview-row";
            const key = s.type ? `type${s.type[0].toUpperCase()}${s.type.slice(1)}` : "";
            const known = key ? t(key) : "";
            const typeLabel = known && known !== key ? known : s.type;
            row.innerHTML = `<span class="wengu-preview-no">${s.no}</span>` +
                (typeLabel ? `<span class="wengu-badge">${esc(typeLabel)}</span>` : "") +
                `<span class="wengu-preview-stem" title="${esc(s.stem)}">${esc(s.stem)}</span>`;
            preview.appendChild(row);
        }
        preview.scrollTop = preview.scrollHeight;
    };
    /** 按钮阶段：idle 默认 / running 生成中 / choice 终止后的二选一。 */
    let phase: "idle" | "running" | "choice" = "idle";

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
        [input, modelSel, fillInput, stepsInput, parallelSel, knowInput].forEach((el) => {
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
                esc(fmt(t("convertResumeHint"), {
                    c: String(rec.count),
                    b: String(rec.batches),
                    n: String(rec.total),
                    title: rec.title,
                })),
                "muted",
            );
        } else if (status && !status.hidden && status.classList.contains("wengu-status-muted")) {
            status.setAttribute("hidden", "");
        }
    };
    input?.addEventListener("input", syncResumeHint);
    input?.addEventListener("focus", syncResumeHint);

    /** 转换收尾：等索引可见 → 关弹窗 → 通知宿主。 */
    const finish = async (r: BatchedResult) => {
        if (!r.docId) return;
        showDlgStatus(t("settling"), "muted");
        await waitForDocInList(r.docId, 15000);
        const c = toConvertResult(r);
        dialog.destroy();
        deps.onDone({docId: c.docId ?? "", title: c.title ?? "", count: c.count, message: c.message});
    };

    /** 终止后的二选一：保留已生成（建文档+记进度）/ 全部丢弃。 */
    const chooseStop = (r: BatchedResult, srcDocId: string, targetRaw: string) => {
        if (!okBtn || !cancelBtn) return;
        if (!r.kramdown.trim()) {
            showDlgStatus(t("convertStoppedEmpty"), "err");
            bindDefaultButtons();
            return;
        }
        showDlgStatus(
            esc(fmt(t("convertStopped"), {c: String(r.count), b: String(r.batches), n: String(r.total)})),
            "muted",
        );
        okBtn.textContent = t("convertKeep");
        cancelBtn.textContent = t("convertDiscard");
        phase = "choice";
        okBtn.onclick = () =>
            void (async () => {
                // 渐进落盘已有文档：只记进度；否则（首批前终止）现写一份
                if (r.docId && r.title) {
                    deps.saveProgress(srcDocId, {
                        docId: r.docId,
                        title: r.title,
                        offset: r.doneOffset,
                        batches: r.batches,
                        total: r.total,
                        count: r.count,
                    });
                    await finish(r);
                    return;
                }
                const info = await getDocInfo(srcDocId);
                if (!info) return;
                setBusy(true);
                try {
                    const created = await writeExerciseDoc(info, r.kramdown, srcDocId, targetRaw, t);
                    deps.saveProgress(srcDocId, {
                        docId: created.id,
                        title: created.title,
                        offset: r.doneOffset,
                        batches: r.batches,
                        total: r.total,
                        count: r.count,
                    });
                    await finish({...r, status: "done", docId: created.id, title: created.title});
                } catch (e) {
                    setBusy(false);
                    showDlgStatus(String((e as Error)?.message ?? e), "err");
                }
            })();
        cancelBtn.onclick = () => {
            void (r.docId ? removeDoc(r.docId) : Promise.resolve());
            deps.saveProgress(srcDocId, undefined);
            deps.onCancel?.();
            bindDefaultButtons();
            showDlgStatus(t("convertDiscarded"), "muted");
            setBusy(false);
        };
    };

    const run = async (resumeRec?: ConvertProgressRecord) => {
        const target = (input?.value ?? "").trim();
        if (!target || !okBtn) return;
        const modelId = modelSel?.value ?? "";
        const fill = fillInput?.checked ?? false;
        const bigSteps = stepsInput?.checked ?? false;
        const parallel = Math.max(1, Math.min(4, Number(parallelSel?.value ?? 1) || 1));
        const genTarget = targetSel?.value === "custom" ? (targetInput?.value ?? "").trim() : "";
        if (targetSel?.value === "custom" && !genTarget) {
            showDlgStatus(t("convertTargetMissing"), "err");
            return;
        }
        const knowRaw = (knowInput?.value ?? "").trim();
        const knowRoots = knowRaw
            .split(/[\s,;，；]+/)
            .map((s) => extractBlockId(s))
            .filter((s) => /^\d{14}-[a-z0-9]+$/i.test(s));
        deps.saveChoice(modelId, fill, bigSteps, knowRaw);
        const controller = new AbortController();
        phase = "running";
        setBusy(true);
        if (preview) {
            preview.innerHTML = "";
            preview.setAttribute("hidden", "");
        }
        if (stopBtn) {
            stopBtn.onclick = () => controller.abort();
        }
        showDlgStatus(t("converting"), "muted");
        try {
            const r = await convertDocBatched(target, {
                t,
                modelId,
                fillToChoice: fill,
                bigToSteps: bigSteps,
                parallel,
                signal: controller.signal,
                resume: resumeRec ? {offset: resumeRec.offset, docId: resumeRec.docId} : undefined,
                targetRaw: genTarget,
                knowRoots,
                onProgress: (p) => {
                    if (p.phase === "detect") {
                        showDlgStatus(t("convertDetecting"), "muted");
                        return;
                    }
                    if (p.phase === "writing") {
                        showDlgStatus(t("settling"), "muted");
                        appendStems(p.newStems);
                        if (p.docId) deps.onBatch?.(p.docId, p.title ?? "", p.count, p.batch, p.total);
                        return;
                    }
                    // batch=i 表示第 i+1 批进行中；lastBatch 是刚完成那批的题数
                    // 检测总数：截断时 N+（下限）；多批文档数不出时明说「未确定」
                    appendStems(p.newStems);
                    if (p.docId) deps.onBatch?.(p.docId, p.title ?? "", p.count, p.batch, p.total);
                    const totalHint = p.detected !== undefined && p.detected > 0 ?
                        ` · ${esc(fmt(t("convertDetected"), {n: String(p.detected)}))}${
                            p.detectedTruncated ? "+" : ""
                        }` :
                        (p.total > 1 ? ` · ${esc(t("convertTotalUnknown"))}` : "");
                    const lastDelta = p.lastBatch > 0 ?
                        ` · ${esc(fmt(t("convertLastBatch"), {k: String(p.lastBatch)}))}` :
                        "";
                    const main = parallel > 1 ?
                        esc(fmt(t("convertBatchParallel"), {
                            b: String(p.batch),
                            n: String(p.total),
                            c: String(p.count),
                        })) :
                        esc(fmt(t("convertBatchProgress"), {
                            i: String(p.batch + 1),
                            n: String(p.total),
                            c: String(p.count),
                        }));
                    showDlgStatus(`${main}${lastDelta}${totalHint}`, "muted");
                },
            });
            if (r.status === "done") {
                if (resumeRec) {
                    // 继续生成完成：旧文档已在批间重建时删除，这里只清进度
                    deps.saveProgress(target, undefined);
                } else {
                    deps.saveProgress(target, undefined);
                }
                await finish(r);
                return;
            }
            if (r.status === "aborted") {
                chooseStop(r, target, genTarget);
                return;
            }
            showDlgStatus(r.message || t("convertNoQuestions"), "err", r.count > 0 && !!r.docId);
            if (r.count > 0 && r.docId && r.title) {
                // 中途失败但已有渐进落盘的部分文档：保留 + 记进度（可继续生成）
                deps.saveProgress(target, {
                    docId: r.docId,
                    title: r.title,
                    offset: r.doneOffset,
                    batches: r.batches,
                    total: r.total,
                    count: r.count,
                });
            }
            bindDefaultButtons();
        } catch (e) {
            showDlgStatus(String((e as Error)?.message ?? e), "err");
            bindDefaultButtons();
        } finally {
            setBusy(false);
        }
    };

    /** 默认按钮语义（终止二选一会临时替换，这里负责绑回默认）。 */
    const bindDefaultButtons = () => {
        phase = "idle";
        if (okBtn) {
            okBtn.textContent = t("convertStart");
            okBtn.onclick = () => void run();
        }
        if (cancelBtn) {
            cancelBtn.textContent = t("cancel");
            cancelBtn.onclick = () => dialog.destroy();
        }
    };
    bindDefaultButtons();
    root.querySelector("[data-act='dlg-resume']")?.addEventListener("click", () => {
        const docId = (input?.value ?? "").trim();
        const rec = docId ? deps.getProgress(docId) : undefined;
        if (rec) void run(rec);
    });
    input?.addEventListener("keydown", (ev) => {
        if ((ev as KeyboardEvent).key === "Enter" && phase === "idle" && okBtn && !okBtn.disabled) void run();
    });
    input?.focus();
    syncResumeHint();
}

/** 轮询直到习题文档进入 SQL 聚合结果（内核 attributes 索引有数秒延迟）。 */
async function waitForDocInList(docId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const docs = await listQuestionDocs();
        if (docs.some((d) => d.id === docId)) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}
