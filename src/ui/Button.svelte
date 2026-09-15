<script lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLButtonAttributes } from "svelte/elements";

    /**
     * 按钮变体（规范 `docs/design-spec.md` §2.1）：**层级**与**修饰**两件事。
     *
     * ⚠️ `main` 已于整改 E #120 删除：`b3-button--main` **在思源样式表里不存在**
     * （官方 `_button.scss` 的变体表只有 progress/mid/big/text/cancel/outline/
     * remove/white/error/warning/info/success/pink/small/icon），`variant="main"`
     * 在桌面端产出**零命中的死类**、在移动端连基态主色都没有 ⇒ 观感落空。
     * 拼写统一为 `primary`（= 裸 `b3-button` 主色实底）。
     */
    export type ButtonVariant = "primary" | "success" | "error" | "outline" | "cancel" | "text" | "small";

    let buttonEl: HTMLButtonElement | undefined = $state();
    let actionApplied = false;

    let {
        children,
        buttonRef,
        action,
        // ⚠️ 默认值是**最不可能违规**的那一档（规范 §2.1）：primary 意味着
        // 「不写 variant 就拿到主色实底」，会让漏写的调用点静默破坏
        // 「一个面板至多一个 primary」。primary 必须显式声明。
        variant = "outline",
        color = "",
        class: className = "",
        style: styleAttr = "",
        ...attrs
    }: HTMLButtonAttributes & {
        children?: Snippet;
        buttonRef?: (button: HTMLButtonElement) => void;
        action?: (button: HTMLButtonElement) => void;
        variant?: ButtonVariant;
        color?: string;
    } = $props();

    const variantClass = $derived(
        variant === "primary"
            ? ""
            : variant === "success" || variant === "error"
              ? `wengu-btn-${variant}`
              : `b3-button--${variant}`
    );
    const buttonStyle = $derived(`${styleAttr}${color ? `--wengu-button-color: ${color};` : ""}`);

    $effect(() => {
        if (buttonEl && buttonRef) buttonRef(buttonEl);
        if (buttonEl && action && !actionApplied) {
            action(buttonEl);
            actionApplied = true;
        }
    });
</script>

<button
    bind:this={buttonEl}
    class={`b3-button ${className} ${variantClass}`}
    style={buttonStyle || undefined}
    {...attrs}
>
    {@render children?.()}
</button>
