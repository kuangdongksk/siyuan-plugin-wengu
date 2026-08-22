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
import {getDocInfo} from "./ConvertService";
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
    /** 生成位置预选：same=原文档同目录；custom=指定父文档下面。 */
    initialTargetMode: "same" | "custom";
    /** 指定父文档 id 预选（生成位置=custom 时用）。 */
    initialTargetId: string;
    /** 用户本次的选择（记入 prefs）。 */
    saveChoice(modelId: string, fillToChoice: boolean, bigToSteps: boolean): void;
    /** 读取某源文档的未完成转换进度（无则 undefined）。 */
    getProgress(srcDocId: string): ConvertProgressRecord | undefined;
    /** 记录/清除未完成转换进度（prefs 持久化）。 */
    saveProgress(srcDocId: string, rec: ConvertProgressRecord | undefined): void;
    /** 转换状态变化（禁用/恢复目录底部的转换按钮）。 */
    setConverting(v: boolean): void;
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
                    ),
            )
        }
      <div class="wengu-status" data-act="dlg-status" hidden></div>
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
    const targetSel = root.querySelector<HTMLSelectElement>("[data-act='dlg-target']");
    const targetInput = root.querySelector<HTMLInputElement>("[data-act='dlg-targetid']");
    const okBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-ok']");
    const cancelBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-cancel']");
    const stopBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-stop']");
    const resumeRow = root.querySelector<HTMLElement>("[data-act='dlg-resume-row']");
    const status = root.querySelector<HTMLElement>("[data-act='dlg-status']");
    /** 按钮阶段：idle 默认 / running 生成中 / choice 终止后的二选一。 */
    let phase: "idle" | "running" | "choice" = "idle";

    const showDlgStatus = (html: string, kind: "ok" | "err" | "muted") => {
        if (!status) return;
        status.innerHTML = html;
        status.className = `wengu-status wengu-status-${kind}`;
        status.removeAttribute("hidden");
    };
    const setBusy = (running: boolean) => {
        deps.setConverting(running);
        if (okBtn) okBtn.disabled = running;
        if (stopBtn) stopBtn.hidden = !running;
        if (cancelBtn) cancelBtn.disabled = running;
        if (resumeRow) resumeRow.hidden = running || resumeRow.dataset.has !== "1";
        [input, modelSel, fillInput, stepsInput].forEach((el) => {
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
            deps.saveProgress(srcDocId, undefined);
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
        const genTarget = targetSel?.value === "custom" ? (targetInput?.value ?? "").trim() : "";
        if (targetSel?.value === "custom" && !genTarget) {
            showDlgStatus(t("convertTargetMissing"), "err");
            return;
        }
        deps.saveChoice(modelId, fill, bigSteps);
        const controller = new AbortController();
        phase = "running";
        setBusy(true);
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
                signal: controller.signal,
                resume: resumeRec ? {offset: resumeRec.offset, docId: resumeRec.docId} : undefined,
                targetRaw: genTarget,
                onProgress: (p) => {
                    if (p.phase === "detect") {
                        showDlgStatus(t("convertDetecting"), "muted");
                        return;
                    }
                    if (p.phase === "writing") {
                        showDlgStatus(t("settling"), "muted");
                        return;
                    }
                    const detected = p.detected !== undefined && p.detected > 0 ?
                        ` · ${esc(fmt(t("convertDetected"), {n: String(p.detected)}))}` :
                        "";
                    showDlgStatus(
                        `${
                            esc(fmt(t("convertBatchProgress"), {
                                i: String(p.batch),
                                n: String(p.total),
                                c: String(p.count),
                            }))
                        }${detected}`,
                        "muted",
                    );
                },
            });
            if (r.status === "done") {
                if (resumeRec) {
                    // 继续生成完成：删旧的部分文档、清进度
                    await removeDoc(resumeRec.docId);
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
            showDlgStatus(r.message || t("convertNoQuestions"), "err");
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
