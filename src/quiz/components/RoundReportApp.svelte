<script lang="ts">
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt, mmss } from "../../ui/shared";
    import { runAgentTextOrPanel } from "../../ai/agentPanel";
    import type { WeakCause, WeakTopRow } from "../../bank/data/WeaknessStore";
    import { byBaseQid, buildAnalysisPrompt, type RoundReportModel } from "../render/RoundReport";

    /**
     * 轮次报告（四件套之组件半，挂载编排见 render/RoundReport.ts 的
     * showRoundReportNow）：总用时/得分摘要 + 每题用时条形图 + 历史轮次
     * 得分图 + 薄弱沉淀区 + AI 分析入口。model 是收卷时一次性快照
     * （收一次卷整挂整卸），条形图在脚本侧预计算。AI 分析是命令式通道
     * （runAgentTextOrPanel 吃按钮/输出区 DOM 引用），组件内 bind:this
     * 直喂——暗雷 §8：命令式代码不声明式化。
     */
    let {
        model,
        modelId,
        onWeakDrill,
    }: {
        model: RoundReportModel;
        modelId: string;
        onWeakDrill(rows: WeakTopRow[]): void;
    } = $props();

    // model 是挂载时一次性快照（收卷即整挂整卸），静态解构是本意
    // svelte-ignore state_referenced_locally
    const { t, session: s, list, rounds } = model;
    const byQid = byBaseQid(s);
    const maxSec = Math.max(1, ...list.map((q) => byQid.get(q.id)?.sec ?? 0));
    // 每题用时条形图：高度 ∝ 秒数，对错描色，未答灰（多步题按整题聚合）
    const timeBars = list.map((q, i) => {
        const r = byQid.get(q.id);
        const sec = r?.sec ?? 0;
        // partial（brief 方向对但有缺口）单独描黄，区别于全错
        const state = !r
            ? t("reportUnanswered")
            : r.verdict === "partial"
              ? t("verdictPartial")
              : r.ok
                ? t("correct")
                : t("wrong");
        return {
            h: Math.max(4, Math.round((sec / maxSec) * 100)),
            cls: !r
                ? "wengu-bar-muted"
                : r.verdict === "partial"
                  ? "wengu-bar-partial"
                  : r.ok
                    ? "wengu-bar-right"
                    : "wengu-bar-wrong",
            title: fmt(t("reportQTime"), { n: String(i + 1), t: mmss(sec) }) + ` · ${state}`,
            label: i + 1,
        };
    });
    // 历史轮次得分条形图：高度 ∝ 正确率
    const scoreBars = rounds.map((r, i) => ({
        h: Math.max(4, Math.round((r.answered > 0 ? r.correct / r.answered : 0) * 100)),
        title: fmt(t("reportRoundScore"), { n: String(i + 1), c: String(r.correct), a: String(r.answered) }),
        label: i + 1,
    }));

    let aiBtn: HTMLButtonElement;
    let aiOut: HTMLDivElement;

    /** 错因显示文案（存储是规范键，展示走 i18n）。 */
    function weakCauseLabel(cause: WeakCause): string {
        return t(`weakCause${cause[0].toUpperCase()}${cause.slice(1)}`);
    }

    /** AI 分析：面板优先、页内降级（按钮/输出区命令式直喂）。 */
    function runAi(): void {
        void runAgentTextOrPanel({
            prompt: buildAnalysisPrompt(model),
            btn: aiBtn,
            out: aiOut,
            modelId,
            loadingText: t("reportAiLoading"),
            emptyText: t("convertEmptyReply"),
            failPrefix: t("convertAiFailed"),
        });
    }
</script>

<div class="wengu-report">
    <div class="wengu-start-title">{t("reportTitle")}</div>
    <div class="wengu-report-summary">
        <span class="wengu-meta">{fmt(t("reportScore"), { c: String(s.correct), a: String(s.answered) })}</span>
        <span class="wengu-meta">{@html svgIcon("iconClock")} {mmss(model.totalSec)}</span>
        {#if model.overtimeSec > 0}
            <span class="wengu-meta">+{mmss(model.overtimeSec)} {t("reportOvertime")}</span>
        {/if}
    </div>
    <div class="wengu-report-chart">
        <div class="wengu-report-label">{t("reportTimeChart")}</div>
        <div class="wengu-bars">
            {#each timeBars as b}
                <div class="wengu-bar-col" title={b.title}>
                    <div class="wengu-bar {b.cls}" style="height:{b.h}%"></div>
                    <span class="wengu-bar-label">{b.label}</span>
                </div>
            {/each}
        </div>
    </div>
    {#if rounds.length > 0}
        <div class="wengu-report-chart">
            <div class="wengu-report-label">{t("reportScoreChart")}</div>
            <div class="wengu-bars">
                {#each scoreBars as b}
                    <div class="wengu-bar-col" title={b.title}>
                        <div class="wengu-bar wengu-bar-score" style="height:{b.h}%"></div>
                        <span class="wengu-bar-label">{b.label}</span>
                    </div>
                {/each}
            </div>
        </div>
    {/if}
    {#if model.weakRows.length > 0}
        <div class="wengu-report-chart">
            <div class="wengu-report-label">{t("weakTitle")}</div>
            <div class="wengu-weak-list">
                {#each model.weakRows as r}
                    <div class="wengu-weak-row" title={r.title}>
                        <span class="wengu-weak-title">{r.title}</span>
                        <span class="wengu-meta">{fmt(t("weakStats"), { w: String(r.wrong), n: String(r.total) })}</span
                        >
                        {#if r.topCause}<span class="wengu-badge">{weakCauseLabel(r.topCause)}</span>{/if}
                    </div>
                {/each}
            </div>
            <button class="b3-button b3-button--outline" onclick={() => onWeakDrill(model.weakRows)}
                >{t("drillTitle")}</button
            >
        </div>
    {/if}
    <div>
        <button class="b3-button b3-button--outline" bind:this={aiBtn} onclick={runAi}>{t("reportAiBtn")}</button>
    </div>
    <div class="wengu-report-ai" hidden bind:this={aiOut}></div>
</div>
