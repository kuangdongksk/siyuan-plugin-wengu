<script lang="ts">
    import { getContext, type Snippet } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import WORD_BOOK from "../WordBook";
    import type { WordView } from "../WordView";
    import { WORD_VIEW_CTX } from "../WordUi";

    let {
        stats = "",
        showHome = false,
        showSet = false,
        mid,
        extra,
    }: {
        stats?: string;
        showHome?: boolean;
        showSet?: boolean;
        /** 统计行之后、弹性空隙之前的插槽（如误认徽标）。 */
        mid?: Snippet;
        /** 弹性空隙之后的按钮组插槽（各屏自带）。 */
        extra?: Snippet;
    } = $props();
    const view = getContext<WordView>(WORD_VIEW_CTX)!;
    const t = view.t;
</script>

<div class="wengu-word-head">
    <span class="wengu-word-title">{WORD_BOOK.title}</span>
    {#if stats}<span class="wengu-word-stats">{stats}</span>{/if}
    {@render mid?.()}
    <span class="fn__flex-1"></span>
    {@render extra?.()}
    {#if showHome}
        <button class="b3-button b3-button--icon" title={t("wordBackHome")} onclick={() => view.goHome()}
            >{@html svgIcon("iconList")}</button
        >
    {/if}
    {#if showSet}
        <button class="b3-button b3-button--icon" title={t("wordSetStart")} onclick={() => view.setStart()}
            >{@html svgIcon("iconSettings")}</button
        >
    {/if}
</div>
