import { Dialog } from "siyuan";
import { esc } from "./shared";
import { svgIcon } from "./FormHtml";

/**
 * 温故弹窗动作行按钮（b3-dialog__action 内）。**变体与
 * `ui/Button.svelte` 的 `ButtonVariant` 同源**（规范 §2.1 / §5.4）：
 * 层级 `primary` 裸 `b3-button`（主色实底）/ `outline` 描边 / `text` 幽灵 /
 * `cancel` 取消；缺省 `cancel`——**最不可能违规**的那一档（同 Button 的
 * 默认值口径：primary 必须显式声明，否则漏写就静默破坏「一个弹窗至多
 * 一个主操作」）。`success` / `error` 是自绘语义色类，弹窗动作行不用。
 *
 * ⚠️ **位序即语义**：右起第一钮 = 唯一主操作（§2.2）——调用方按「次钮在
 * 前、主钮在后」的书写序传数组。
 */
export interface WenguDialogAction {
    /** data-act 值（调用方按它绑事件）。 */
    id: string;
    label: string;
    /** 见上；缺省 `cancel`。 */
    variant?: "primary" | "outline" | "text" | "cancel";
    /** 预置禁用（如无源文档可选时禁「开始」）。 */
    disabled?: boolean;
}

/** Svelte 宿主壳（`ConvertDialogApp` 等）手写类名串的同源常量（§5.1
 *  的已知重复）：`openWenguDialog` 与手写壳都从这里取，避免两处漂移。 */
export const wenguDialogCls = "b3-dialog__content wengu-dialog";

/** 动作变体 → 类名（primary=裸 `b3-button`，与 §2.1 逐字一致）。 */
export function actionClsOf(variant: WenguDialogAction["variant"]): string {
    return variant === "primary"
        ? "b3-button"
        : variant === "outline" || variant === "text"
          ? `b3-button b3-button--${variant}`
          : "b3-button b3-button--cancel";
}

/** 弹窗图标位（稿 §5「38×38 primary-lightest 底圆角 10，内 18px 图标」）：
 *  b3-dialog 无图标位，需自绘——但只作**内容区首件**，外壳仍走 b3-dialog
 *  体系（**不自绘 veil/modal**，稿的遮罩仅示意外壳气质）。id 必须来自
 *  sprite 白名单（§6.2）。 */
export function dialogIconHtml(id: string): string {
    return `<div class="wengu-dialog-ico" aria-hidden="true">${svgIcon(id)}</div>`;
}

/**
 * 温故弹窗骨架（bank/convert 十二处 new Dialog 同构的公共底座）：content
 * 统一包 `b3-dialog__content wengu-dialog`（+extraCls），底部统一
 * `b3-dialog__action` 动作行（可不设）。Svelte 宿主壳（转换两弹窗/
 * 设置页）内容形态不同，不走这里。返回 root=dialog.element，调用方
 * 按 data-act 绑事件、拿 dialog 自行 destroy。
 */
export function openWenguDialog(opts: {
    title: string;
    /** 正文 HTML（content 壳内部、动作行之外的部分）。 */
    body: string;
    /** 宽度：档位 `sm`/`md`/`lg` 映射到 480/560/680 三档，且一律收进
     *  `min(档位, calc(100vw - 32px))` 防小屏顶满（规范 §5.1）；也可直接
     *  传 `min(...)` 表达式或旧式裸 px（存量调用点兼容）。 */
    width?: string;
    /** content 根附加类（如 `wengu-switch-confirm`）。 */
    extraCls?: string;
    /** 底部动作行按钮（不传=无动作行）。 */
    actions?: WenguDialogAction[];
    /** 关右上角关闭钮（缺省出；拦截类弹窗仍需 Esc/遮罩的显式口径）。 */
    hideCloseIcon?: boolean;
    /** 被点击的层（宿主默认 `window`）。 */
    target?: HTMLElement | null;
}): { dialog: Dialog; root: HTMLElement; destroy: () => void } {
    const actions = opts.actions ?? [];
    const dialog = new Dialog({
        title: opts.title,
        width: dialogWidth(opts.width),
        content: `<div class="${wenguDialogCls}${opts.extraCls ? ` ${opts.extraCls}` : ""}">
      ${opts.body}
    </div>${
        actions.length > 0
            ? `<div class="b3-dialog__action">${actions
                  .map(
                      (a) =>
                          `<button type="button" class="${actionClsOf(a.variant)}" data-act="${esc(a.id)}"${
                              a.disabled ? " disabled" : ""
                          }>${esc(a.label)}</button>`
                  )
                  .join("")}</div>`
            : ""
    }`,
        hideCloseIcon: opts.hideCloseIcon ?? false,
        ...(opts.target !== undefined ? { target: opts.target } : {}),
    });
    return { dialog, root: dialog.element, destroy: (): void => dialog.destroy() };
}

/** 宽度收敛（§5.1 三档）：档名走 `min(档位, calc(100vw - 32px))`；裸 px
 *  与自写表达式原样透传（存量调用点逐字不变）。 */
const WIDTH_TIERS: Record<string, string> = { sm: "480px", md: "560px", lg: "680px" };

export function dialogWidth(width?: string): string {
    const tier = WIDTH_TIERS[width ?? "md"];
    if (tier) return `min(${tier}, calc(100vw - 32px))`;
    return width ?? WIDTH_TIERS.md;
}
