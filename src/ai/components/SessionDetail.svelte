<script lang="ts">
    import { canExpandRow, isRowOpen, type SessionDetailView } from "../core/SessionDetail";
    import Button from "../../ui/Button.svelte";

    /**
     * 记录详情三段（Issue #88，设计稿 `.ai-detail` 照稿施工）：
     * `head`（任务名 + kind 徽标 + 状态徽标）／`body`（轮次日志）／
     * `foot`（归属备注或重试钮）。
     *
     * 视图模型在 core/SessionDetail（纯逻辑带单测），本组件**零判断**、
     * 只按字段渲染；类名走全局 scss（`.wengu-aipanel-*`），零 `<style>`。
     *
     * 三处刻意的取舍（照稿但不丢功能）：
     *  - 摘要行的 `<em>` 强调位由**纯逻辑切好的段**（`parts`）驱动，组件不
     *    解析字符串——拆串拼 HTML 有注入面，分段数组没有；
     *  - 设计稿的日志行是「时间戳 + 摘要」形态，而面板的核心用途是**回看
     *    产出**——故每行带回全文、点行展开（Issue #98 起**默认展开**：多数
     *    成功记录只有一轮，再点一下才看到产出是多余动作）；
     *  - 展开态的正文按侧别**分块**（输入 / 输出各一块、标签由 core 侧取词
     *    ——`segments`，组件不取词）：块序连排在行内，DOM 序保持 user 在前
     *    （读屏与整段复制的阅读序=真实先后），块间距由 aipanel.scss 的
     *    `margin-top` 给。**摘要行本身不动**，仍是一行一轮。
     */
    let {
        view,
        onRetry,
        onDecide,
        t,
    }: {
        view: SessionDetailView;
        onRetry: () => void;
        onDecide?: () => void;
        t: (k: string) => string;
    } = $props();

    /** 展开全文的行下标集合（Issue #98：**默认全部展开**——一般成功记录
     *  只有一轮，再点一下才看到产出是多余动作；点行头仍可收起/展开，交互
     *  本身不变）。集合里只记**被显式收起**的行：记录换 key 重挂时集合清空
     *  ⇒ 新记录回到「全展开」，不需要看行数重算。
     *
     *  开合判据与「可展开」判据都在 core 侧（`isRowOpen` / `canExpandRow`，
     *  带单测）——组件自持的 $state 在 vitest 里挂不上，判据留在组件里
     *  「默认展开」就没有回归锁。 */
    let closedRows = $state<Record<number, boolean>>({});
    const toggleRow = (i: number): void => {
        closedRows[i] = !closedRows[i];
    };
</script>

<div class="wengu-aipanel-detail">
    <div class="wengu-aipanel-dhead">
        <!-- 模型名折进 title 悬停（gap-list S7：稿内 detail-head 无「时间 ·
             模型」meta 串，常驻视觉位让给状态徽标贴右） -->
        <h3 class="wengu-aipanel-dtitle" title={view.head.modelText}>{view.head.title}</h3>
        <span class="wengu-aipanel-badge is-plain">kind={view.head.kindText}</span>
        <span class={`wengu-aipanel-badge is-${view.head.status.badgeCls}`}>
            {#if view.head.status.spin}<span class="wengu-aipanel-spin" aria-hidden="true"></span>{/if}
            {view.head.status.badgeText}
        </span>
    </div>

    <div class="wengu-aipanel-dbody">
        <p class="wengu-aipanel-logl">{view.logLabel}</p>
        <ul class="wengu-aipanel-log">
            {#each view.rows as row, i (i)}
                {@const canOpen = canExpandRow(row)}
                {@const isOpen = isRowOpen(row, closedRows, i)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <li
                    class:is-error={row.isError}
                    class:is-open={isOpen}
                    class:is-clickable={canOpen}
                    onclick={() => canOpen && toggleRow(i)}
                >
                    <span class="t">{row.time}</span>
                    <span class="wengu-aipanel-logtext">
                        {#each row.parts as seg, j (j)}
                            {#if seg.em}<em>{seg.text}</em>{:else}{seg.text}{/if}
                        {/each}
                    </span>
                    {#if isOpen}
                        {#each row.segments as seg, k (k)}
                            <div class={`wengu-aipanel-logseg is-${seg.side}`}>
                                <span class="wengu-aipanel-logsegl">{seg.label}</span>
                                <pre class="wengu-aipanel-logfull">{seg.text}</pre>
                            </div>
                        {/each}
                    {/if}
                </li>
            {/each}
            {#if view.pending}
                <li>
                    <span class="t">—</span>
                    <span class="wengu-aipanel-logtext wengu-muted">{view.pending}</span>
                </li>
            {/if}
        </ul>
        {#if view.errorText}
            <div class="wengu-ai-err">{view.errorText}</div>
        {/if}
    </div>

    <!-- 空脚不渲染（Issue #98）：无 own-note 且不可重试时整块不出——空容器
         的 padding + border-top + 底色在已完成态看起来就是「下方空一块」 -->
    {#if view.ownNote.length > 0 || view.retryable}
        <div class="wengu-aipanel-dfoot">
            {#if view.ownNote.length > 0}
                <div class="wengu-aipanel-own">
                    <span class={`wengu-aipanel-dot is-${view.head.status.dotCls}`}></span>
                    <!-- 归属说明按**分段**渲染（gap-list A7，叠加 Issue #88 的
                         停止态语义）：首句加粗、入口词主色强调——组件不解析
                         字符串，段由 core 侧给（`FlowOwnership.ownershipSegsOf`） -->
                    <span class="wengu-aipanel-owntext">
                        {#each view.ownNote as seg, i (i)}
                            {#if seg.bold}<b>{seg.text}</b>{:else if seg.accent}<span class="at">{seg.text}</span
                                >{:else}{seg.text}{/if}
                        {/each}
                    </span>
                    <!-- 抉择入口只在**被停止**的记录上出（停止后的唯一收口动作）；
                         在途记录的归属备注只指路「去哪停」，宿主不给这个钮 -->
                    {#if view.decidable && onDecide}
                        <Button type="button" variant="text" onclick={onDecide}>{t("aiFlowGotoDecide")}</Button>
                    {/if}
                </div>
            {/if}
            {#if view.retryable}
                <Button type="button" variant="primary" onclick={() => onRetry()}>{t("aiRetry")}</Button>
            {/if}
        </div>
    {/if}
</div>
