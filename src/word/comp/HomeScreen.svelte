<script lang="ts">
    import { getContext } from "svelte";
    import { fmt } from "../../ui/shared";
    import { buildQueue, starredList } from "../core/WordStore";
    import type { WordView } from "../core/WordView";
    import { WORD_VIEW_CTX } from "../core/WordUi";
    import AiMsg from "./AiMsg.svelte";
    import NavExtras from "./NavExtras.svelte";
    import WordHead from "./WordHead.svelte";

    /** 每日首页（到期复习/新学/星标入口）与「先复习」确认层。 */
    const view = getContext<WordView>(WORD_VIEW_CTX)!;
    const ui = view.ui;
    const t = view.t;
    const p = $derived(ui.progress!);
    const queues = $derived(buildQueue(p));
    const starN = $derived(starredList(p).length);
    const empty = $derived(queues.review.length === 0 && queues.fresh.length === 0 && starN === 0);
</script>

<div class="wengu-word">
    <WordHead showSet>
        {#snippet extra()}
            <NavExtras />
        {/snippet}
    </WordHead>
    <AiMsg />
    {#if ui.mode === "askreview"}
        <div class="wengu-word-card wengu-word-revealed">
            <div class="wengu-word-zh">{fmt(t("wordAskReview"), { n: String(queues.review.length) })}</div>
            <div class="wengu-word-actions">
                <button class="b3-button b3-button--outline" onclick={() => view.goReview()}>{t("wordGoReview")}</button
                >
                <button class="b3-button b3-button--cancel" onclick={() => view.goFreshAnyway()}
                    >{t("wordStillFresh")}</button
                >
            </div>
        </div>
    {:else}
        <div class="wengu-word-entries">
            {#if queues.review.length > 0}
                <button class="wengu-word-entry" onclick={() => view.goReview()}>
                    <span class="wengu-word-entry-title">{t("wordHomeReviewTitle")}</span>
                    <span class="wengu-word-entry-count"
                        >{fmt(t("wordHomeReviewCount"), { n: String(queues.review.length) })}</span
                    >
                </button>
            {/if}
            {#if queues.fresh.length > 0}
                <button class="wengu-word-entry" onclick={() => view.goFresh()}>
                    <span class="wengu-word-entry-title">{t("wordHomeFreshTitle")}</span>
                    <span class="wengu-word-entry-count"
                        >{fmt(t("wordHomeFreshCount"), { n: String(queues.fresh.length) })}</span
                    >
                </button>
            {/if}
            {#if starN > 0}
                <button class="wengu-word-entry wengu-word-entry-star" onclick={() => view.goStar()}>
                    <span class="wengu-word-entry-title">{t("wordHomeStarTitle")}</span>
                    <span class="wengu-word-entry-count">{fmt(t("wordHomeStarCount"), { n: String(starN) })}</span>
                </button>
            {/if}
            {#if empty}
                <div class="wengu-word-entry wengu-word-entry-muted">{t("wordBookDone")}</div>
            {/if}
        </div>
    {/if}
</div>
