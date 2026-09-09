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
