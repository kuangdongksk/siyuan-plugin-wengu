<script lang="ts">
    import { getContext } from "svelte";
    import { REVIEW_CTX, type ReviewCtx } from "../core/ReviewUi";
    import { rowDateOf, rowDateTitle, type ReviewGroupModel } from "../ReviewHtml";
    import { fmt } from "../../ui/shared";
    import ReviewItem from "./ReviewItem.svelte";
    import Button from "../../ui/Button.svelte";

    /**
     * 清单的一个文档分组：组头（分节标题 + 重刷本文档）+ 组内错题行。
     * 组头降为 12px 分节标题（Issue #136 §5.3）：它承载「重刷本文档」这个
     * 唯一入口，故只压层级不撤结构；行头是否出题集名列由 aggregated 定
     * （「全部」聚合视图才出，组内视图组头已表达归属 ⇒ 省掉）。
     */
    let { group, aggregated }: { group: ReviewGroupModel; aggregated: boolean } = $props();

    const { ctl, t } = getContext<ReviewCtx>(REVIEW_CTX)!;
    // 日期基准拍一次（整组同批渲染共用一个「当前年」，跨零点不回跳）
    const now = Date.now();
</script>

<div class="wengu-review-group">
    <div class="wengu-review-group-head">
        <span class="wengu-review-group-title" title={group.docTitleFull}>{group.docTitle}</span>
        <Button
            variant="outline"
            class="wengu-review-redrill"
            disabled={group.pending === 0}
            onclick={() => ctl.redrill(group.docId)}>{fmt(t("reviewRedrill"), { n: String(group.pending) })}</Button
        >
    </div>
    {#each group.items as it (it.qid)}
        <ReviewItem
            {it}
            {aggregated}
            setName={group.docTitle}
            setNameFull={group.docTitleFull}
            date={rowDateOf(it.lastWrongAt, now)}
            dateTitle={rowDateTitle(it.lastWrongAt)}
        />
    {/each}
</div>
