<script lang="ts">
    import { onMount, setContext } from "svelte";
    import type { ReviewViewAccess } from "../index";
    import { REVIEW_CTX, initialReviewUi } from "../core/ReviewUi";
    import { reviewCtl } from "../core/ReviewCtl";
    import { listReviewModel } from "../ReviewHtml";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import ReviewGroup from "./ReviewGroup.svelte";
    import ReviewDetail from "./ReviewDetail.svelte";

    /**
     * 错题本主区（四件套之一）：工具行（筛选/排序/概况/刷新）+ 左清单
     * 右详情两栏。类名与旧字符串模板逐字一致（样式在全局 review.scss）。
     * 控制器是模块级单例（外部域在视图外也要读写筛选/定位），attach/
     * detach 承接视图重挂——旧实现 rerenderListOnly 只重绘清单块的
     * 手法，现在筛选/排序变更天然走细粒度更新，下拉不重建。
     */
    let { v }: { v: ReviewViewAccess } = $props();

    // svelte-ignore state_referenced_locally
    const t = v.t;
    const ui = $state(initialReviewUi());
    setContext(REVIEW_CTX, { ctl: reviewCtl, ui, t });

    const m = $derived(listReviewModel(ui.items, ui.filter, ui.sort, ui.docFilter, (id) => reviewCtl.docTitleOf(id)));

    onMount(() => {
        reviewCtl.attach(ui, v);
        return () => reviewCtl.detach();
    });
</script>

<div class="wengu-review">
    <div class="wengu-review-tools">
        <select
            class="b3-select"
            title={t("reviewFilterTitle")}
            value={ui.filter}
            onchange={(e) => reviewCtl.setFilter(e.currentTarget.value as typeof ui.filter)}
        >
            <option value="all">{t("reviewFilterAll")}</option>
            <option value="pending">{t("reviewFilterPending")}</option>
            <option value="mastered">{t("reviewFilterMastered")}</option>
        </select>
        <select
            class="b3-select"
            title={t("reviewSortTitle")}
            value={ui.sort}
            onchange={(e) => reviewCtl.setSort(e.currentTarget.value as typeof ui.sort)}
        >
            <option value="recent">{t("reviewSortRecent")}</option>
            <option value="count">{t("reviewSortCount")}</option>
        </select>
        <span class="wengu-muted wengu-review-summary"
            >{fmt(t("reviewSummary"), {
                n: String(m.total),
                p: String(m.pending),
                m: String(m.mastered),
            })}</span
        >
        <button class="wengu-side-iconbtn" title={t("quizRefresh")} onclick={() => void reviewCtl.refresh(true)}
            >{@html svgIcon("iconRefresh")}</button
        >
    </div>
    <div class="wengu-review-cols">
        <div class="wengu-review-list">
            {#if m.groups.length === 0}
                <div class="wengu-muted wengu-review-empty">
                    {m.total === 0 ? t("reviewEmpty") : t("reviewFilterEmpty")}
                </div>
            {:else}
                {#each m.groups as g (g.docId)}
                    <ReviewGroup group={g} />
                {/each}
            {/if}
        </div>
        <div class="wengu-review-detail">
            <ReviewDetail />
        </div>
    </div>
</div>
