<script lang="ts">
    import { getContext } from "svelte";
    import { STATS_CTX, type OverviewExtra, type StatsCtx } from "../core/StatsUi";
    import type { WenguQuizStats } from "../StatsService";
    import { trendOption } from "../StatsCharts";
    import type { WenguDoc } from "../../types";
    import { svgIcon } from "../../ui/FormHtml";
    import { esc, fmt, mmss } from "../../ui/shared";
    import { echart } from "./echart";

    /** 总览页：数字卡 + 错题概况/薄弱 Top/错因分布 + 近 N 轮趋势 + 文档榜（行下钻）。 */
    let {
        model,
        docs,
        docId,
    }: { model: { stats: WenguQuizStats; extra: OverviewExtra }; docs: WenguDoc[]; docId: string } = $props();

    const { ctl, ui, t } = getContext<StatsCtx>(STATS_CTX)!;
    const s = $derived(model.stats);

    const weakCauseLabel = (cause: string): string => t(`weakCause${cause[0].toUpperCase()}${cause.slice(1)}`);
    const causeMax = $derived(Math.max(1, ...model.extra.causeDist.map((c) => c.n)));
</script>

<div class="wengu-stats">
    <div class="wengu-stats-row">
        <div class="wengu-stats-cell">
            <div class="wengu-stats-num">{s.rounds}</div>
            <div class="wengu-stats-label">{t("statsRounds")}</div>
        </div>
        <div class="wengu-stats-cell">
            <div class="wengu-stats-num">{s.answered}</div>
            <div class="wengu-stats-label">{t("statsAnswered")}</div>
        </div>
        <div class="wengu-stats-cell">
            <div class="wengu-stats-num">{Math.round(s.rate * 100)}%</div>
            <div class="wengu-stats-label">{t("statsAccuracy")}</div>
        </div>
    </div>
    <div class="wengu-stats-row">
        <div class="wengu-stats-cell">
            <div class="wengu-stats-num">{mmss(s.totalSec)}</div>
            <div class="wengu-stats-label">{t("statsTotalTime")}</div>
        </div>
        <div class="wengu-stats-cell">
            <div class="wengu-stats-num">{s.streak}</div>
            <div class="wengu-stats-label">{t("statsStreakN")}</div>
        </div>
    </div>

    <div class="wengu-stats-chart-title">{t("statsOverviewWrong")}</div>
    <div class="wengu-stats-row wengu-stats-wrong-over">
        <div class="wengu-stats-cell">
            <div class="wengu-stats-num">{model.extra.wrong?.pending ?? "—"}</div>
            <div class="wengu-stats-label">{t("reviewFilterPending")}</div>
        </div>
        <div class="wengu-stats-cell">
            <div class="wengu-stats-num">{model.extra.wrong?.mastered ?? "—"}</div>
            <div class="wengu-stats-label">{t("reviewFilterMastered")}</div>
        </div>
        <button class="b3-button b3-button--outline wengu-stats-enter-review" onclick={() => ctl.enterReview()}
            >{@html svgIcon("iconRight")} {t("statsEnterReview")}</button
        >
    </div>

    {#if model.extra.weakRows.length > 0}
        <div class="wengu-stats-chart-title">{t("statsWeakTop")}</div>
        <div class="wengu-weak-list">
            {#each model.extra.weakRows as r (r.title)}
                <div class="wengu-weak-row" title={r.title}>
                    <span class="wengu-weak-title">{r.title}</span>
                    <span class="wengu-meta">{fmt(t("weakStats"), { w: String(r.wrong), n: String(r.total) })}</span>
                    {#if r.topCause}
                        <span class="wengu-badge">{weakCauseLabel(r.topCause)}</span>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}

    {#if model.extra.causeDist.length > 0}
        <div class="wengu-stats-chart-title">{t("statsCauseDist")}</div>
        {#each model.extra.causeDist as c (c.cause)}
            <div class="wengu-stats-cause-row">
                <span class="wengu-stats-cause-label">{weakCauseLabel(c.cause)}</span>
                <span class="wengu-stats-cause-track"
                    ><span class="wengu-stats-cause-fill" style="width:{Math.round((c.n / causeMax) * 100)}%"
                    ></span></span
                >
                <span class="wengu-stats-cause-n">{c.n}</span>
            </div>
        {/each}
    {/if}

    {#if s.recent.length > 0}
        <div class="wengu-stats-chart-title">{t("statsRecentChart")}</div>
        <div class="wengu-stats-chart-box" use:echart={trendOption(s.recent, t)}></div>
    {:else}
        <div class="wengu-muted wengu-stats-empty">{t("statsEmpty")}</div>
    {/if}

    {#if docs.length > 0}
        <div class="wengu-stats-chart-title">{t("statsDocChart")}</div>
        <table class="wengu-stats-table">
            <thead>
                <tr>
                    <th>{t("statsColDoc")}</th>
                    <th>{t("statsColTotal")}</th>
                    <th>{t("statsColAttempted")}</th>
                    <th>{t("statsColRight")}</th>
                    <th>{t("statsColRate")}</th>
                    <th>{t("statsColTime")}</th>
                </tr>
            </thead>
            <tbody>
                {#each docs as d (d.id)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <tr
                        class="wengu-stats-doc-row{d.id === docId ? ' wengu-stats-doc-cur' : ''}"
                        title={esc(d.hPath || d.title || d.id)}
                        onclick={() => ctl.switchDoc(d.id)}
                    >
                        <td class="wengu-stats-doc-name">{d.title || d.id}</td>
                        <td>{d.total}</td>
                        <td>{d.attempted}</td>
                        <td>{d.rightCount}</td>
                        <td>{d.attempted > 0 ? `${Math.round((d.rightCount / d.attempted) * 100)}%` : "-"}</td>
                        <td>{mmss(d.totalTime)}</td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}
</div>
