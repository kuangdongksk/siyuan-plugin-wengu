<script lang="ts">
    import { onMount, setContext } from "svelte";
    import type { QuizView } from "../../quiz";
    import { COL_PANEL_CTX, initialColPanelUi } from "../core/ColPanelUi";
    import { ColPanelCtl } from "../core/ColPanelCtl";
    import { buildColTree } from "../ui/CollectionPanel";
    import { svgIcon } from "../../ui/FormHtml";
    import ColTreeLevel from "./ColTreeLevel.svelte";

    /**
     * 专题清单区段（20260831 rail 合并 □4：原「专题管理」工作区面板
     * 整体降级为知识面板下半区的内嵌组件，操作逐项照搬——文件夹
     * 组织/改名/两击删除/按知识点收集/点击开刷）。四件套结构保留
     * （独立 ui/ctl/context），挂载由外层 KnowledgePanelApp 完成。
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
    <div class="wengu-know-cols"><div class="wengu-muted">{t("colEmpty")}</div></div>
{:else if ui.phase === "loading"}
    <div class="wengu-know-cols"><div class="wengu-muted">{t("loading")}</div></div>
{:else}
    <div class="wengu-know-cols">
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
