<script lang="ts">
    import type { Snippet } from "svelte";

    /**
     * 表单行 Svelte 积木（逐类名复刻 FormHtml.formRow 的输出，规范见
     * docs/design-review.md §〇.2）：标题+说明在左，控件（children
     * snippet）在右。类名串与 base.scss 的 .b3-label.wengu-formrow
     * 特异性补丁是运行时主题对抗的一部分，禁改。
     */
    let { label, desc = "", children }: { label: string; desc?: string; children?: Snippet } = $props();
</script>

<div class="fn__flex b3-label config__item wengu-formrow">
    <div class="fn__flex-1 fn__flex-center">
        {label}
        {#if desc}
            <div class="b3-label__text">{desc}</div>
        {/if}
    </div>
    <div class="fn__space"></div>
    {@render children?.()}
</div>
