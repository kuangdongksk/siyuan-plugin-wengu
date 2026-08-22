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
import {
    todayKey,
    type WenguWordProgress,
} from "./WordStore";

/**
 * 起点设置面板（WordView 拆件，样式沿 FormHtml 规范）：
 * 选起始单元重置进度——该单元起的作答记录清零重学，之前的保留。
 */

/** 渲染面板 HTML（挂 WordView 的容器里）。 */
export function renderWordStart(
    t: (k: string) => string,
    p: WenguWordProgress,
): string {
    const cur = p.cursor > 0 ? p.cursor : 0;
    const curUnit = unitNumberOf(cur);
    const unitOptions = WORD_BOOK.units.map((u) =>
        formOption(String(u.u), fmt(t("wordUnitOpt"), {n: String(u.u), c: String(u.count)}), u.u === curUnit)
    ).join("");
    const hasProgress = p.cursor > 0 || Object.keys(p.words).length > 0;
    return `<div class="wengu-word">
  <div class="wengu-word-head">
    <span class="wengu-word-title">${esc(WORD_BOOK.title)}</span>
  </div>
  <div class="wengu-word-form">
    ${
        formGroup(
            t("wordSetStart"),
            formRow(t("wordStartUnit"), t("wordStartUnitDesc"), formSelect("unit", unitOptions)),
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

function unitNumberOf(idx: number): number {
    const u = WORD_BOOK.units.find((v) => idx >= v.start && idx < v.start + v.count);
    return u?.u ?? 1;
}
