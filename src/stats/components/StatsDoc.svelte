<script lang="ts">
    import { getContext } from "svelte";
    import { STATS_CTX, type StatsCtx } from "../core/StatsUi";
    import { modeLabel, type WenguDocStats } from "../StatsService";
    import { roundsOption } from "../StatsCharts";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt, mmss } from "../../ui/shared";
    import { echart } from "./echart";

    /** 详情页：轮次趋势图 + 逐轮评分记录 + 错题清单 + AI 学习建议。 */
    let { model }: { model: WenguDocStats } = $props();

    const { ctl, t } = getContext<StatsCtx>(STATS_CTX)!;

    const dateLabel = (ts: number): string => {
        const d = new Date(ts);
        const p = (n: number) => String(n).padStart(2, "0");
        return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };

    // AI 建议的按钮与输出容器（agentPanel 命令式操作 DOM，bind 引用直传）
    // svelte-ignore non_reactive_update
    let aiBtn: HTMLButtonElement | undefined;
    // svelte-ignore non_reactive_update
    let aiOut: HTMLDivElement | undefined;
</script>

<div class="wengu-stats">
    <div class="wengu-stats-sub">{fmt(t("statsDocHead"), { title: model.docTitle, n: String(model.total) })}</div>
    {#if model.rounds.length > 0}
        <div class="wengu-stats-chart-box" use:echart={roundsOption(model.rounds, t)}></div>
        <div class="wengu-stats-chart-title">{t("statsRoundList")}</div>
        <table class="wengu-stats-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>{t("statsRoundColDate")}</th>
                    <th>{t("statsRoundColMode")}</th>
                    <th>{t("statsRoundColScore")}</th>
                    <th>{t("statsColRate")}</th>
                    <th>{t("statsColTime")}</th>
                </tr>
            </thead>
            <tbody>
                {#each model.rounds as r, i}
                    <tr>
                        <td>{fmt(t("statsRoundN"), { n: String(i + 1) })}</td>
                        <td>{dateLabel(r.startedAt)}</td>
                        <td>{modeLabel(r.mode)}</td>
                        <td>{r.correct}/{r.answered}</td>
                        <td>{r.answered > 0 ? `${Math.round((r.correct / r.answered) * 100)}%` : "-"}</td>
                        <td>{mmss(r.elapsedSec)}</td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {:else}
        <div class="wengu-muted wengu-stats-empty">{t("statsEmpty")}</div>
    {/if}

    <div class="wengu-stats-chart-title">{fmt(t("statsWrongList"), { n: String(model.wrongTotal) })}</div>
    {#if model.wrongs.length > 0}
        {#each model.wrongs as w (w.qid)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="wengu-stats-wrong" title={w.qid} onclick={() => ctl.enterReview(w.qid)}>
                <span class="wengu-stats-wrong-idx">{w.index}</span>
                <div class="wengu-stats-wrong-body">
                    <div class="wengu-stats-wrong-stem">{w.stemSummary}</div>
                    <div class="wengu-stats-wrong-meta">
                        {[
                            w.knowledge ?? "",
                            fmt(t("statsWrongCount"), { n: String(w.wrongCount) }),
                            w.right === "1"
                                ? t("statsWrongRecentRight")
                                : w.right === "0"
                                  ? t("statsWrongRecentWrong")
                                  : "",
                            w.lastAnswer ? fmt(t("statsWrongLast"), { a: w.lastAnswer }) : "",
                        ]
                            .filter(Boolean)
                            .join(" · ")}
                    </div>
                </div>
            </div>
        {/each}
    {:else}
        <div class="wengu-muted wengu-stats-empty">{t("statsNoWrong")}</div>
    {/if}

    <div class="wengu-word-form-actions">
        <button
            class="b3-button b3-button--outline"
            bind:this={aiBtn}
            onclick={() => aiOut && void ctl.runAi(aiBtn, aiOut)}
            >{@html svgIcon("iconSparkles")} {t("statsAiBtn")}</button
        >
    </div>
    <div class="wengu-report-ai" data-ai bind:this={aiOut} hidden></div>
</div>
