import { esc } from "./shared";

/**
 * 共享表单构件（规范见 docs/design-review.md）：
 * 1. 图标一律用思源内置 SVG symbol（svgIcon），禁止 emoji 字符；
 * 2. 全项目表单（设置页/开刷面板/转换弹窗）统一本文件的
 *    formGroup + formRow 行样式（标题说明在左、控件在右）。
 */

/** 思源内置图标（symbol id 需存在于主程序 stage，如 iconClock）。 */
export function svgIcon(id: string, cls = ""): string {
    return `<svg${cls ? ` class="${cls}"` : ""}><use xlink:href="#${id}"></use></svg>`;
}

/** 结果行状态图标：right=iconCheck / wrong=iconClose / partial=iconIndeterminateCheck。 */
export function statusIcon(status: "right" | "wrong" | "partial"): string {
    const id = status === "right" ? "iconCheck" : status === "wrong" ? "iconClose" : "iconIndeterminateCheck";
    return svgIcon(id, `wengu-status-icon wengu-status-${status}`);
}

/** 分组：标题 + 条目集合。 */
export function formGroup(title: string, rows: string): string {
    return `<div class="config-group">
  <div class="config-title">${esc(title)}</div>
  <div class="config-items">${rows}</div>
</div>`;
}

/** 行：标题+说明在左，控件在右（control 为已渲染的 HTML 片段；
 *  desc 空则不渲染说明行；echoAct 把说明行开放为动态回显槽
 *  ——选中值直接显示在 hint 里，清空还原原提示）。 */
export function formRow(title: string, desc = "", control: string, echoAct = ""): string {
    const hint =
        desc || echoAct
            ? `<div class="b3-label__text"${desc ? "" : " hidden"}${echoAct ? ` data-act="${echoAct}"` : ""}>${esc(
                  desc
              )}</div>`
            : "";
    return `<div class="fn__flex b3-label config__item">
  <div class="fn__flex-1 fn__flex-center">${esc(title)}
    ${hint}
  </div>
  <div class="fn__space"></div>
  ${control}
</div>`;
}

/** 下拉控件。 */
export function formSelect(field: string, options: string, act = "data-field"): string {
    return `<select class="b3-select fn__flex-center fn__size200" ${act}="${field}">${options}</select>`;
}

/** 开关控件。 */
export function formSwitch(field: string, checked: boolean, act = "data-field"): string {
    return `<input class="b3-switch fn__flex-center" type="checkbox" ${act}="${field}"${checked ? " checked" : ""}>`;
}

/** 文本/数字输入控件（attrs 透传 type/min/max/placeholder 等附加属性）。 */
export function formInput(field: string, value: string, attrs = "", act = "data-field"): string {
    return `<input class="b3-text-field fn__flex-center fn__size200" ${act}="${field}"${
        attrs ? ` ${attrs}` : ""
    } value="${esc(value)}">`;
}

/** 选项。 */
export function formOption(value: string, label: string, selected: boolean): string {
    return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
}
