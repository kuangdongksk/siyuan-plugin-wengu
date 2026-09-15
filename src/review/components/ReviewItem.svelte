<script lang="ts">
    import { getContext } from "svelte";
    import { REVIEW_CTX, type ReviewCtx } from "../core/ReviewUi";
    import type { ReviewItem as ReviewItemModel } from "../core/ReviewUi";
    import ReviewDetail from "./ReviewDetail.svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";

    /**
     * 清单条目（Issue #136 §5.3）：单列可展开行——行头五件套（日期 / 题集名 /
     * 题干 / 迷你星 / 错次胶囊），点击整行展开详情（`.wengu-review-item-open`
     * 包裹，内部 sec 结构与右栏时期逐字复用）。
     *
     * 展开态即选中态（ui.selQid）：详情装载是全局单选，展开第二行会自然收起
     * 前一行；再点当前行收起（选中清空 → Ctl 回 empty 态）。
     */
    let {
        it,
        aggregated,
        setName,
        setNameFull,
        date,
        dateTitle,
    }: {
        it: ReviewItemModel;
        aggregated: boolean;
        setName: string;
        setNameFull: string;
        date: string;
        dateTitle: string;
    } = $props();

    const { ctl, ui, t } = getContext<ReviewCtx>(REVIEW_CTX)!;

    const open = $derived(ui.selQid === it.qid);
    // 迷你星（§5.3 结构占位）：数据落点见差距清单 §7.b，未定前整体不出
    // ——不落空星排（那会谎报「评了 0 星」）。
    const stars = $derived<number[]>([]);

    const toggle = (): void => ctl.select(open ? "" : it.qid);
</script>

<div class="wengu-review-item{open ? ' open wengu-review-item-cur' : ''}">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="wengu-review-rowhead" onclick={toggle}>
        <span class="wengu-review-date" title={dateTitle || undefined}>{date}</span>
        {#if aggregated}
            <span class="wengu-review-set" title={setNameFull}>{setName}</span>
        {/if}
        <span class="wengu-review-item-stem" title={it.stemSummary}>{it.stemSummary}</span>
        {#if stars.length > 0}
            <span class="wengu-review-mini" title={fmt(t("reviewSelfStars"), { n: String(stars.length) })}>
                {#each Array(5) as _, i (i)}
                    <span class="wengu-review-mini-star{i < stars.length ? ' on' : ''}"
                        >{@html svgIcon("iconStar")}</span
                    >
                {/each}
            </span>
        {/if}
        <span class="wengu-review-count">{fmt(t("statsWrongCount"), { n: String(it.wrongCount) })}</span>
    </div>
    {#if open}
        <div class="wengu-review-item-open">
            <ReviewDetail {it} />
        </div>
    {/if}
</div>
