<script lang="ts">
    import { canExpandRow, isRowOpen, joinCopyParts, type SessionDetailView } from "../core/SessionDetail";
    import Button from "../../ui/Button.svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import { copyText } from "../../ui/shared";

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
     *
     * **一键复制（Issue #124）**：块头右侧的复制钮（每块一个）与**轮次头**
     * 的「复制整轮」（`copyParts` 按输入/输出序拼全文、块间空行分隔）——
     * 整轮钮落在轮次头而非块尾：它与展开态无关，收起行也该能一次取走全轮。
     * 两个刻意的形态取舍：
     *  - 复制钮**常显**、不做 hover 显隐：触屏没有 hover，「移动端必须常显」
     *    等于「永远常显」——hover 只是桌面端多出来的一层糖，不为此写两套；
     *  - 反馈是**按钮原地**换图标 + `title`（1.5s 复位，同页内转换条复制钮
     *    的口径），不弹全局 toast——详情里有 N 个块，toast 会刷屏。
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

    /** 反馈态的键：`<行下标>:<块侧别 | "turn">`——只用于「这个钮刚复制成功」，
     *  **不参与任何判据**。含行下标与侧别：同一行两块各有各的反馈；换记录
     *  整块重挂（外层 `{#key}`）时态自然复位。失败态写成 `fail:<键>`（同一个
     *  变量装两种态，省一个 $state 且两态天然互斥）。 */
    let copiedKey = $state("");
    /** 反馈复位定时器的**序号**（不是下标）：用户在同一格反馈没复位时再复制
     *  一次，两个定时器都会到点——序号让先发的那个认出「已被后来者顶掉」而
     *  不乱清（用下标或布尔量都会把后一次的反馈提前抹掉）。 */
    let copiedSeq = 0;

    /** 反馈态持续时长（Issue #124 验收：约 1.5s）。 */
    const COPIED_MS = 1500;

    /**
     * 复制一段正文 + 按钮原地反馈。**降级分支是主路径的延续**：剪贴板 API
     * 在非安全上下文（`file://`/http）直接不可用，`copyText` 内部的
     * `execCommand` 兜底同样可能失败（Neo 主题下 `user-select` 受限）。
     * 那里**不抛错、也不弹 toast**（验收 3：失败不报错堆栈）——反馈钮换成
     * 「复制失败」提示，用户仍可自行圈选。
     *
     * ⚠️ `await` 之后**不碰 DOM**、只改 `$state`：这期间按钮可能已被 Svelte
     * 重挂（换记录 / 行被收起），拿旧节点写样式会写到一个已脱离文档的元素上
     * ——反馈「显示不出来」还查不到原因。
     */
    const copyBlock = async (key: string, text: string): Promise<void> => {
        const ok = await copyText(text);
        const id = ++copiedSeq;
        copiedKey = ok ? key : `fail:${key}`;
        setTimeout(() => {
            if (id === copiedSeq) copiedKey = "";
        }, COPIED_MS);
    };

    /** 整轮的复制正文（`copyParts` 按输入/输出序拼、块间空行分隔）。 */
    const turnText = (row: { copyParts: readonly string[] }): string => joinCopyParts(row.copyParts);
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
                    <!-- 轮次头一行 = 摘要贴左 + 「复制整轮」贴右（Issue #124 需求 3）。
                         钮放**轮次头**而不是块尾：整轮复制与展开态无关，收起行也该能
                         一次取走全轮（放块尾会随行收起一起消失，还得先展开才能复制）。
                         钮在行头 click 容器（li）内 ⇒ onclick 必须 stopPropagation（同块级钮）。 -->
                    <span class="wengu-aipanel-loghead">
                        <span class="wengu-aipanel-logtext">
                            {#each row.parts as seg, j (j)}
                                {#if seg.em}<em>{seg.text}</em>{:else}{seg.text}{/if}
                            {/each}
                        </span>
                        {#if row.copyParts.length > 0}
                            {@const tk = `${i}:turn`}
                            {@const tFail = copiedKey === `fail:${tk}`}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <span
                                class="wengu-aipanel-copy wengu-aipanel-copyturn"
                                class:hit={copiedKey === tk}
                                class:hitfail={tFail}
                                role="button"
                                tabindex="0"
                                title={tFail ? t("aiCopyFail") : copiedKey === tk ? t("aiCopied") : t("aiCopyTurn")}
                                onclick={(e) => {
                                    e.stopPropagation();
                                    void copyBlock(tk, turnText(row));
                                }}
                                onkeydown={(e) => {
                                    if (e.key !== "Enter" && e.key !== " ") return;
                                    e.stopPropagation();
                                    e.preventDefault();
                                    void copyBlock(tk, turnText(row));
                                }}
                            >
                                {@html svgIcon(copiedKey === tk ? "iconCheck" : "iconCopy")}
                                <span class="wengu-aipanel-copy-t"
                                    >{tFail
                                        ? t("aiCopyFail")
                                        : copiedKey === tk
                                          ? t("aiCopied")
                                          : t("aiCopyTurn")}</span
                                >
                            </span>
                        {/if}
                    </span>
                    {#if isOpen}
                        <!-- 块头一行 = 侧别标签贴左 + 复制钮贴右（Issue #124）：
                             钮常显（触屏无 hover；「移动端必须常显」在触屏上就是
                             「永远常显」），图标走 svgIcon 的官方 iconCopy
                             （页内转换条复制钮同款）。 -->
                        {#each row.segments as seg, k (k)}
                            {@const ck = `${i}:${seg.side}`}
                            {@const cFail = copiedKey === `fail:${ck}`}
                            <div class={`wengu-aipanel-logseg is-${seg.side}`}>
                                <div class="wengu-aipanel-logsegh">
                                    <span class="wengu-aipanel-logsegl">{seg.label}</span>
                                    <!-- ⚠️ 复制钮在行头 click 容器（li）内 ⇒ **必须
                                         stopPropagation**：不拦的话点复制会把整行
                                         收起（行头 toggleRow），两块一起消失、刚换上的
                                         「已复制」反馈也一并没了（验收 2 直接落空）。 -->
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <span
                                        class="wengu-aipanel-copy"
                                        class:hit={copiedKey === ck}
                                        class:hitfail={cFail}
                                        role="button"
                                        tabindex="0"
                                        aria-label={t("aiCopyBlock")}
                                        title={cFail
                                            ? t("aiCopyFail")
                                            : copiedKey === ck
                                              ? t("aiCopied")
                                              : t("aiCopyBlock")}
                                        onclick={(e) => {
                                            e.stopPropagation();
                                            void copyBlock(ck, seg.copyText);
                                        }}
                                        onkeydown={(e) => {
                                            if (e.key !== "Enter" && e.key !== " ") return;
                                            e.stopPropagation();
                                            e.preventDefault();
                                            void copyBlock(ck, seg.copyText);
                                        }}
                                    >
                                        {@html svgIcon(copiedKey === ck ? "iconCheck" : "iconCopy")}
                                    </span>
                                </div>
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
