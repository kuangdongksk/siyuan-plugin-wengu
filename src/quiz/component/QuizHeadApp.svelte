<script lang="ts">
    import { svgIcon } from "../../ui/FormHtml";

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
    }: {
        t(key: string): string;
        sideCollapsed: boolean;
        /** 次头部信息行（编排侧 renderSubheadHtml 预渲染，静态）。 */
        subheadHtml: string;
        /** 做题中（可结束本轮）。 */
        canEndRound: boolean;
        /** 按钮（act 名同 data-act：side-toggle/end-round）。 */
        onAct(act: string): void;
    } = $props();
</script>

{#if sideCollapsed}
    <button class="wengu-btn" data-act="side-toggle" title={t("sideTitle")} onclick={() => onAct("side-toggle")}>
        {@html svgIcon("iconRight")}
    </button>
{/if}
{@html subheadHtml}
{#if canEndRound}
    <button
        class="b3-button b3-button--outline wengu-end-round"
        data-act="end-round"
        title={t("endRoundHint")}
        onclick={() => onAct("end-round")}
    >
        {t("endRoundBtn")}
    </button>
{/if}
<span class="wengu-timer" data-timer title={t("totalTimeHint")}
    >{@html svgIcon("iconClock", "wengu-timer-icon")}<span data-timer-text>0:00</span></span
>
