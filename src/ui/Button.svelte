<script lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLButtonAttributes } from "svelte/elements";

    export type ButtonVariant = "primary" | "success" | "error" | "outline" | "cancel" | "text" | "main" | "small";

    let buttonEl: HTMLButtonElement | undefined = $state();
    let actionApplied = false;

    let {
        children,
        buttonRef,
        action,
        variant = "primary",
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

<style>
    /* Button 组件自带的基础外观；颜色变体仍由全局样式按业务语义控制。 */
    .wengu-btn {
        padding: 4px 10px;
        border: 0;
        border-radius: 4px;
        background: var(--wengu-button-background, var(--b3-theme-primary-light));
        color: var(--wengu-button-color, var(--b3-theme-on-primary-light));
        cursor: pointer;
    }

    .wengu-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .wengu-btn-primary {
        --wengu-button-background: var(--b3-theme-primary-light);
        --wengu-button-color: var(--b3-theme-on-primary-light);
    }

    .wengu-btn-success {
        --wengu-button-background: var(--b3-theme-success);
        --wengu-button-color: var(--b3-theme-on-primary);
    }

    .wengu-btn-error {
        --wengu-button-background: var(--b3-theme-error);
        --wengu-button-color: var(--b3-theme-on-primary);
    }
</style>
