<script lang="ts">
    import { getContext } from "svelte";
    import { KNOW_PANEL_CTX, type KnowPanelCtx } from "../core/KnowPanelUi";
    import { secKeyOf, type KnowTreeNode } from "../ui/KnowledgePanel";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import Self from "./KnowTreeItem.svelte";

    /**
     * 知识树节点（递归组件）：分支行 / 文档行 + 子级容器。类名与旧
     * 字符串模板逐字一致（样式在全局 base.scss/rail.scss）。折叠 key：
     * 分支=树路径、文档行箭头=小节容器（secKeyOf 后缀防撞）；子级
     * 容器=小节与嵌套子文档同一处（同 key），条件渲染=旧 hidden 切换。
     */
    let { node }: { node: KnowTreeNode } = $props();

    const { ctl, ui, t } = getContext<KnowPanelCtx>(KNOW_PANEL_CTX)!;

    const d = $derived(node.doc);
    const key = $derived(node.doc ? secKeyOf(node.path) : node.path);
    const expandable = $derived(node.children.length > 0 || (!!node.doc && node.doc.sections.length > 0));
    const open = $derived(ui.openPaths.has(key));

    const docTip = $derived.by(() => {
        if (!node.doc) return node.path;
        const tag = node.doc.manual ? ` · ${t("knowImportTag")}` : "";
        return `${node.doc.title}\n${fmt(t("knowSections"), { n: String(node.doc.sections.length) })} · ${fmt(
            t("knowQCount"),
            { n: String(node.doc.total) }
        )}${tag}`;
    });
</script>

{#if d}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="b3-list-item b3-list-item--narrow b3-list-item--hide-action wengu-kp-doc"
        title={docTip}
        onclick={(e) => {
            if (!(e.target as HTMLElement).closest("button")) ctl.open(d.docId);
        }}
    >
        {#if expandable}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
                class="wengu-tree-toggle wengu-tree-toggle-btn{open ? ' wengu-tree-open' : ''}"
                onclick={() => ctl.toggle(key)}>{@html svgIcon("iconRight")}</span
            >
        {:else}
            <span class="wengu-tree-toggle"></span>
        {/if}
        <span class="b3-list-item__text">{d.title}</span>
        <span class="wengu-cp-meta">{fmt(t("knowQCount"), { n: String(d.total) })}</span>
        <span class="b3-list-item__action">
            <button type="button" class="b3-button b3-button--text" onclick={() => ctl.match(d)}
                >{t("knowMatchBtn")}</button
            >
            <button type="button" class="b3-button b3-button--text" onclick={() => ctl.gen(d)}>{t("knowGenBtn")}</button
            >
            <button type="button" class="b3-button b3-button--text" onclick={() => ctl.related(d)}
                >{t("knowRelated")}</button
            >
            <button type="button" class="b3-button b3-button--text" onclick={() => ctl.open(d.docId)}
                >{t("knowOpen")}</button
            >
            {#if d.registered}
                <button type="button" class="b3-button b3-button--text" onclick={() => ctl.armRemove(d.docId)}
                    >{ui.rmArmed === d.docId ? t("collectConfirm") : t("knowRemoveBtn")}</button
                >
            {/if}
        </span>
    </div>
    {#if open}
        <div class="wengu-tree-children">
            {#each d.sections as s (s.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    class="b3-list-item b3-list-item--narrow wengu-kp-sec-row"
                    title={s.title}
                    onclick={() => ctl.open(s.id)}
                >
                    <span class="wengu-tree-toggle"></span>
                    <span class="b3-list-item__text">{s.title}</span>
                    <span class="wengu-cp-meta">{fmt(t("knowQCount"), { n: String(s.count) })}</span>
                </div>
            {/each}
            {#each node.children as c (c.path)}
                <Self node={c} />
            {/each}
        </div>
    {/if}
{:else}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="b3-list-item b3-list-item--narrow wengu-kp-branch{open ? ' wengu-tree-open' : ''}"
        title={node.path}
        onclick={() => ctl.toggle(node.path)}
    >
        {#if expandable}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
                class="wengu-tree-toggle wengu-tree-toggle-btn{open ? ' wengu-tree-open' : ''}"
                onclick={() => ctl.toggle(node.path)}>{@html svgIcon("iconRight")}</span
            >
        {:else}
            <span class="wengu-tree-toggle"></span>
        {/if}
        <span class="b3-list-item__text">{node.name}</span>
    </div>
    {#if open}
        <div class="wengu-tree-children">
            {#each node.children as c (c.path)}
                <Self node={c} />
            {/each}
        </div>
    {/if}
{/if}
