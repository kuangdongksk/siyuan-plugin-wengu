<script lang="ts">
    import { onMount, setContext } from "svelte";
    import type { QuizView } from "../../quiz";
    import { SESSION_PANEL_CTX, initialSessionPanelUi } from "../core/SessionPanelUi";
    import { SessionPanelCtl } from "../core/SessionPanelCtl";
    import { buildSessionTree, groupRowName } from "../core/SessionTree";
    import { detailViewOf } from "../core/SessionDetail";
    import { decideEntryOf, flowOwnershipOf, ownershipSegsOf } from "../core/FlowOwnership";
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
     *
     * **照施工规格精修（Issue #92，`design/aipanel-gap-list.md` 权威修法）**：
     *  - **一体卡（S1/S2）**：`.wengu-aipanel` 用稿的 grid（292px + 1fr、卡面 +
     *    1px 边线 + 12px 圆角 + overflow:hidden），横幅 FlowBanner 移入卡内作
     *    跨栏首行（组件根 `.wengu-aiflow` 自身已无圆角/外围边框）；
     *  - **树列（S3/S4）：292px 列宽由 grid 接管（`.wengu-ai-side` 的固定宽
     *    与裸 max-height 一并删），树列吃凹槽底 + 右边线 + 上下 padding；
     *    长清单收**列内滚动窗**（整页不滚动，Issue #96 / #146）；
     *  - **行尾三件化（S5）**：叶行 = 点 + 任务名 + 徽标贴右，**行尾不常驻
     *    时间戳**（选中后详情日志首列即 HH:MM:SS），组行「N 条 · 时间」meta
     *    删，删除钮退回 hover 显隐（rail.scss 既有口径）；
     *  - **详情（S7/S8）**：详情头删常驻 meta 串（模型名折进 h3 的 title），
     *    状态徽标贴右；主体（`.wengu-aipanel-dbody`）自身不设滚动窗——滚动交
     *    **列**（`.wengu-aipanel-pane` 的内滚窗，Issue #96 / #146）。
     *    kinds 过滤条与 hint 留在卡外（S9 已拍板的取舍：卡内只留三件）。
     *
     * **行尾弱注记（间隙期形态）**：叶行**不常驻**时间戳（gap-list S5）——
     * 时间在选中后的详情日志首列。执行期发现登记簿只有记录级
     * `createdAt`/`endedAt` 两个时刻，「显示当前选中记录的时刻」会给出
     * **假时刻**（用户在 14:20 的运行中点开一条 09-12 的旧记录，行上显示的
     * 不是它的时间），故落点在**未选中**时出「记录时间 · 类别」组合注记
     * （与详情头的 kind 徽标同源、恒正确），选中即整行让位给详情。删除钮仍
     * hover 才显（rail.scss 既有口径），不占常驻视觉位。
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

    /** 两位补零（时间戳注记用）。 */
    const p2 = (n: number): string => String(n).padStart(2, "0");

    const modelNames = new Map(listAiModels().map((m) => [m.id, m.name]));
    /** 模型显示名：设计稿 detail-head **无**「时间 · 模型」meta 串（gap-list
     *  S7），模型名折进 h3 的 `title` 悬停可见——信息不丢，常驻视觉位不占。 */
    const modelName = (id: string): string => modelNames.get(id) ?? (id || t("aiModelDefault"));

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
            ownNote: sel ? ownershipSegsOf(t, flowOwnershipOf(sel)) : [],
            decidable: sel ? decideEntryOf(flowOwnershipOf(sel)) : false,
        })
    );
    /** 树头组数徽标（设计稿 badge--plain「3 组」）。稿的语义是**种类数**
     *  （顶层一类一棵树）；单条种类不设层（叶子直接上提为顶层节点）时会数少，
     *  故按登记记录的**去重类别数**算——「3 组」在树里恒有 3 个可辨识的组，
     *  不留空壳层也数得准。 */
    const groupCount = $derived(new Set(ui.recs.map((r) => r.kind)).size);

    /** 行尾注记的时刻格式（MM-DD HH:MM，mono 弱注记位）。 */
    const rowStamp = (ts: number): string => {
        const d = new Date(ts);
        return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    };

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
    <!-- 面板页根 = 「卡外件固定高 + 卡吃剩余高」（Issue #96 / #146 高度链的
         中间一环）：标题/hint/kinds 过滤条 flex:none 钉在视野里，长清单与长
         详情收在卡内两列各自的滚动窗里——宿主主区不出页面级滚动条（宿主档
         `.wengu-ws-main--fit` 由 ai/SessionPanel.ts 的 fitHost 在挂载/卸载处
         配对开关，规则见 scss/rail.scss 与 scss/aipanel.scss）。 -->
    <div class="wengu-ws-page wengu-aipage">
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

        <!-- kinds 过滤条与 hint 留在**卡外**（设计稿 S9 取舍：卡内只有
             「横幅 + 树 + 详情」三件纯度），故在卡壳之前。 -->
        <!-- 选中态是**一等公民 chip**、不是主操作（规范 `docs/design-spec.md` §2.3）：
             原 `variant={sel ? "main" : "outline"}` 落在 `b3-button--main` 这条
             **不存在的类**上 ⇒ 选中与未选中视觉无差；改用 `variant="outline"`
             打底 + `wengu-chip-on` 覆写（浅底 + 主色字 + 主色描边），与
             `.wengu-col-armed` 同族复用既有的「主题色语言」，且与面板里
             真正的主操作（详情错误态「重试」）明确区分。 -->
        <div class="wengu-ai-kinds">
            <Button
                type="button"
                variant="outline"
                class={ui.filter === "" ? "wengu-chip-on" : ""}
                onclick={() => ctl.setFilter("")}>{t("aiKindAll")}</Button
            >
            {#each kinds as k (k)}
                <Button
                    type="button"
                    variant="outline"
                    class={ui.filter === k ? "wengu-chip-on" : ""}
                    onclick={() => ctl.setFilter(k)}>{kindLabel(k)}</Button
                >
            {/each}
        </div>

        <!-- 一体卡（稿 .ai-panel，gap-list S1/S2）：横幅是卡内**跨栏首行**，
             下面 grid 两栏 = 树 292px + 详情 1fr。无在途流时横幅整条不渲染
             （那行高度自然归 0，两栏顶到卡首，无需 is-plain 分支）。 -->
        <!-- data-ai-panel：卡壳的稳定钩子（真机验收脚本/样式探针按它取卡，
             不依赖类名耦合；面板只此一处）。 -->
        <div class="wengu-aipanel" data-ai-panel>
            <!-- 流级横幅（Issue #77 / #85）：多调用流的停止唯一入口；无在途流时整条不渲染 -->
            <FlowBanner {t} onDecide={() => v.convertAccess.revealConvertBar()} />

            <div class="wengu-aipanel-tree">
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
                                        <!-- 组行（设计稿 tg1/tg2）=「caret + 名字」两件，
                                             **不渲染色点**（Issue #88 复审 + gap-list S5）：
                                             ① 设计稿的色点/徽标只属叶子行 `.leaf`（spec 6.2 的
                                                `.tg1`/`.tg2` 规则里没有任何 dot）；
                                             ② 组行的聚合状态是**状态词**（running/done/error），
                                                与色名族（run/done/fail）不同名，拼 `is-{status}`
                                                只会拼出无规则的死类 ⇒ 那个 8px 空位还会把 A1 的
                                                正文起点 14/27px 顶到 29/42px。
                                             组内状态由叶子行的点/徽标逐条表达，不聚合到组行。 -->
                                        <!-- 组行字色/字号分两档（gap-list A2/A3），走 rail.scss 的
                                             `.wengu-ai-name` 基类 + 本面板的 is-group/is-tg1 档：
                                             种类行（tg1，无 subject）12px + 字距；
                                             主题组行（tg2）12.5px；两者同为 muted 色 -->
                                        <span class="wengu-ai-name is-group{b.subject ? '' : ' is-tg1'}"
                                            >{groupRowName(b.kind, b.subject, kindLabel)}</span
                                        >
                                    {:else}
                                        {@const lv = tree.leafViewByKey.get(n.key)}
                                        <!-- 叶子行（设计稿 leaf）= 状态点 + 任务名 + 状态徽标（贴右）；
                                             行尾**不常驻时间戳**（时间已在详情头），
                                             40 条记录一眼看出哪批失败哪批成功 -->
                                        <span class="wengu-aipanel-dot is-{lv?.dotCls ?? 'done'}"></span>
                                        <span class="wengu-ai-name is-leaf">{lv?.name ?? n.name}</span>
                                        <!-- 行尾弱注记（**仅未选中时**，见头注释「行尾弱注记」）：
                                             时间取记录级真实时刻 + 类别章，选中后整行让位给详情 -->
                                        {#if ui.selId !== n.id}
                                            <span class="wengu-aipanel-meta"
                                                >{fmt(t("aiRowMeta"), {
                                                    time: rowStamp(tree.recByKey.get(n.key)?.createdAt ?? 0),
                                                    kind: kindLabel(tree.recByKey.get(n.key)?.kind ?? ""),
                                                })}</span
                                            >
                                        {/if}
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
                                        <!-- 种类级不配删除（误击会清整类）；文档级两击删该文档全部记录。
                                             删除钮属功能件：hover 才显（rail.scss 既有口径），不占常驻视觉位 -->
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

            <div class="wengu-aipanel-pane">
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
