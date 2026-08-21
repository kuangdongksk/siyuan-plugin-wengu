import {Dialog} from "siyuan";
import {
    defaultAgentModelId,
    listAiModels,
} from "./AgentClient";
import {convertDocToQuestions} from "./ConvertService";
import {listQuestionDocs} from "./QuestionService";
import {esc} from "./ui";

/**
 * AI 转习题对话框（从 QuizView 拆出）：选模型 + 填空转选择开关 +
 * 文档 id（或 siyuan:// 链接），进度与结果都在框内展示。
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
    /** 用户本次的选择（记入 prefs）。 */
    saveChoice(modelId: string, fillToChoice: boolean): void;
    /** 转换状态变化（禁用/恢复目录底部的转换按钮）。 */
    setConverting(v: boolean): void;
    /** 成功：docId/title/count + 摘要 message。 */
    onDone(r: {docId: string; title: string; count: number; message: string;}): void;
}

export function openConvertDialog(deps: ConvertDialogDeps): void {
    const {t} = deps;
    const models = listAiModels();
    const def = models.find((m) => m.id === defaultAgentModelId());
    const modelOptions = `<option value="">${esc(t("modelDefault"))}${
        def ? `（${esc(def.provider)} · ${esc(def.name)}）` : ""
    }</option>${
        models
            .map((m) =>
                `<option value="${esc(m.id)}"${deps.initialModelId === m.id ? " selected" : ""}>${esc(m.provider)} · ${
                    esc(m.name)
                }</option>`
            )
            .join("")
    }`;
    const dialog = new Dialog({
        title: t("convertBtn"),
        width: "520px",
        content: `<div class="b3-dialog__content wengu-convert-dialog">
      <div class="wengu-muted">${esc(t("convertDialogHint"))}</div>
      <label class="wengu-dialog-label">${esc(t("modelLabel"))}</label>
      <select class="b3-select fn__block" data-act="dlg-model">${modelOptions}</select>
      <label class="wengu-dialog-label">${esc(t("docIdLabel"))}</label>
      <input class="b3-text-field fn__block" data-act="dlg-docid" spellcheck="false"
        placeholder="${esc(t("docIdPlaceholder"))}" value="${esc(deps.activeDocId)}" />
      <label class="fn__flex b3-label" style="gap:8px;margin-top:8px">
        <input class="b3-switch" type="checkbox" data-act="dlg-fill"${deps.initialFillToChoice ? " checked" : ""}>
        <span>${esc(t("fillToChoice"))}</span>
        <span class="b3-label__text fn__flex-1">${esc(t("fillToChoiceHint"))}</span>
      </label>
      <div class="wengu-status" data-act="dlg-status" hidden></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="dlg-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--text" data-act="dlg-ok">${esc(t("convertStart"))}</button>
    </div>`,
    });
    const root = dialog.element;
    const input = root.querySelector<HTMLInputElement>("[data-act='dlg-docid']");
    const modelSel = root.querySelector<HTMLSelectElement>("[data-act='dlg-model']");
    const fillInput = root.querySelector<HTMLInputElement>("[data-act='dlg-fill']");
    const okBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-ok']");
    const status = root.querySelector<HTMLElement>("[data-act='dlg-status']");
    const showDlgStatus = (text: string, kind: "ok" | "err" | "muted") => {
        if (!status) return;
        status.textContent = text;
        status.className = `wengu-status wengu-status-${kind}`;
        status.removeAttribute("hidden");
    };
    root.querySelector("[data-act='dlg-cancel']")?.addEventListener("click", () => dialog.destroy());
    input?.focus();
    const run = async () => {
        const target = (input?.value ?? "").trim();
        if (!target || !okBtn) return;
        const modelId = modelSel?.value ?? "";
        const fill = fillInput?.checked ?? false;
        deps.saveChoice(modelId, fill);
        deps.setConverting(true);
        okBtn.disabled = true;
        showDlgStatus(t("converting"), "muted");
        try {
            const r = await convertDocToQuestions(target, t, modelId, fill);
            if (r.canConvert && r.docId) {
                // 内核 attributes 索引有数秒延迟：轮询等新文档进列表
                showDlgStatus(t("settling"), "muted");
                await waitForDocInList(r.docId, 15000);
                dialog.destroy();
                deps.onDone({docId: r.docId, title: r.title ?? "", count: r.count, message: r.message});
            } else {
                showDlgStatus(r.message || t("convertNoQuestions"), "err");
            }
        } catch (e) {
            showDlgStatus(String((e as Error)?.message ?? e), "err");
        } finally {
            deps.setConverting(false);
            okBtn.disabled = false;
        }
    };
    okBtn?.addEventListener("click", () => void run());
    input?.addEventListener("keydown", (ev) => {
        if ((ev as KeyboardEvent).key === "Enter") void run();
    });
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
