<script lang="ts">
    import { svgIcon } from "../../ui/FormHtml";
    import Button from "../../ui/Button.svelte";

    /**
     * 刷题主区头部（批次6-5 Svelte 化）：目录开关（收起时）+ 次头部
     * 信息行 + 「结束本次」（做题中）+ 计时器。次头部是导航时一次性
     * 渲染的静态串（文档信息/轮次成绩，rounds 计算逻辑留在编排侧
     * renderSubheadHtml），作 prop 喂进来 {@html} 插入——不随时间变，
     * 无需把 rounds 搬进组件。计时器 [data-timer] 与倒计时归零条槽
     * [data-timeup-slot] 是 TimerBinder 的命令式钩子（每秒写文本/
     * 归零插选择条），保留 DOM 契约不动——组件只产壳，不接管写。
     * 转换进度条槽 [data-status] 同由 convert/showStatus 命令式写。
     * 「结束本次」「目录开关」事件经 onAct 回调（ViewBindings 不再
     * 逐钮绑 head）。
     */
    let {
        t,
        sideCollapsed,
        subheadHtml,
        canEndRound,
        onAct,
        endRoundLabel,
        showFinishHint,
        showRegenBad = false,
        badMarkCount = 0,
        roundModeLabel = "",
    }: {
        t(key: string): string;
        sideCollapsed: boolean;
        /** 次头部信息行（编排侧 renderSubheadHtml 预渲染，静态）。 */
        subheadHtml: string;
        /** 做题中（可结束本轮）。 */
        canEndRound: boolean;
        /** 按钮（act 名同 data-act：side-toggle/end-round/regen-bad）。 */
        onAct(act: string): void;
        /** after 模式按钮文案（结束本次 / 交卷并查看答案）。
         *  由编排侧按 revealMode 算好传入。 */
        endRoundLabel: string;
        /** after 模式提示「做完后统一判卷」（同类按钮旁常显，Issue #12 B3） */
        showFinishHint: boolean;
        /** 预览模式且有标记题才出「批量重转标记的错题」钮（Issue #46）。 */
        showRegenBad?: boolean;
        /** 标记题数（跨卷全局；徽标文案用，0 时钮不显示）。 */
        badMarkCount?: number;
        /** 「第 N 轮 · 进行中」胶囊文案（Issue #135 §3.5，C 类增强；空=不出） */
        roundModeLabel?: string;
    } = $props();
</script>

{#if sideCollapsed}
    <Button class="wengu-btn" data-act="side-toggle" title={t("sideTitle")} onclick={() => onAct("side-toggle")}>
        {@html svgIcon("iconRight")}
    </Button>
{/if}
{@html subheadHtml}
{#if canEndRound}
    <!-- 交卷钮是本区唯一主操作（Issue #135 §3.6；spec「一个面板至多一个
         primary」此处即该一个）——after 模式下它是看答案的唯一出口 -->
    <Button
        variant="primary"
        class="wengu-end-round"
        data-act="end-round"
        title={t("endRoundHint")}
        onclick={() => onAct("end-round")}
    >
        {t(endRoundLabel)}
    </Button>
{/if}
{#if showFinishHint}
    <span class="wengu-finish-hint" data-finish-hint>{t("endRoundAfterHint")}</span>
{/if}
<!-- 批量重转「标记为错题」（Issue #46）：预览模式专属，N=0 时整个钮不显示；
     点击即进后台流（单飞闸/进度与停止在 AI 会话面板，终态走通知） -->
{#if showRegenBad}
    <Button
        variant="outline"
        class="wengu-regen-bad"
        data-act="regen-bad"
        title={t("regenBadMarkedTitle")}
        onclick={() => onAct("regen-bad")}
    >
        {@html svgIcon("iconRefresh")}
        {t("regenBadMarkedBtn")}({badMarkCount})
    </Button>
{/if}
{#if roundModeLabel}
    <span class="wengu-head-mode" data-head-mode>{roundModeLabel}</span>
{/if}
<span class="wengu-timer" data-timer title={t("totalTimeHint")}
    >{@html svgIcon("iconClock", "wengu-timer-icon")}<span data-timer-text>0:00</span></span
>
