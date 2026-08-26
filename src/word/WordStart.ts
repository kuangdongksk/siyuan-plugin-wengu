import { formGroup, formOption, formRow, formSelect } from "../ui/FormHtml";
import { esc, fmt } from "../ui/shared";
import WORD_BOOK from "./WordBook";
import { runWordImport } from "./WordImport";
import { groupSizeOf, type WenguWordProgress } from "./WordStore";

/**
 * 背单词设置面板（WordView 拆件，样式沿 FormHtml 规范）：
 * 每组单词数 + 不背单词进度导入。无手动起点——未导入时从词书
 * 第一个词开始；导入后按进度来（cursor 自动对齐书序第一个未学词，
 * 未学的新学、学过的到期复习、标熟的不再出现）。
 */

/** 渲染面板 HTML（挂 WordView 的容器里；importMsg=导入结果行）。 */
export function renderWordStart(t: (k: string) => string, p: WenguWordProgress, importMsg = ""): string {
    const gs = groupSizeOf(p);
    const groupOptions = [5, 10, 15, 20]
        .map((n) => formOption(String(n), fmt(t("wordGroupOpt"), { n: String(n) }), n === gs))
        .join("");
    const hasProgress = p.cursor > 0 || Object.keys(p.words).length > 0;
    const statusOptions =
        formOption("auto", t("wordImportAuto"), true) +
        formOption("unlearned", t("wordImportUnlearned"), false) +
        formOption("reviewing", t("wordImportReviewing"), false) +
        formOption("done", t("wordImportDone"), false) +
        formOption("familiar", t("wordImportFamiliar"), false);
    return `<div class="wengu-word">
  <div class="wengu-word-head">
    <span class="wengu-word-title">${esc(WORD_BOOK.title)}</span>
  </div>
  <div class="wengu-word-form">
    ${formGroup(
        t("wordSetStart"),
        // 组大小独立即时生效（change 走 setgroupsize）
        formRow(t("wordGroupSize"), t("wordGroupSizeDesc"), formSelect("groupsize", groupOptions))
    )}
    <div class="wengu-word-form-actions">
      ${
          hasProgress
              ? `<button class="b3-button b3-button--cancel" data-act="cancelset">${esc(t("cancel"))}</button>`
              : ""
      }
      <button class="b3-button b3-button--outline" data-act="applystart">${esc(t("wordApply"))}</button>
    </div>
    ${formGroup(
        t("wordImportTitle"),
        formRow(t("wordImportStatus"), t("wordImportStatusDesc"), formSelect("importstatus", statusOptions)) +
            formRow(
                t("wordImportFile"),
                t("wordImportFileDesc"),
                '<input type="file" accept=".pdf,.txt,.csv" data-field="importfile" class="b3-file fn__flex-center">'
            )
    )}
    <div class="wengu-word-form-tip">${esc(t("wordImportHint"))}</div>
    ${importMsg ? `<div class="wengu-word-aimsg">${esc(importMsg)}</div>` : ""}
  </div>
</div>`;
}

/** 起点面板控制器：进入背词 + 进度导入（PDF/txt）。 */
export class WordStartCtl {
    /** 最近一次导入结果文案（渲染在面板底部）。 */
    msg = "";

    constructor(
        private readonly el: HTMLElement,
        private readonly t: (k: string) => string,
        private readonly getProgress: () => WenguWordProgress,
        private readonly save: (p: WenguWordProgress) => Promise<unknown>,
        private readonly refresh: () => void
    ) {}

    apply(): void {
        // 无手动起点：不重置任何数据，「开始背」= 进入背词
        this.refresh();
    }

    async importFile(file: File, input: HTMLInputElement): Promise<void> {
        const p = this.getProgress();
        const sel = this.el.querySelector<HTMLSelectElement>('[data-field="importstatus"]');
        const status = (sel?.value ?? "auto") as Parameters<typeof runWordImport>[1];
        this.msg = this.t("wordImportRunning");
        this.refresh();
        try {
            const r = await runWordImport(file, status, p);
            await this.save(p);
            this.msg =
                r.error === "noTextLayer"
                    ? this.t("wordImportNoText")
                    : r.error === "noMatch"
                      ? this.t("wordImportNoMatch")
                      : this.t("wordImportResult").replace("{a}", String(r.hit)).replace("{b}", String(r.miss)) +
                        (r.missSample.length > 0 ? `（${r.missSample.join(", ")}）` : "");
        } catch (e) {
            this.msg = this.t("wordImportFailed") + String((e as Error)?.message ?? e).slice(0, 80);
        }
        input.value = "";
        this.refresh();
    }
}
