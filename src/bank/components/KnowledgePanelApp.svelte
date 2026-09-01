<script lang="ts">
    import { onMount, setContext } from "svelte";
    import type { QuizView } from "../../quiz";
    import { KNOW_PANEL_CTX, initialKnowPanelUi } from "../core/KnowPanelUi";
    import { KnowPanelCtl } from "../core/KnowPanelCtl";
    import {
        buildKnowTree,
        secKeyOf,
        type KnowDocView,
        type KnowSectionTreeView,
        type KnowTreeNode,
    } from "../ui/KnowledgePanel";
    import TreeList from "../../ui/TreeList.svelte";
    import type { TreeListNode } from "../../ui/TreeListTypes";
    import { fmt } from "../../ui/shared";

    /**
     * 知识工作区面板根组件（四件套之一）：屏幕路由=phase 三态，树由
     * docs/info 现算（buildKnowTree）。旧实现折叠切换要 paintTree 整树
     * 重绘，现在 openPaths 进响应态，细粒度更新；20260830 行渲染收敛
     * 共享组件 TreeList（与文档选择器同源，行尾计数/动作钮走 trailing
     * snippet，载荷经 key 回查表携带）。20260831 □3 小节节点行新增
     * 「开刷/补题」（活视图专题）。20260901 拆分：专题清单不再并入
     * 下半区（专题管理回独立工作区）。挂载编排见 bank/index.ts
     * mountKnowledgePanel。
     */
    let { v }: { v: QuizView } = $props();

    // svelte-ignore state_referenced_locally
    const t = v.t;
    const ui = $state(initialKnowPanelUi());
    // svelte-ignore state_referenced_locally
    const ctl = new KnowPanelCtl(ui, v);
    setContext(KNOW_PANEL_CTX, { ctl, ui, t });

    const docTip = (d: KnowDocView): string => {
        const n = (function count(ns: KnowSectionTreeView[]): number {
            return ns.reduce((a, s) => a + 1 + count(s.children), 0);
        })(d.sectionTree);
        const tag = d.manual ? ` · ${t("knowImportTag")}` : "";
        return `${d.title}\n${fmt(t("knowSections"), { n: String(n) })} · ${fmt(t("knowQCount"), {
            n: String(d.total),
        })}${tag}`;
    };

    /** 结构单薄判定（AI 建树入口只对它显示）：小节总数 <6 或顶层 <3
     *  ——无标题结构的讲义章节、树文档（结构丰富）自动分流。 */
    const secCount = (ns: KnowSectionTreeView[]): number => ns.reduce((a, s) => a + 1 + secCount(s.children), 0);
    const outlineable = (d: KnowDocView): boolean =>
        !!d.manual && (secCount(d.sectionTree) < 6 || d.sectionTree.length < 3);

    /** 小节树节点 → 通用树行（嵌套子节递归；节点本身 kind=sec 可点）。 */
    const secRows = (ns: KnowSectionTreeView[], secByKey: Map<string, KnowSectionTreeView>): TreeListNode[] =>
        ns.map((s): TreeListNode => {
            secByKey.set(s.id, s);
            return { key: s.id, name: s.title, tip: s.title, kind: "sec", children: secRows(s.children, secByKey) };
        });

    /** KnowTreeNode → 通用树行：分支 key=树路径，文档行 key=小节容器
     * （secKeyOf 后缀防撞，折叠语义同旧实现）；小节树插在文档子级头部。
     *  分支节点的子树题数 subTotal 也登记进 branchByKey——父文档/分支
     *  自身没直接关联题、但子文档有题时，trailing 显示累计覆盖量。 */
    const toRows = (
        ns: KnowTreeNode[],
        docByKey: Map<string, KnowDocView>,
        secByKey: Map<string, KnowSectionTreeView>,
        branchByKey: Map<string, number>
    ): TreeListNode[] =>
        ns.map((n): TreeListNode => {
            if (!n.doc) {
                // 分支也要递归子级：嵌套路径的知识文档挂在无文档分支下
                // （20260831 修复：此前 children:[] 把整棵子树丢掉不渲染）
                branchByKey.set(n.path, n.subTotal);
                return {
                    key: n.path,
                    name: n.name,
                    tip: n.path,
                    kind: "branch",
                    children: toRows(n.children, docByKey, secByKey, branchByKey),
                };
            }
            const key = secKeyOf(n.path);
            docByKey.set(key, n.doc);
            branchByKey.set(key, n.subTotal); // 文档行也登记子树汇总——自身有题且挂子文档时，显示累计覆盖量
            return {
                key,
                name: n.doc.title,
                tip: docTip(n.doc),
                kind: "doc",
                hideAction: true,
                children: [
                    ...secRows(n.doc.sectionTree, secByKey),
                    ...toRows(n.children, docByKey, secByKey, branchByKey),
                ],
            };
        });

    const tree = $derived.by(() => {
        const docByKey = new Map<string, KnowDocView>();
        const secByKey = new Map<string, KnowSectionTreeView>();
        const branchByKey = new Map<string, number>();
        const rows = toRows(buildKnowTree(ui.docs, ui.info), docByKey, secByKey, branchByKey);
        return { rows, docByKey, secByKey, branchByKey };
    });

    const rowclick = (n: TreeListNode, e: MouseEvent): void => {
        if ((e.target as HTMLElement).closest("button")) return; // 动作钮不触发打开
        const s = tree.secByKey.get(n.key);
        if (s) {
            ctl.open(s.id);
            return;
        }
        const d = tree.docByKey.get(n.key);
        if (d) ctl.open(d.docId);
    };

    onMount(() => {
        void ctl.load();
        return () => ctl.destroy();
    });
</script>

{#if ui.phase === "nobank"}
    <div class="wengu-ws-page"><div class="wengu-muted">{t("knowEmpty")}</div></div>
{:else if ui.phase === "loading"}
    <div class="wengu-ws-page"><div class="wengu-muted">{t("loading")}</div></div>
{:else}
    <div class="wengu-ws-page">
        <div class="wengu-ws-title">
            {t("knowPanelTitle")}
            <span class="wengu-ws-titlebtns">
                <button type="button" class="b3-button b3-button--outline" onclick={() => ctl.batchLink()}
                    >{t("knowBatchBtn")}</button
                >
                <button
                    type="button"
                    class="b3-button b3-button--outline"
                    onclick={(e) => ctl.importRoots(e.currentTarget)}>{t("knowImportBtn")}</button
                >
                <button type="button" class="b3-button b3-button--text" onclick={() => void ctl.load()}
                    >{t("quizRefresh")}</button
                >
            </span>
        </div>
        <div class="wengu-muted" style="margin-bottom:8px">{t("knowHint")}</div>
        {#if ui.outlineErr}<div class="wengu-status wengu-status-err" style="margin-bottom:8px">
                {ui.outlineErr}
            </div>{/if}
        <div class="wengu-cp-list">
            {#if ui.docs.length}
                <div class="wengu-tree">
                    <TreeList nodes={tree.rows} openKeys={ui.openPaths} onrowclick={rowclick}>
                        {#snippet trailing(n)}
                            {@const d = tree.docByKey.get(n.key)}
                            {@const s = tree.secByKey.get(n.key)}
                            {@const bsub = tree.branchByKey.get(n.key)}
                            {#if s}
                                {#if ui.staleSecs.has(s.id)}<span class="wengu-cp-meta wengu-know-stale"
                                        >{t("knowSecStale")}</span
                                    >{/if}
                                <span class="wengu-cp-meta">{fmt(t("knowQCount"), { n: String(s.count) })}</span>
                                <span class="b3-list-item__action">
                                    <button
                                        type="button"
                                        class="b3-button b3-button--text"
                                        title={t("knowDrillNodeTip")}
                                        onclick={() => ctl.drillNode(s)}>{t("knowDrillNode")}</button
                                    >
                                    <button
                                        type="button"
                                        class="b3-button b3-button--text"
                                        title={t("knowGenNodeTip")}
                                        onclick={() => ctl.genNode(s)}>{t("knowGenNode")}</button
                                    >
                                </span>
                            {:else if d}
                                <span class="wengu-cp-meta">{fmt(t("knowQCount"), { n: String(bsub ?? d.total) })}</span>
                                <span class="b3-list-item__action">
                                    {#if outlineable(d)}
                                        <button
                                            type="button"
                                            class="b3-button b3-button--text"
                                            onclick={() => ctl.outline(d)}
                                            >{ui.outlining === d.docId
                                                ? t("knowOutlineRunning")
                                                : t("knowOutlineBtn")}</button
                                        >
                                    {/if}
                                    <button type="button" class="b3-button b3-button--text" onclick={() => ctl.match(d)}
                                        >{t("knowMatchBtn")}</button
                                    >
                                    <button type="button" class="b3-button b3-button--text" onclick={() => ctl.gen(d)}
                                        >{t("knowGenBtn")}</button
                                    >
                                    <button
                                        type="button"
                                        class="b3-button b3-button--text"
                                        onclick={() => ctl.related(d)}>{t("knowRelated")}</button
                                    >
                                    <button
                                        type="button"
                                        class="b3-button b3-button--text"
                                        onclick={() => ctl.open(d.docId)}>{t("knowOpen")}</button
                                    >
                                    <button
                                        type="button"
                                        class="b3-button b3-button--text"
                                        onclick={() => ctl.armDelete(d.docId)}
                                        >{ui.dlArmed === d.docId ? t("collectConfirm") : t("knowDeleteBtn")}</button
                                    >
                                    {#if d.registered}
                                        <button
                                            type="button"
                                            class="b3-button b3-button--text"
                                            onclick={() => ctl.armRemove(d.docId)}
                                            >{ui.rmArmed === d.docId ? t("collectConfirm") : t("knowRemoveBtn")}</button
                                        >
                                    {/if}
                                </span>
                            {:else if bsub}
                                <span class="wengu-cp-meta">{fmt(t("knowQCount"), { n: String(bsub) })}</span>
                            {/if}
                        {/snippet}
                    </TreeList>
                </div>
            {:else}
                <div class="wengu-muted">{t("knowEmpty")}</div>
            {/if}
        </div>
    </div>
{/if}
