<script lang="ts">
    import { getContext } from "svelte";
    import { REVIEW_CTX, type ReviewCtx } from "../core/ReviewUi";
    import { svgIcon } from "../../ui/FormHtml";
    import { renderMathIn } from "../../quiz/service/ProtyleHost";

    /**
     * 单题回看详情：三态（未选/装载中/就绪）+ 四段（题目/时间线/答案/
     * 解析）+ 动作行（复制/跳源块）。Lute 渲染的 html 串统一 {@html}
     * 桥接；数学渲染在就绪后对容器补一刀（旧实现 innerHTML 落位即调，
     * $effect 对齐同一时机）。
     */
    const { ctl, ui, t } = getContext<ReviewCtx>(REVIEW_CTX)!;

    // svelte-ignore non_reactive_update
    let inner: HTMLDivElement | undefined;

    $effect(() => {
        if (ui.detail.phase === "ready" && inner) renderMathIn(inner);
    });
</script>

{#if ui.detail.phase === "empty"}
    <div class="wengu-muted wengu-review-detail-empty">{t("reviewPickHint")}</div>
{:else if ui.detail.phase === "loading" || !ui.detail.model}
    <div class="wengu-muted">{t("loading")}</div>
{:else}
    {@const d = ui.detail.model}
    <div class="wengu-review-detail-inner" bind:this={inner}>
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
            <button class="b3-button b3-button--outline" title={t("pvCopyTitle")} onclick={() => ctl.copyDetail()}
                >{@html svgIcon("iconCopy")} {t("pvCopyTitle")}</button
            >
            <button class="b3-button b3-button--outline" onclick={() => ctl.gotoBlock(d.qid)}
                >{@html svgIcon("iconRight")} {t("reviewGotoBlock")}</button
            >
        </div>
    </div>
{/if}
