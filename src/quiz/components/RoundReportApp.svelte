<script lang="ts">
    import { svgIcon } from "../../ui/FormHtml";
    import Button from "../../ui/Button.svelte";
    import { fmt, mmss, ratePct } from "../../ui/shared";
    import { runAgentTextOrPanel } from "../../ai/agentPanel";
    import { byBaseQid, buildAnalysisPrompt } from "../../ai/prompts/judge";
    import { weakCauseLabelKey } from "../../bank/data/WeaknessStore";
    import type { WeakTopRow } from "../../bank/data/WeaknessStore";
    import type { RoundReportModel } from "../render/RoundReport";

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
        onBackToQuiz,
    }: {
        model: RoundReportModel;
        modelId: string;
        onWeakDrill(rows: WeakTopRow[]): void;
        /** 「返回题卷」：收起总结、回到题卷（回顾错题用）。挂载方给出口
         *  （收卷总结视图的收尾在 render/RoundReport.ts）。 */
        onBackToQuiz?(): void;
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
        h: Math.max(4, ratePct(r.correct, r.answered)),
        title: fmt(t("reportRoundScore"), { n: String(i + 1), c: String(r.correct), a: String(r.answered) }),
        label: i + 1,
    }));

    let aiBtn: HTMLButtonElement;
    let aiOut: HTMLDivElement;

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

<div class="wengu-report-acts">
    {#if onBackToQuiz}
        <Button variant="outline" onclick={() => onBackToQuiz?.()}>{t("reportBackToQuiz")}</Button>
    {/if}
</div>
<!-- data-report-scroll 是**滚动窗的唯一钩子**（render/RoundReport.ts 的
     reportScrolled/scrollReportTop 按它取元素）——桩与真件必须同一个：
     原先只在编排层放了个空桩、组件渲染的窗没有该属性，而 Svelte 无 anchor
     挂载是 append 到 host 末尾 ⇒ 两者并列，querySelector 命中的永远是那个
     空桩：scrollTop 恒 0 ⇒「已滚离顶部」永不成立、scrollTo 打空、「重开总结
     滚回顶部」静默失效。故属性落在**组件渲染的这个窗**上，编排层不再放桩。 -->
<div class="wengu-report-scroll" data-report-scroll>
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
                            <span class="wengu-meta"
                                >{fmt(t("weakStats"), { w: String(r.wrong), n: String(r.total) })}</span
                            >
                            {#if r.topCause}<span class="wengu-badge">{t(weakCauseLabelKey(r.topCause))}</span>{/if}
                        </div>
                    {/each}
                </div>
                <Button variant="outline" onclick={() => onWeakDrill(model.weakRows)}>{t("drillTitle")}</Button>
            </div>
        {/if}
        <div>
            <Button variant="outline" buttonRef={(button) => (aiBtn = button)} onclick={runAi}
                >{t("reportAiBtn")}</Button
            >
        </div>
        <div class="wengu-report-ai" hidden bind:this={aiOut}></div>
    </div>
</div>

<!-- 样式绑定（design-spec §13）：本行是本组件独占、零 TS 拼串触达的自绘
     构件 → 写进组件 <style>（svelte-loader css:"injected" 运行时注入）。
     其余 .wengu-report* 类由 render/RoundReport.ts 的 innerHTML 桩与隐藏
     类选择器触达 ⇒ 留共享片 scss/report.scss；.wengu-report-scroll 同款
     （滚动窗须存在，才让追加 2 能判「报告是否已滚离顶部」）。 -->
<style>
    .wengu-report-acts {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
</style>
