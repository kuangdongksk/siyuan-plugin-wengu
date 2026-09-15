<script lang="ts">
    import { onMount, setContext } from "svelte";
    import type { ReviewViewAccess } from "../index";
    import { REVIEW_CTX, initialReviewUi } from "../core/ReviewUi";
    import { reviewCtl } from "../core/ReviewCtl";
    import { clearReviewQidFilter } from "../index";
    import { listReviewModel } from "../ReviewHtml";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import ReviewGroup from "./ReviewGroup.svelte";
    import Button from "../../ui/Button.svelte";
    import Select from "../../ui/Select.svelte";

    /**
     * 错题本主区（四件套之一）：筛选行（状态胶囊组 + 排序下拉 + 行尾概况 +
     * 刷新）+ 单列可展开清单（Issue #136 §5.1/§5.2，两栏 grid 退役）。
     * 详情从常驻右栏移入行内展开区，故本组件不再渲染 ReviewDetail；
     * 类名与旧字符串模板/样式的对应位置逐字保留（wengu-review-* 系）。
     * 控制器是模块级单例（外部域在视图外也要读写筛选/定位），attach/
     * detach 承接视图重挂。
     */
    let { v }: { v: ReviewViewAccess } = $props();

    // svelte-ignore state_referenced_locally
    const t = v.t;
    const ui = $state(initialReviewUi());
    setContext(REVIEW_CTX, { ctl: reviewCtl, ui, t });

    const m = $derived(
        listReviewModel(ui.items, ui.filter, ui.sort, ui.docFilter, (id) => reviewCtl.docTitleOf(id), ui.qidFilter)
    );
    // 相关题筛选徽标（Issue #44）：来自相关题弹窗「回顾」，一键取消回全部
    const qidFilterN = $derived(ui.qidFilter?.size ?? 0);
    const FILTERS = $derived([
        { value: "all", label: t("reviewFilterAll") },
        { value: "pending", label: t("reviewFilterPending") },
        { value: "mastered", label: t("reviewFilterMastered") },
    ] as const);

    onMount(() => {
        reviewCtl.attach(ui, v);
        return () => reviewCtl.detach();
    });
</script>

<div class="wengu-review">
    <div class="wengu-review-tools">
        <div class="wengu-review-fchips" role="group" aria-label={t("reviewFilterTitle")}>
            {#each FILTERS as f (f.value)}
                <button
                    type="button"
                    class="wengu-review-fchip{ui.filter === f.value ? ' on' : ''}"
                    title={t("reviewFilterTitle")}
                    aria-pressed={ui.filter === f.value}
                    onclick={() => reviewCtl.setFilter(f.value)}
                >
                    {f.label}
                </button>
            {/each}
        </div>
        <Select
            class="b3-select"
            options={[
                { value: "recent", label: t("reviewSortRecent") },
                { value: "count", label: t("reviewSortCount") },
            ]}
            title={t("reviewSortTitle")}
            value={ui.sort}
            onchange={(e) => reviewCtl.setSort(e.currentTarget.value as typeof ui.sort)}
        />
        {#if qidFilterN > 0}
            <span class="wengu-review-qidfilter" title={t("reviewQidFilterHint")}
                >{fmt(t("reviewQidFilterBadge"), { n: String(qidFilterN) })}
                <Button variant="text" class="wengu-review-qidfilter-x" onclick={() => clearReviewQidFilter()}
                    >{t("reviewQidFilterClear")}</Button
                ></span
            >
        {/if}
        <span class="wengu-muted wengu-review-summary"
            >{fmt(t("reviewSummary"), {
                n: String(m.total),
                p: String(m.pending),
                m: String(m.mastered),
            })}</span
        >
        <Button class="wengu-side-iconbtn" title={t("quizRefresh")} onclick={() => void reviewCtl.refresh(true)}
            >{@html svgIcon("iconRefresh")}</Button
        >
    </div>
    <div class="wengu-review-list">
        {#if m.groups.length === 0}
            <div class="wengu-muted wengu-review-empty">
                {m.total === 0 ? t("reviewEmpty") : t("reviewFilterEmpty")}
            </div>
        {:else}
            {#if !ui.selQid}
                <!-- §5.1：空态提示条只在「无选中」时出（展开区已有内容时不占位） -->
                <div class="wengu-review-detail-empty">{t("reviewPickHint")}</div>
            {/if}
            {#each m.groups as g (g.docId)}
                <ReviewGroup group={g} aggregated={m.aggregated} />
            {/each}
        {/if}
    </div>
</div>
