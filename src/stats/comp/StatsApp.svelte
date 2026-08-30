<script lang="ts">
    import { onMount, setContext } from "svelte";
    import { STATS_CTX, initialStatsUi } from "../core/StatsUi";
    import { statsCtl } from "../core/StatsCtl";
    import type { StatsPanelDeps } from "../index";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import StatsOverview from "./StatsOverview.svelte";
    import StatsDoc from "./StatsDoc.svelte";

    /**
     * 统计浮层根组件（四件套之一）：sticky 头（tab + 关闭）+ 内容区
     * （滚动）。类名与旧字符串模板逐字一致（样式在全局 stats.scss）；
     * 外壳 .wengu-stats-wrap 由挂载编排（index.ts）建宿主时挂——旧
     * StatsPanel.layer 同位。关闭动作经 props 注入（防组件→index 循环）。
     */
    let { deps, onClose }: { deps: StatsPanelDeps; onClose: () => void } = $props();

    // svelte-ignore state_referenced_locally
    const t = deps.t;
    const ui = $state(initialStatsUi());
    setContext(STATS_CTX, { ctl: statsCtl, ui, t });

    const docTabTitle = $derived.by(() => {
        const title = deps.docs.find((x) => x.id === deps.docId)?.title ?? "";
        const short = title.length > 12 ? `${title.slice(0, 12)}…` : title;
        return fmt(t("statsTabDoc"), { title: short || deps.docId });
    });

    onMount(() => {
        statsCtl.attach(ui, deps);
        return () => statsCtl.detach();
    });
</script>

<div class="wengu-stats-layer" data-stats-layer>
    <div class="wengu-stats-head">
        <span class="wengu-stats-title">{t("statsTitle")}</span>
        <span class="wengu-stats-tabs">
            <button
                class="b3-button b3-button--outline wengu-stats-tab{ui.tab === 'overview'
                    ? ' wengu-stats-tab-cur'
                    : ''}"
                onclick={() => statsCtl.setTab("overview")}>{t("statsTabOverview")}</button
            >
            {#if deps.docId}
                <button
                    class="b3-button b3-button--outline wengu-stats-tab{ui.tab === 'doc' ? ' wengu-stats-tab-cur' : ''}"
                    onclick={() => statsCtl.setTab("doc")}>{docTabTitle}</button
                >
            {/if}
        </span>
        <button class="wengu-side-iconbtn" title={t("statsClose")} onclick={onClose}
            >{@html svgIcon("iconClose")}</button
        >
    </div>
    <div class="wengu-stats-body" data-stats-body>
        {#if ui.phase === "loading"}
            <div class="wengu-muted">{t("loading")}</div>
        {:else if ui.tab === "overview" && ui.overview}
            <StatsOverview model={ui.overview} docs={deps.docs} docId={deps.docId} />
        {:else if ui.tab === "doc" && ui.doc}
            <StatsDoc model={ui.doc} />
        {/if}
    </div>
</div>
