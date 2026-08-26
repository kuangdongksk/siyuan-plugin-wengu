import { modelOptionsHtml } from "./AgentClient";
import type { ConvertDialogDeps } from "./ConvertDialog";
import { formGroup, formInput, formOption, formRow, formSelect, formSwitch, svgIcon } from "../ui/FormHtml";
import { esc, fmt } from "../ui/shared";

/**
 * 转换弹窗的表单标记（从 ConvertDialog 拆出保 ≤500 行）：
 * 常显 AI 模型/源文档/转换模式/PDF 导入；其余收进「更多选项」
 * details 折叠区控制常驻高度（知识点行带「选择…」打开文档勾选器）。
 */
export function convertDialogHtml(deps: ConvertDialogDeps): string {
    const { t } = deps;
    return `<div class="b3-dialog__content wengu-dialog wengu-convert-dialog">
      <div class="wengu-muted">${esc(t("convertDialogHint"))}</div>

      ${formGroup(
          t("convertBtn"),
          formRow(
              t("modelLabel"),
              t("setModelHint"),
              formSelect("dlg-model", modelOptionsHtml(deps.initialModelId), "data-act")
          ) +
              formRow(
                  t("docIdLabel"),
                  "",
                  `<input type="text" data-act="dlg-docid" value="${esc(deps.activeDocId)}" hidden>` +
                      `<button class="b3-button b3-button--outline" data-act="dlg-docpick">${esc(
                          t("knowPickBtn")
                      )}</button>`,
                  "dlg-doc-echo"
              ) +
              formRow(
                  t("convertModeLabel"),
                  t("convertModeHint"),
                  formSelect(
                      "dlg-wmode",
                      formOption("inplace", t("convertModeInplace"), true) +
                          formOption("newdoc", t("convertModeNewdoc"), false),
                      "data-act"
                  )
              ) +
              formRow(
                  t("pdfImportLabel"),
                  t("pdfImportHint"),
                  `<button class="b3-button b3-button--outline" data-act="dlg-pdf">${svgIcon("iconUpload")} ${esc(
                      t("pdfImportBtn")
                  )}</button>` + '<input type="file" accept="application/pdf" data-act="dlg-pdffile" hidden>'
              ) +
              `<details class="wengu-convert-more"><summary>${esc(t("convertMore"))}</summary>` +
              formRow(
                  t("fillToChoice"),
                  t("fillToChoiceHint"),
                  formSwitch("dlg-fill", deps.initialFillToChoice, "data-act")
              ) +
              formRow(
                  t("bigToSteps"),
                  t("bigToStepsHint"),
                  formSwitch("dlg-steps", deps.initialBigToSteps, "data-act")
              ) +
              formRow(
                  t("convertParallelLabel"),
                  t("convertParallelHint"),
                  formSelect(
                      "dlg-parallel",
                      formOption("1", t("convertParallel1"), deps.initialParallel <= 1) +
                          formOption("2", fmt(t("convertParallelN"), { n: "2" }), deps.initialParallel === 2) +
                          formOption("3", fmt(t("convertParallelN"), { n: "3" }), deps.initialParallel === 3) +
                          formOption("4", fmt(t("convertParallelN"), { n: "4" }), deps.initialParallel === 4),
                      "data-act"
                  )
              ) +
              '<div data-act="dlg-target-rows">' +
              formRow(
                  t("convertTarget"),
                  t("convertTargetHint"),
                  formSelect(
                      "dlg-target",
                      formOption("same", t("convertTargetSame"), deps.initialTargetMode !== "custom") +
                          formOption("custom", t("convertTargetCustom"), deps.initialTargetMode === "custom"),
                      "data-act"
                  )
              ) +
              formRow(
                  t("convertTargetDoc"),
                  t("convertTargetDocHint"),
                  formInput(
                      "dlg-targetid",
                      deps.initialTargetId,
                      `spellcheck="false" placeholder="${esc(t("docIdPlaceholder"))}"`,
                      "data-act"
                  ) +
                      `<button class="b3-button b3-button--outline" data-act="dlg-targetpick">${esc(
                          t("knowPickBtn")
                      )}</button>`,
                  "dlg-target-echo"
              ) +
              "</div>" +
              formRow(
                  t("convertKnowLabel"),
                  "",
                  '<input type="text" data-act="dlg-know" hidden>' +
                      `<button class="b3-button b3-button--outline" data-act="dlg-knowpick">${esc(
                          t("knowPickBtn")
                      )}</button>`,
                  "dlg-know-echo"
              ) +
              "</details>"
      )}

      <div class="wengu-status" data-act="dlg-status" hidden></div>
      <div data-act="dlg-resume-row" hidden>
        <button class="b3-button b3-button--text" data-act="dlg-resume">${esc(t("convertResumeBtn"))}</button>
      </div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="dlg-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--outline" data-act="dlg-stop" hidden>${esc(t("convertStop"))}</button>
      <button class="b3-button b3-button--outline" data-act="dlg-ok">${esc(t("convertStart"))}</button>
    </div>`;
}
