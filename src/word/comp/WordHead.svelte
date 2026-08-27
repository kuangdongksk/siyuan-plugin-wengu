<script lang="ts">
    import { getContext, type Snippet } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import type { WordView } from "../core/WordView";
    import { WORD_VIEW_CTX } from "../core/WordUi";

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

    /* ── 书名副位 = 切书选择器（redesign §四/§五；主标题固定「温故单词」，
       书名小字贴右侧，点击弹书单浮层——类名仿官方 b3-list 下拉） ── */
    let bookOpen = $state(false);
    let wrapEl: HTMLElement | undefined = $state();
    const books = $derived(view.ui.books);
    const closeOnOuter = (ev: MouseEvent): void => {
        if (!wrapEl?.contains(ev.target as Node)) bookOpen = false;
    };
</script>

<svelte:window onclick={bookOpen ? closeOnOuter : undefined} />

<div class="wengu-word-head">
    <span class="wengu-word-title">{t("wordAppTitle")}</span>
    <div class="wengu-word-bookpick" bind:this={wrapEl}>
        <button
            type="button"
            class="wengu-word-bookbtn"
            title={t("wordBookSwitch")}
            onclick={() => (bookOpen = !bookOpen)}
        >
            <span class="wengu-word-bookname">{view.ui.book.title}</span>
            <span class="wengu-word-bookcaret">{@html svgIcon("iconDown")}</span>
        </button>
        {#if bookOpen}
            <div class="b3-list--background wengu-word-bookmenu" role="menu">
                {#each books as b (b.id)}
                    <button
                        type="button"
                        class="b3-list-item b3-list-item--narrow"
                        class:b3-list-item--focus={b.id === view.ui.book.id}
                        role="menuitem"
                        onclick={() => {
                            bookOpen = false;
                            view.switchBook(b.id);
                        }}
                    >
                        <span class="wengu-word-bookname">{b.name}</span>
                        <span class="wengu-word-bookcount">{b.count}</span>
                    </button>
                {/each}
            </div>
        {/if}
    </div>
    {#if stats}<span class="wengu-word-stats">{stats}</span>{/if}
    {@render mid?.()}
    <span class="fn__flex-1"></span>
    {@render extra?.()}
    {#if showHome}
        <button class="wengu-iconbtn" title={t("wordBackHome")} onclick={() => view.goHome()}
            >{@html svgIcon("iconList")}</button
        >
    {/if}
    {#if showSet}
        <button class="wengu-iconbtn" title={t("wordSetStart")} onclick={() => view.setStart()}
            >{@html svgIcon("iconSettings")}</button
        >
    {/if}
</div>
