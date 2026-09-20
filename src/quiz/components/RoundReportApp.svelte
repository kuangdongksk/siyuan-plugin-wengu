<script lang="ts">
    import { svgIcon } from "../../ui/FormHtml";
    import Button from "../../ui/Button.svelte";
    import { fmt, mmss, ratePct } from "../../ui/shared";
    import { runAgentTextOrPanel } from "../../ai/agentPanel";
    import { byBaseQid, buildAnalysisPrompt, TIME_UNKNOWN_TEXT } from "../../ai/prompts/judge";
    import { weakCauseLabelKey } from "../../bank/data/WeaknessStore";
    import type { WeakTopRow } from "../../bank/data/WeaknessStore";
    import { buildTimeBars, type TimeBarInput } from "../render/TimeBars";
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
    /** 展开的组（下标集；逐题档恒为空——没有可折叠的明细）。 */
    let expanded = $state(new Set<number>());

    function toggleGroup(i: number): void {
        const next = new Set(expanded);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        expanded = next;
    }

    // 每题用时条形图（Issue #155 块 B）：卷长 ≤60 逐题、>60 按 n 题一组
    // 聚合（组数 ≤ ~50）——243 题原来渲染 243 根柱，宽压到几像素不可读。
    // 组装是纯函数（render/TimeBars，带单测），本组件只做两件事：
    // 取状态喂进去 + 把 i18n 文案格式化器递下去。
    const barInputs: TimeBarInput[] = list.map((q, i) => {
        const r = byQid.get(q.id);
        return {
            label: i + 1,
            sec: r?.sec ?? 0,
            unanswered: !r,
            wrong: !!r && !r.ok && r.verdict !== "partial",
            partial: r?.verdict === "partial",
        };
    });
    const stateText = (x: TimeBarInput): string =>
        x.unanswered ? t("reportUnanswered") : x.partial ? t("verdictPartial") : x.wrong ? t("wrong") : t("correct");
    /** 逐题/组柱的**用时三态**（Issue #177 追加）：未答不注时间、未记录
     *  写「用时未记录」（同判卷 prompt 的 {@link TIME_UNKNOWN_TEXT} 口径，
     *  同一常量，别各写一套）、有真用时才落 `mmss`。
     *
     *  ⚠️ 为什么不能直接 `mmss(x.sec)`：`mmss` 只夹 `Math.max(0, …)`，
     *  **脏输入会算出「NaN:NaN」/「Infinity:NaN:NaN」印进 tooltip**——数据
     *  侧已在 `byBaseQid` 出口归一（非有限值 → 0），这里是出口那道，两处
     *  同口径；也顺带对齐「0 与缺失同路」：不说「0:00」，说「未记录」。 */
    const timeText = (sec: number, unanswered: boolean): string =>
        unanswered ? t("reportUnanswered") : sec > 0 ? mmss(sec) : TIME_UNKNOWN_TEXT;
    const timeBars = buildTimeBars(barInputs, {
        fmtTitle: (x) =>
            fmt(t("reportQTime"), { n: String(x.label), t: timeText(x.sec, x.unanswered) }) + ` · ${stateText(x)}`,
        fmtGroup: (g) =>
            fmt(t("reportGroupTime"), {
                n: String(g.from),
                m: String(g.to),
                x: String(g.answered),
                y: String(g.total),
                t: timeText(g.sec, g.answered === 0),
            }),
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
            <!-- 卷长 >60 时每列是一组（组数 ≤ ~50）：组柱可点/回车展开
                 组内逐题明细（Issue #155 块 B 的「查看组内详情」）。列本身
                 只用 button role + title（无障碍：可聚焦、Enter/Space 原生
                 即触发 click），明细行复用既有的逐题 title 文案。 -->
            <div class="wengu-bars">
                {#each timeBars as b, i (i)}
                    {#if b.grouped}
                        <div class="wengu-bar-col wengu-bar-col-group">
                            <button
                                type="button"
                                class="wengu-bar-hit"
                                data-bar-group
                                aria-expanded={expanded.has(i)}
                                title={b.title}
                                onclick={() => toggleGroup(i)}
                            >
                                <div class="wengu-bar {b.cls}" style="height:{b.h}%"></div>
                                <span class="wengu-bar-label">{b.label}</span>
                            </button>
                        </div>
                    {:else}
                        <div class="wengu-bar-col" title={b.title}>
                            <div class="wengu-bar {b.cls}" style="height:{b.h}%"></div>
                            <span class="wengu-bar-label">{b.label}</span>
                        </div>
                    {/if}
                {/each}
            </div>
            {#if expanded.size > 0}
                <div class="wengu-bar-detail-list">
                    {#each [...expanded].sort((a, b) => a - b) as gi (gi)}
                        <div class="wengu-bar-detail" data-bar-detail>
                            <div class="wengu-bar-detail-head">{timeBars[gi]?.title}</div>
                            {#each timeBars[gi]?.items ?? [] as it (it.label)}
                                <div class="wengu-bar-detail-row" title={it.title}>
                                    <span class="wengu-bar-detail-dot {it.cls}"></span>
                                    <span class="wengu-bar-detail-text">{it.title}</span>
                                </div>
                            {/each}
                        </div>
                    {/each}
                </div>
            {/if}
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
     其余 .wengu-report* 类由 render/RoundReport.ts 的隐藏类选择器触达 ⇒
     留共享片 scss/report.scss；.wengu-report-scroll 同款（见上方滚动窗钩子注）。 -->
<style>
    .wengu-report-acts {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }

    /* 组内逐题明细（Issue #155 块 B）：展开在条形图正下方，卡内两列
       各自内滚（#96 高度链）——明细块自身不限高，长明细随报告一起滚。
       色点沿用 .wengu-bar-* 的背景（那族在 scss/report.scss，TS 拼串
       触达故不能搬进组件）。 */
    .wengu-bar-detail-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 6px;
    }

    .wengu-bar-detail {
        padding: 8px 10px;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius);
        background: var(--b3-theme-background-light);
    }

    .wengu-bar-detail-head {
        margin-bottom: 4px;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
    }

    .wengu-bar-detail-row {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
    }

    .wengu-bar-detail-dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 2px;
    }

    .wengu-bar-detail-text {
        flex: 1;
        min-width: 0;
        font-size: 12px;
    }
</style>
