<script lang="ts">
    import { onMount, setContext } from "svelte";
    import type { QuizView } from "../../quiz";
    import { SESSION_PANEL_CTX, initialSessionPanelUi } from "../core/SessionPanelUi";
    import { SessionPanelCtl } from "../core/SessionPanelCtl";
    import { buildSessionTree, groupRowName } from "../core/SessionTree";
    import { detailViewOf } from "../core/SessionDetail";
    import { flowOwnershipOf, ownershipTextOf } from "../core/FlowOwnership";
    import { listAiModels } from "../models";
    import FlowBanner from "./FlowBanner.svelte";
    import SessionDetail from "./SessionDetail.svelte";
    import TreeList from "../../ui/TreeList.svelte";
    import type { TreeListNode } from "../../ui/TreeListTypes";
    import { fmt } from "../../ui/shared";
    import Button from "../../ui/Button.svelte";

    /**
     * AI 会话管理工作区面板根组件（四件套之一）。两栏式（20260901
     * 改版）：左栏=会话清单（类别过滤 + 两击删除，固定宽自滚），右栏=
     * 选中会话的明细，点左侧行即切右栏内容。
     *
     * **按设计稿还原（Issue #88，`design/convert-stop-redesign.html` 的
     * `ai-panel-batch-running` / `ai-panel-single-running` /
     * `ai-panel-stopped` 三屏）**：
     *  - 左栏树：头部「AI 会话」+ 组数徽标；二级组行=「类别 · 文档名」
     *    组合行；叶子行 = 状态点 + **任务名** + 状态徽标（running 带转圈）
     *    ——40 条记录一眼看出哪批失败哪批成功；
     *  - 右栏：三段（详情头 h3 + kind 徽标 + 状态徽标 / 轮次日志 /
     *    归属备注），**记录详情不再有停止钮**（Issue #77 口径，归属备注
     *    把用户送回唯一的流级入口）。
     *
     * 树的层级（20260903 种类优先两级树）不变：顶层一类一棵树，类内按主题
     * （组标题「 · 」后的文档名）出第二级，跨次运行同文档合并；渲染走共享
     * 组件 ui/TreeList（**本体不动**——新形态全靠 ai 面板根类 + main/trailing
     * 片段表达）。纯折算在 core/SessionTree 与 core/SessionDetail（带单测），
     * 组件零判断。登记簿本体在 data/AiSessions（全仓共享单例，agentChatOnce
     * 带 track 的调用自动登记），本组件只吃快照；挂载编排见
     * ai/SessionPanel.ts。零 <style>，类名走全局 scss（scss/aipanel.scss）。
     */
    let { v }: { v: QuizView } = $props();

    // svelte-ignore state_referenced_locally
    const t = v.t;
    const ui = $state(initialSessionPanelUi());
    // svelte-ignore state_referenced_locally
    const ctl = new SessionPanelCtl(ui);
    setContext(SESSION_PANEL_CTX, { ctl, ui, t });

    /** 已知类别 → i18n 键（顺序即过滤条顺序；未知类别原样显示排尾部）。 */
    const KIND_KEYS: Record<string, string> = {
        judge: "aiKindJudge",
        convert: "aiKindConvert",
        detect: "aiKindDetect",
        tag: "aiKindTag",
        route: "aiKindRoute",
        regen: "aiKindRegen",
        outline: "aiKindOutline",
        word: "aiKindWord",
        ask: "aiKindAsk",
        analyze: "aiKindAnalyze",
    };
    const kindLabel = (k: string): string => (KIND_KEYS[k] ? t(KIND_KEYS[k]) : k);

    const modelNames = new Map(listAiModels().map((m) => [m.id, m.name]));
    const modelName = (id: string): string => modelNames.get(id) ?? (id || t("aiModelDefault"));

    const p2 = (n: number): string => String(n).padStart(2, "0");
    const fmtTime = (ts: number): string => {
        const d = new Date(ts);
        return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    };

    /** 快照 → 树（种类→文档→调用两级分支；类别过滤与 i18n 种类名注入，
     *  纯函数见 core/SessionTree）。 */
    const tree = $derived.by(() => buildSessionTree(ui.recs, ui.filter, kindLabel, t));
    const kinds = $derived.by(() => {
        const present = new Set(ui.recs.map((r) => r.kind));
        return [...Object.keys(KIND_KEYS).filter((k) => present.has(k)), ...[...present].filter((k) => !KIND_KEYS[k])];
    });
    const sel = $derived.by(() => ui.recs.find((r) => r.id === ui.selId));
    /** 详情三段视图（设计稿 .ai-detail；纯折算在 core/SessionDetail）。 */
    const detail = $derived.by(() =>
        detailViewOf(sel, {
            t,
            kindText: sel ? kindLabel(sel.kind) : "",
            title: sel ? (tree.leafViewByKey.get(sel.id)?.name ?? "") : "",
            modelText: sel ? modelName(sel.model) : "",
            ownNote: sel ? ownershipTextOf(t, flowOwnershipOf(sel)) : "",
        })
    );
    /** 树头组数徽标（设计稿 badge--plain「3 组」）：树的顶层节点数。 */
    const groupCount = $derived(tree.nodes.length);

    /** 叶子行（会话）点击=选中切右栏；动作钮不触发（同知识面板口径）。 */
    const rowclick = (n: TreeListNode, e: MouseEvent): void => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (n.id) ctl.select(n.id);
    };

    /** 归属备注里的「前往页内转换条抉择」：与横幅同一个回调（宿主滚条）。 */
    const gotoDecide = (): void => v.convertAccess.revealConvertBar();

    onMount(() => {
        void ctl.load();
        return () => ctl.destroy();
    });
</script>

{#if ui.phase === "loading"}
    <div class="wengu-ws-page"><div class="wengu-muted">{t("loading")}</div></div>
{:else}
    <div class="wengu-ws-page">
        <div class="wengu-ws-title">
            <!-- 设计稿 .ai-tree-head 的「AI 会话 + badge--plain（组数）」与宿主
                 的面板标题栏**合并成一行**：照稿写进树头会在同一屏紧贴出两遍
                 「AI 会话」（宿主标题栏每个面板都有，不是本单能删的 chrome）。 -->
            {t("aiPanelTitle")}
            {#if groupCount > 0}
                <span class="wengu-aipanel-badge is-plain wengu-aipanel-gcount"
                    >{fmt(t("aiPanelGroups"), { n: String(groupCount) })}</span
                >
            {/if}
            <span class="wengu-ws-titlebtns">
                <Button type="button" variant="outline" onclick={() => ctl.armClear()}
                    >{ui.clrArmed ? t("collectConfirm") : t("aiClear")}</Button
                >
                <Button type="button" variant="text" onclick={() => void ctl.load()}>{t("quizRefresh")}</Button>
            </span>
        </div>
        <div class="wengu-muted" style="margin-bottom:8px">{t("aiPanelHint")}</div>

        <!-- 流级横幅（Issue #77 / #85）：多调用流的停止唯一入口；无在途流时整条不渲染 -->
        <FlowBanner {t} onDecide={() => v.convertAccess.revealConvertBar()} />

        <div class="wengu-ai-kinds">
            <Button type="button" variant={ui.filter === "" ? "main" : "outline"} onclick={() => ctl.setFilter("")}
                >{t("aiKindAll")}</Button
            >
            {#each kinds as k (k)}
                <Button type="button" variant={ui.filter === k ? "main" : "outline"} onclick={() => ctl.setFilter(k)}
                    >{kindLabel(k)}</Button
                >
            {/each}
        </div>
        <!-- 两栏式（20260901）：左清单常驻（TreeList 树），点行切右栏明细 -->
        <div class="wengu-ai-two">
            <div class="wengu-ai-side">
                <div class="wengu-ai-list">
                    {#if tree.nodes.length === 0}
                        <div class="wengu-muted">{t("aiEmpty")}</div>
                    {:else}
                        <div class="wengu-tree">
                            <TreeList
                                nodes={tree.nodes}
                                openKeys={ui.openGroups}
                                current={ui.selId}
                                onrowclick={rowclick}
                            >
                                {#snippet main(n)}
                                    {@const b = tree.branchByKey.get(n.key)}
                                    {#if b}
                                        <!-- 二级组行（设计稿 tg2）=「类别 · 文档名」组合行；
                                             种类级只出类别名（b.subject 缺位） -->
                                        <span class="wengu-aipanel-dot is-{b.status}"></span>
                                        <span class="wengu-ai-name{b.subject ? '' : ' wengu-ai-name-group'}"
                                            >{groupRowName(b.kind, b.subject, kindLabel)}</span
                                        >
                                    {:else}
                                        {@const lv = tree.leafViewByKey.get(n.key)}
                                        <!-- 叶子行（设计稿 leaf）= 状态点 + 任务名 + 状态徽标；
                                             40 条记录一眼看出哪批失败哪批成功 -->
                                        <span class="wengu-aipanel-dot is-{lv?.dotCls ?? 'done'}"></span>
                                        <span class="wengu-ai-name">{lv?.name ?? n.name}</span>
                                        {#if lv}
                                            <span class={`wengu-aipanel-badge is-${lv.badgeCls}`}>
                                                {#if lv.spin}
                                                    <span class="wengu-aipanel-spin" aria-hidden="true"></span>
                                                {/if}
                                                {lv.badgeText}
                                            </span>
                                        {/if}
                                    {/if}
                                {/snippet}
                                {#snippet trailing(n)}
                                    {@const b = tree.branchByKey.get(n.key)}
                                    {#if b}
                                        <span class="wengu-ai-meta"
                                            >{fmt(t("aiGroupMeta"), {
                                                n: String(b.recs.length),
                                                time: fmtTime(b.createdAt),
                                            })}</span
                                        >
                                        <!-- 种类级不配删除（误击会清整类）；文档级两击删该文档全部记录 -->
                                        {#if b.subject}
                                            <span class="b3-list-item__action">
                                                <Button
                                                    type="button"
                                                    variant="text"
                                                    onclick={() =>
                                                        ctl.armRemoveIds(
                                                            b.key,
                                                            b.recs.map((r) => r.id)
                                                        )}
                                                >
                                                    {ui.rmArmed === b.key ? t("collectConfirm") : t("aiDelete")}
                                                </Button>
                                            </span>
                                        {/if}
                                    {:else}
                                        {@const r = tree.recByKey.get(n.key)}
                                        {#if r}<span class="wengu-ai-meta">{fmtTime(r.createdAt)}</span>{/if}
                                        <span class="b3-list-item__action">
                                            <Button
                                                type="button"
                                                variant="text"
                                                onclick={() => ctl.armRemove(n.id ?? "")}
                                            >
                                                {ui.rmArmed === n.id ? t("collectConfirm") : t("aiDelete")}
                                            </Button>
                                        </span>
                                    {/if}
                                {/snippet}
                            </TreeList>
                        </div>
                    {/if}
                </div>
            </div>
            <div class="wengu-ai-pane">
                {#if sel && detail}
                    <!-- 三段详情（设计稿 .ai-detail；视图模型在 core/SessionDetail，
                         组件零判断）。换记录时整块重挂 ⇒ 全文展开态自然复位。 -->
                    {#key sel.id}
                        <SessionDetail view={detail} {t} onRetry={() => void ctl.retry(sel)} onDecide={gotoDecide} />
                    {/key}
                {:else}
                    <div class="wengu-ai-empty wengu-muted">{t("aiPickHint")}</div>
                {/if}
            </div>
        </div>
    </div>
{/if}
