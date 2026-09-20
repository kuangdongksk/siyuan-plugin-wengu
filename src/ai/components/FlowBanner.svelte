<script module lang="ts">
    /** i18n 键 → 六态名（chip 的色点类与 chip 自身色类共用；样式在 scss）。 */
    const CHIP_STATE: Record<string, string> = {
        aiFlowChipDone: "done",
        aiFlowChipSkipped: "skip",
        aiFlowChipRunning: "run",
        aiFlowChipStopped: "stop",
        aiFlowChipFailed: "fail",
        aiFlowChipCancelled: "cancel",
        aiFlowChipQueued: "queued",
    };

    /** chip 自身的色类（`is-done` …；词色与<b>数字</b>色由 scss 定）。 */
    export function chipCls(key: string): string {
        return `wengu-aiflow-chip is-${CHIP_STATE[key] ?? "queued"}`;
    }

    /** chip 的色点类（六态色点与分篇行同一个类族）。 */
    export function chipDotCls(key: string): string {
        return `wengu-aiflow-dot is-${CHIP_STATE[key] ?? "queued"}`;
    }
</script>

<script lang="ts">
    import { onMount } from "svelte";
    import { Armed } from "../../ui/shared";
    import Button from "../../ui/Button.svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import { aiFlowSnapshot, stopAiFlow, subscribeAiFlow, type AiFlowSnapshot } from "../core/FlowRegistry";
    import { bannerViewOf, type AiFlowBannerView } from "../core/FlowBannerUi";

    /**
     * 「运行中的 AI 流」横幅（Issue #77 落地、**Issue #85 按设计稿还原**）：
     * AI 会话面板**顶部**的流级停止面。三屏对应设计稿
     * `design/UI/转换/convert-stop-redesign.html`：
     *  - 批量队列跑动中 → 两行标题 + 构成条（六态分色 + aria）/ 单流进度条
     *    - 富统计（mono 数字）+ 收起/展开分篇 + cancel 语义停止钮；
     *    下方六态计数 chips（零值压暗）+ 展开后的分篇清单（五列 grid）；
     *  - 停止后抉择态 → 停止态视觉 + badge + 「前往页内转换条抉择」链，
     *    counts/清单保持可见，**保留/丢弃两钮不回退**（#77 既有行为）；
     *  - 单流态 → 只有 bar + stats + 停止钮。
     * 数据源是 ai 域通用注册表 core/FlowRegistry（**不是转换专属**），
     * 订阅制刷新；无在途流时整条不渲染。零 <style>，类名走全局 scss
     * （`.wengu-aiflow-*`）。
     */
    let { t, onDecide }: { t: (k: string) => string; onDecide?: () => void } = $props();

    let snap: AiFlowSnapshot | undefined = $state();
    /** 停止两击确认态（3s 自动复位，同仓内两击删除惯例；不上模态框）。 */
    let armedId: string | undefined = $state();
    /** 分篇清单展开态（组件持有；随流换人复位——默认收起，设计稿 actions
     *  里是「收起分篇 ▴」，即状态 1 展示的是已展开态）。 */
    let expandedId: string | undefined = $state();
    const arm = new Armed<string>((v) => (armedId = v));

    onMount(() => {
        const sync = (): void => {
            const next = aiFlowSnapshot();
            // 流换人/收口即复位确认态与展开态，免得两态跨流残留
            if (next?.id !== snap?.id) {
                if (armedId) arm.disarm();
                expandedId = undefined;
            }
            snap = next;
        };
        sync();
        return subscribeAiFlow(sync);
    });

    const view: AiFlowBannerView | undefined = $derived(
        bannerViewOf(snap, !!snap && armedId === snap.id, !!snap && expandedId === snap.id, t)
    );

    const clickStop = (): void => {
        if (!snap) return;
        if (armedId === snap.id) {
            arm.disarm();
            stopAiFlow();
            return;
        }
        arm.arm(snap.id);
    };

    /** 「收起/展开分篇」：纯展示态，不动注册表。 */
    const toggleList = (): void => {
        if (!snap) return;
        expandedId = expandedId === snap.id ? undefined : snap.id;
    };

    /** 「前往页内转换条抉择」：回调宿主滚到页内转换条；缺省回调时只收起。 */
    const gotoDecide = (): void => {
        onDecide?.();
        expandedId = undefined;
    };
</script>

{#if view && snap}
    <div class="wengu-aiflow" class:is-choice={view.choosing} class:is-stopped={view.stopped}>
        <div class="wengu-aiflow-row">
            <div class="wengu-aiflow-id">
                <span class="wengu-aiflow-dot" class:is-stopped={view.stopped}></span>
                <span class="wengu-aiflow-title">
                    <strong>{view.title}</strong>
                    {#if view.subtitle}<span>{view.subtitle}</span>{/if}
                </span>
            </div>
            <div class="wengu-aiflow-prog">
                {#if view.segs.length > 0}
                    <div class="wengu-aiflow-seg" role="img" aria-label={view.segLabel}>
                        {#each view.segs as s (s.cls)}
                            <i class={`s-${s.cls}`} style={`flex: ${s.weight}`}></i>
                        {/each}
                    </div>
                {:else if view.bar !== undefined}
                    <div class="wengu-aiflow-bar" role="img" aria-label={view.barLabel}>
                        <i style={`width: ${view.bar}%`}></i>
                    </div>
                {/if}
                {#if view.stats.length > 0}
                    <div class="wengu-aiflow-stats">
                        {#each view.stats as f, i (f.hint)}
                            {#if i > 0}<span class="wengu-aiflow-sep">·</span>{/if}
                            <span>{f.hint} <b>{f.value}</b>{f.tail}</span>
                        {/each}
                    </div>
                {:else if view.progress}
                    <div class="wengu-aiflow-text">{view.progress}</div>
                {/if}
                {#if view.extra}
                    <div class="wengu-aiflow-extra">{view.extra}</div>
                {/if}
            </div>
            <div class="wengu-aiflow-btns">
                {#if view.expandable}
                    <!-- 折叠指示用思源 SVG 图标（设计稿的 ▴/▾ 三角形是**符号
                         字符**，被 §〇「图标一律用内置 SVG symbol」禁掉；
                         `is-open` 靠 CSS 转 180° 复用同一个 iconDown） -->
                    <Button
                        type="button"
                        variant="text"
                        class={`wengu-aiflow-toggle${view.expanded ? " is-open" : ""}`}
                        onclick={toggleList}
                    >
                        {view.expanded ? t("aiFlowCollapseList") : t("aiFlowExpandList")}
                        {@html svgIcon("iconDown")}
                    </Button>
                {/if}
                {#if view.stopping}
                    <Button type="button" variant="cancel" onclick={clickStop}>{t(view.stopKey)}</Button>
                {:else if view.choosing}
                    <!-- 徽标文案走 i18n（设计稿写的是 mock 里的英文小写
                         "stopped"，直接抄进组件即硬编码——复用 counts 那一格
                         的「停止」/"Stopped"，语义同源、零新增键） -->
                    <span class="wengu-aiflow-badge is-stopped">{t("aiFlowChipStopped")}</span>
                    <Button type="button" variant="text" onclick={gotoDecide}>{t("aiFlowGotoDecide")}</Button>
                    <!-- 抉择落定后由**状态机**收口横幅（keep/discard 同步清快照 →
                         订阅 sync 里 end），组件不抢着 end——否则横幅先消失、
                         页内进度条还留着，两处口径分叉。 -->
                    <Button type="button" variant="primary" onclick={() => snap?.choice?.keep()}
                        >{t("aiFlowKeep")}</Button
                    >
                    <Button type="button" variant="cancel" onclick={() => snap?.choice?.discard()}
                        >{t("aiFlowDiscard")}</Button
                    >
                {/if}
            </div>
        </div>

        {#if view.total > 0}
            <div class="wengu-aiflow-counts">
                <span class="wengu-aiflow-lead">{view.totalLabel}</span>
                {#each view.chips as c (c.key)}
                    <span class={chipCls(c.key)} class:is-zero={c.isZero}>
                        <i class={chipDotCls(c.key)}></i>
                        {t(c.key)} <b>{c.n}</b>
                    </span>
                {/each}
            </div>
        {/if}

        {#if view.expanded && view.rows.length > 0}
            <div class="wengu-aiflow-list">
                <div class="wengu-aiflow-list-head">
                    <span>{t("aiFlowListTitle")}</span>
                    {#if view.listWindow}<span class="ln">{view.listWindow.label}</span>{/if}
                </div>
                {#each view.rows as r (r.idx)}
                    <div
                        class="wengu-aiflow-row-item"
                        class:is-current={r.current}
                        class:is-cancel={r.cancelled}
                        class:is-queued={r.queued}
                    >
                        <span class="dr-idx">{r.idx}</span>
                        <span class="dr-name">{r.name}</span>
                        <span class={`dr-state ${r.stateCls}`}>
                            <span class={`wengu-aiflow-dot is-${r.dotCls}`}></span>{r.stateText}
                        </span>
                        <span class="dr-note">{r.note}</span>
                        <span class="dr-metric">{r.metric}</span>
                    </div>
                {/each}
                {#if view.listFoot}
                    <div class="wengu-aiflow-list-foot">{view.listFoot}</div>
                {/if}
            </div>
        {/if}
    </div>
{/if}
