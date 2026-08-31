<script lang="ts">
    import { svgIcon } from "../../ui/FormHtml";
    import type { CardHtmlModel } from "../render/CardParts";
    import type { GroupUnitQ } from "../render/DrillUnits";
    import QuizCardApp from "./QuizCardApp.svelte";

    /**
     * 材料组单元（E1 分栏壳）：材料上栏（[data-mprotyle] 由静态管线填充）
     * + 组内题一次一题在下栏（所有题卡都渲染、非当前的 hidden，MaterialFlow
     * 切题时挪 hidden——.wengu-card 遍历语义保持）。DOM 与旧
     * renderOneUnitHtml 的组壳逐字一致，交互绑定仍在 MaterialFlow。
     */
    let {
        qs,
        mid,
        t,
        m,
    }: {
        qs: GroupUnitQ[];
        mid: string;
        t: (k: string) => string;
        m: CardHtmlModel;
    } = $props();
</script>

<div class="wengu-gunit" data-mid={mid}>
    <div class="wengu-ghead">
        <button class="wengu-gmat-fold" data-act="gmat-fold" title={t("materialToggle")}>
            {@html svgIcon("iconRight")}<span>{t("materialTitle")}</span>
        </button>
        <span class="wengu-gnav">
            <button class="wengu-gnav-btn" data-act="gq-prev" title={t("groupPrev")}>{@html svgIcon("iconLeft")}</button
            >
            <span class="wengu-gq-label" data-gq-label></span>
            <button class="wengu-gnav-btn" data-act="gq-next" title={t("groupNext")}
                >{@html svgIcon("iconRight")}</button
            >
        </span>
    </div>
    <div class="wengu-gmat" data-mprotyle><span class="wengu-muted">…</span></div>
    <div class="wengu-gqs">
        {#each qs as gq, i (gq.q.id)}
            <QuizCardApp q={gq.q} idx={gq.idx} {m} hidden={i > 0} />
        {/each}
    </div>
    <div class="wengu-gclues" data-clues hidden></div>
</div>
