<script lang="ts">
    import { onMount, setContext } from "svelte";
    import type { QuizView } from "../../quiz";
    import { KNOW_PANEL_CTX, initialKnowPanelUi } from "../core/KnowPanelUi";
    import { KnowPanelCtl } from "../core/KnowPanelCtl";
    import { buildKnowTree } from "../ui/KnowledgePanel";
    import KnowTreeItem from "./KnowTreeItem.svelte";

    /**
     * 知识文档管理工作区面板根组件（四件套之一）：屏幕路由=phase 三态，
     * 树由 docs/info 现算（buildKnowTree）。旧实现折叠切换要 paintTree
     * 整树重绘（容器级委托 + openPaths 集合），现在 openPaths 进响应态，
     * 细粒度更新。挂载编排见 bank/index.ts mountKnowledgePanel。
     */
    let { v }: { v: QuizView } = $props();

    // svelte-ignore state_referenced_locally
    const t = v.t;
    const ui = $state(initialKnowPanelUi());
    // svelte-ignore state_referenced_locally
    const ctl = new KnowPanelCtl(ui, v);
    setContext(KNOW_PANEL_CTX, { ctl, ui, t });

    const treeNodes = $derived(buildKnowTree(ui.docs, ui.info));

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
        <div class="wengu-cp-list">
            {#if ui.docs.length}
                <div class="wengu-tree">
                    {#each treeNodes as n (n.path)}
                        <KnowTreeItem node={n} />
                    {/each}
                </div>
            {:else}
                <div class="wengu-muted">{t("knowEmpty")}</div>
            {/if}
        </div>
    </div>
{/if}
