<script lang="ts">
    import { getContext } from "svelte";
    import { REVIEW_CTX, type ReviewCtx } from "../core/ReviewUi";
    import type { ReviewGroupModel, ReviewItemModel } from "../ReviewHtml";
    import { fmt, fmtDateTime } from "../../ui/shared";

    /** 清单的一个文档分组：组头（标题 + 重刷本文档）+ 错题条目。 */
    let { group }: { group: ReviewGroupModel } = $props();

    const { ctl, ui, t } = getContext<ReviewCtx>(REVIEW_CTX)!;

    const metaOf = (it: ReviewItemModel): string =>
        [
            it.knowledge ?? "",
            fmt(t("statsWrongCount"), { n: String(it.wrongCount) }),
            it.lastWrongAt ? fmtDateTime(it.lastWrongAt) : "",
        ]
            .filter(Boolean)
            .join(" · ");
</script>

<div class="wengu-review-group">
    <div class="wengu-review-group-head">
        <span class="wengu-review-group-title" title={group.docTitle}>{group.docTitle}</span>
        <button
            class="b3-button b3-button--outline wengu-review-redrill"
            disabled={group.pending === 0}
            onclick={() => ctl.redrill(group.docId)}>{fmt(t("reviewRedrill"), { n: String(group.pending) })}</button
        >
    </div>
    {#each group.items as it (it.qid)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="wengu-review-item{ui.selQid === it.qid ? ' wengu-review-item-cur' : ''}"
            onclick={() => ctl.select(it.qid)}
        >
            <div class="wengu-review-item-stem" title={it.stemSummary}>{it.stemSummary}</div>
            <div class="wengu-review-item-meta">{metaOf(it)}</div>
            <div class="wengu-review-item-tags">
                {#if it.mastered}
                    <span class="wengu-review-badge wengu-review-badge-mastered">{t("reviewFilterMastered")}</span>
                {:else}
                    <span class="wengu-review-badge wengu-review-badge-pending">{t("reviewFilterPending")}</span>
                {/if}
                {#if it.cause}
                    <span class="wengu-review-cause"
                        >{t(`weakCause${it.cause[0].toUpperCase()}${it.cause.slice(1)}`)}</span
                    >
                {/if}
            </div>
        </div>
    {/each}
</div>
