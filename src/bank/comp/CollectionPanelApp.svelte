<script lang="ts">
    import { onMount, setContext } from "svelte";
    import type { QuizView } from "../../quiz";
    import { COL_PANEL_CTX, initialColPanelUi } from "../core/ColPanelUi";
    import { ColPanelCtl } from "../core/ColPanelCtl";
    import { buildColTree } from "../ui/CollectionPanel";
    import { svgIcon } from "../../ui/FormHtml";
    import ColTreeLevel from "./ColTreeLevel.svelte";

    /**
     * 专题管理工作区面板根组件（四件套之一）：屏幕路由=phase 三态
     * （nobank/loading/ready），树由 rows/folders 现算。旧实现刷新即
     * innerHTML 全量重绘（折叠态重置）；现在折叠/编辑/确认态都在 ui，
     * 刷新只重赋数据。挂载编排见 bank/index.ts mountCollectionPanel。
     */
    let { v }: { v: QuizView } = $props();

    // svelte-ignore state_referenced_locally
    const t = v.t;
    // 深代理响应态：$state 只能在 Svelte 编译单元里创建（四件套约定）
    const ui = $state(initialColPanelUi());
    // svelte-ignore state_referenced_locally
    const ctl = new ColPanelCtl(ui, v);
    setContext(COL_PANEL_CTX, { ctl, ui, t });

    const tree = $derived(buildColTree(ui.rows, ui.folders));
    const empty = $derived(tree.rows.length + tree.children.length === 0);

    onMount(() => {
        void ctl.load();
        return () => ctl.destroy();
    });
</script>

{#if ui.phase === "nobank"}
    <div class="wengu-ws-page"><div class="wengu-muted">{t("colEmpty")}</div></div>
{:else if ui.phase === "loading"}
    <div class="wengu-ws-page"><div class="wengu-muted">{t("loading")}</div></div>
{:else}
    <div class="wengu-ws-page">
        <div class="wengu-ws-title">
            {t("colPanelTitle")}
            <span class="wengu-ws-titlebtns">
                <button type="button" class="b3-button b3-button--outline" onclick={() => ctl.openFolderInput("")}
                    >{@html svgIcon("iconAdd")} {t("colNewFolder")}</button
                >
                <button type="button" class="b3-button b3-button--outline" onclick={() => ctl.openCollectDialog()}
                    >{@html svgIcon("iconSparkles")} {t("colCollect")}</button
                >
                <button type="button" class="b3-button b3-button--text" onclick={() => void ctl.load()}
                    >{@html svgIcon("iconRefresh")}</button
                >
            </span>
        </div>
        <div class="wengu-col-list wengu-cp-list">
            <ul class="b3-list b3-list--background wengu-cp-tree">
                <ColTreeLevel rows={tree.rows} children={tree.children} depth={0} prefix="" />
            </ul>
            {#if empty}
                <div class="wengu-muted">{t("colEmpty")}</div>
            {/if}
        </div>
    </div>
{/if}
