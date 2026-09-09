import { Dialog } from "siyuan";
import { esc } from "./shared";

/** 温故弹窗动作行按钮（b3-dialog__action 内）。 */
export interface WenguDialogAction {
    /** data-act 值（调用方按它绑事件）。 */
    id: string;
    label: string;
    /** outline=主操作描边风格；缺省=cancel 弱化风格。 */
    variant?: "outline";
    /** 预置禁用（如无源文档可选时禁「开始」）。 */
    disabled?: boolean;
}

/**
 * 温故弹窗骨架（bank/convert 十处 new Dialog 同构的公共底座）：content
 * 统一包 `b3-dialog__content wengu-dialog`（+extraCls），底部统一
 * `b3-dialog__action` 动作行（可不设）。Svelte 宿主壳（转换两弹窗/
 * 设置页）内容形态不同，不走这里。返回 root=dialog.element，调用方
 * 按 data-act 绑事件、拿 dialog 自行 destroy。
 */
export function openWenguDialog(opts: {
    title: string;
    /** 正文 HTML（content 壳内部、动作行之外的部分）。 */
    body: string;
    width?: string;
    /** content 根附加类（如 wengu-col-dialog）。 */
    extraCls?: string;
    /** 底部动作行按钮（不传=无动作行）。 */
    actions?: WenguDialogAction[];
}): { dialog: Dialog; root: HTMLElement; destroy: () => void } {
    const actions = opts.actions ?? [];
    const dialog = new Dialog({
        title: opts.title,
        width: opts.width ?? "560px",
        content: `<div class="b3-dialog__content wengu-dialog${opts.extraCls ? ` ${opts.extraCls}` : ""}">
      ${opts.body}
    </div>${
        actions.length > 0
            ? `<div class="b3-dialog__action">${actions
                  .map(
                      (a) =>
                          `<button class="b3-button ${
                              a.variant === "outline" ? "b3-button--outline" : "b3-button--cancel"
                          }" data-act="${esc(a.id)}"${a.disabled ? " disabled" : ""}>${esc(a.label)}</button>`
                  )
                  .join("")}</div>`
            : ""
    }`,
    });
    return { dialog, root: dialog.element, destroy: (): void => dialog.destroy() };
}
