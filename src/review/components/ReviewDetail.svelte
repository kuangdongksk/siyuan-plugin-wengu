<script lang="ts">
    import { getContext } from "svelte";
    import { REVIEW_CTX, type ReviewCtx, type ReviewItem } from "../core/ReviewUi";
    import { svgIcon } from "../../ui/FormHtml";
    import { renderMathIn } from "../../quiz/service/ProtyleHost";
    import { fmt, fmtDateTime } from "../../ui/shared";
    import { weakCauseLabelKey } from "../../bank/data/WeaknessStore";
    import Button from "../../ui/Button.svelte";

    /**
     * 单题回看详情（展开区内容）：元信息行（考点 · 最近错于 · 错次）+
     * 四段（题目/时间线/答案/解析）+ 动作行（复制/查看原文，后者无跳转
     * 目标时不渲染）。Issue #136 §5.4：壳从右栏换成行内展开区，类名与
     * 分节结构原样复用；元信息依据行头已表达的部分（题集名/日期/错次）
     * 不再重复，只留行头放不下的考点与错因。
     */
    let { it }: { it: ReviewItem } = $props();

    const { ctl, ui, t } = getContext<ReviewCtx>(REVIEW_CTX)!;

    // svelte-ignore non_reactive_update
    let inner: HTMLDivElement | undefined;

    const lastWrongAt = $derived(it.lastWrongAt);
    const metaItems = $derived(
        [
            it.knowledge ?? "",
            lastWrongAt ? fmt(t("reviewLastWrong"), { at: fmtDateTime(lastWrongAt) }) : "",
            it.attempts.length > 0
                ? fmt(t("reviewAttemptsN"), { n: String(it.attempts.length) })
                : fmt(t("statsWrongCount"), { n: String(it.wrongCount) }),
            it.cause ? t(weakCauseLabelKey(it.cause)) : "",
        ].filter(Boolean) as string[]
    );

    $effect(() => {
        if (ui.detail.phase === "ready" && inner) renderMathIn(inner);
    });
</script>

{#if ui.detail.phase === "loading" || !ui.detail.model}
    <div class="wengu-muted">{t("loading")}</div>
{:else}
    {@const d = ui.detail.model}
    <div class="wengu-review-detail-inner" bind:this={inner}>
        {#if metaItems.length > 0}
            <div class="wengu-review-open-meta">
                {#each metaItems as m (m)}
                    <span>{m}</span>
                {/each}
            </div>
        {/if}
        {#snippet sec(title: string, body: string, cls = "")}
            {#if body}
                <div class="wengu-review-sec{cls ? ` ${cls}` : ''}">
                    <div class="wengu-review-sec-title">{title}</div>
                    {@html body}
                </div>
            {/if}
        {/snippet}
        {@render sec(
            t("reviewSecQuestion"),
            `<div class="wengu-review-q">${d.stemHtml}</div>${d.optionsHtml}${d.stepsHtml}`
        )}
        {@render sec(t("reviewSecTimeline"), d.timelineHtml)}
        {@render sec(t("reviewSecAnswer"), d.answerHtml, "wengu-review-sec-answer")}
        {@render sec(t("reviewSecSolution"), d.solutionHtml)}
        <div class="wengu-review-detail-actions">
            <Button variant="outline" title={t("pvCopyTitle")} onclick={() => ctl.copyDetail()}
                >{@html svgIcon("iconCopy")} {t("pvCopyTitle")}</Button
            >
            {#if d.gotoId}
                <Button variant="outline" onclick={() => ctl.gotoBlock(d.gotoId!)}>
                    {@html svgIcon("iconRight")}
                    {t("pvOriginTitle")}
                </Button>
            {/if}
        </div>
    </div>
{/if}
