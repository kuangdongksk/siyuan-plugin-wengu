import {
    formGroup,
    formOption,
    formRow,
    formSelect,
} from "./FormHtml";
import {
    esc,
    fmt,
} from "./ui";
import WORD_BOOK from "./WordBook";
import {runWordImport} from "./WordImport";
import {
    todayKey,
    groupSizeOf,
    type WenguWordProgress,
} from "./WordStore";

/**
 * 起点设置面板（WordView 拆件，样式沿 FormHtml 规范）：
 * 选起始单元重置进度——该单元起的作答记录清零重学，之前的保留。
 */

/** 渲染面板 HTML（挂 WordView 的容器里；importMsg=导入结果行）。 */
export function renderWordStart(
    t: (k: string) => string,
    p: WenguWordProgress,
    importMsg = "",
): string {
    const cur = p.cursor > 0 ? p.cursor : 0;
    const curUnit = unitNumberOf(cur);
    const unitOptions = WORD_BOOK.units.map((u) =>
        formOption(String(u.u), fmt(t("wordUnitOpt"), {n: String(u.u), c: String(u.count)}), u.u === curUnit)
    ).join("");
    const gs = groupSizeOf(p);
    const groupOptions = [5, 10, 15, 20].map(n =>
        formOption(String(n), fmt(t("wordGroupOpt"), {n: String(n)}), n === gs)
    ).join("");
    const hasProgress = p.cursor > 0 || Object.keys(p.words).length > 0;
    const statusOptions = formOption("auto", t("wordImportAuto"), true) +
        formOption("unlearned", t("wordImportUnlearned"), false) +
        formOption("reviewing", t("wordImportReviewing"), false) +
        formOption("done", t("wordImportDone"), false) +
        formOption("familiar", t("wordImportFamiliar"), false);
    return `<div class="wengu-word">
  <div class="wengu-word-head">
    <span class="wengu-word-title">${esc(WORD_BOOK.title)}</span>
  </div>
  <div class="wengu-word-form">
    ${
        formGroup(
            t("wordSetStart"),
            formRow(t("wordStartUnit"), t("wordStartUnitDesc"), formSelect("unit", unitOptions)) +
                // 组大小独立即时生效（change 走 setgroupsize），不随「开始背」重置
                formRow(t("wordGroupSize"), t("wordGroupSizeDesc"), formSelect("groupsize", groupOptions)),
        )
    }
    <div class="wengu-word-form-tip">${esc(t("wordResetWarn"))}</div>
    <div class="wengu-word-form-actions">
      ${
        hasProgress ?
            `<button class="b3-button b3-button--cancel" data-act="cancelset">${esc(t("cancel"))}</button>` :
            ""
    }
      <button class="b3-button b3-button--outline" data-act="applystart">${esc(t("wordApply"))}</button>
    </div>
    ${
        formGroup(
            t("wordImportTitle"),
            formRow(t("wordImportStatus"), t("wordImportStatusDesc"), formSelect("importstatus", statusOptions)) +
                formRow(
                    t("wordImportFile"),
                    t("wordImportFileDesc"),
                    '<input type="file" accept=".pdf,.txt,.csv" data-field="importfile" class="b3-file fn__flex-center">',
                ),
        )
    }
    <div class="wengu-word-form-tip">${esc(t("wordImportHint"))}</div>
    ${importMsg ? `<div class="wengu-word-aimsg">${esc(importMsg)}</div>` : ""}
  </div>
</div>`;
}

/** 读取面板选择并落到进度（cursor/清词/今日统计），返回是否生效。 */
export function applyWordStart(el: HTMLElement, p: WenguWordProgress): boolean {
    const unitSel = el.querySelector<HTMLSelectElement>('[data-field="unit"]');
    const unitNo = parseInt(unitSel?.value ?? "1", 10);
    const unit = WORD_BOOK.units.find((u) => u.u === unitNo);
    if (!unit) return false;
    p.cursor = unit.start;
    for (const key of Object.keys(p.words)) {
        if (Number(key) >= unit.start) delete p.words[key];
    }
    p.today = {key: todayKey(), newCount: 0, revCount: 0};
    return true;
}

/** 起点面板控制器：应用/取消 + 进度导入（PDF/txt）。 */
export class WordStartCtl {
    /** 最近一次导入结果文案（渲染在面板底部）。 */
    msg = "";

    constructor(
        private readonly el: HTMLElement,
        private readonly t: (k: string) => string,
        private readonly getProgress: () => WenguWordProgress,
        private readonly save: (p: WenguWordProgress) => Promise<unknown>,
        private readonly refresh: () => void,
    ) {}

    apply(): void {
        const p = this.getProgress();
        if (applyWordStart(this.el, p)) void this.save(p);
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
            this.msg = r.error === "noTextLayer" ?
                this.t("wordImportNoText") :
                r.error === "noMatch" ?
                this.t("wordImportNoMatch") :
                this.t("wordImportResult")
                    .replace("{a}", String(r.hit))
                    .replace("{b}", String(r.miss)) +
                (r.missSample.length > 0 ? `（${r.missSample.join(", ")}）` : "");
        } catch (e) {
            this.msg = this.t("wordImportFailed") + String((e as Error)?.message ?? e).slice(0, 80);
        }
        input.value = "";
        this.refresh();
    }
}

function unitNumberOf(idx: number): number {
    const u = WORD_BOOK.units.find((v) => idx >= v.start && idx < v.start + v.count);
    return u?.u ?? 1;
}
