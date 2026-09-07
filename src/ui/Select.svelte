<script lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLSelectAttributes } from "svelte/elements";

    export type SelectOption = {
        value: string;
        label: string;
        disabled?: boolean;
    };

    let {
        options = [],
        children,
        class: className = "b3-select",
        ...attrs
    }: HTMLSelectAttributes & { options?: readonly SelectOption[]; children?: Snippet } = $props();
</script>

<select class={className} {...attrs}>
    {#if options.length > 0}
        {#each options as option (option.value)}
            <option value={option.value} disabled={option.disabled}>{option.label}</option>
        {/each}
    {:else}
        {@render children?.()}
    {/if}
</select>