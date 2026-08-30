<script lang="ts">
    import { getContext } from "svelte";
    import { COL_PANEL_CTX, type ColPanelCtx } from "../core/ColPanelUi";
    import {
        countCols,
        fmtTime,
        liVars,
        TOGGLE_INDENT,
        type ColRowView,
        type ColTreeNode,
    } from "../ui/CollectionPanel";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import Self from "./ColTreeLevel.svelte";

    /**
     * 专题树的一层（官方文档树同款 DOM：li 行壳 + 兄弟 ul 子级，类名与
     * 旧字符串模板逐字一致，样式在全局 rail.scss）。一层内的行与子目录
     * 按名混排；文件夹行的子 ul 条件渲染=折叠（旧 fn__none 切换的等价
     * 声明式）。新建文件夹的内联输入行插在所属层头部（prefix 定位）。
     */
    let {
        rows,
        children,
        depth,
        prefix,
    }: { rows: ColRowView[]; children: ColTreeNode[]; depth: number; prefix: string } = $props();

    const { ctl, ui, t } = getContext<ColPanelCtx>(COL_PANEL_CTX)!;

    type Item = { kind: "row"; name: string; r: ColRowView } | { kind: "dir"; name: string; c: ColTreeNode };
    const items = $derived(
        [
            ...rows.map((r): Item => ({ kind: "row", name: r.name, r })),
            ...children.map((c): Item => ({ kind: "dir", name: c.name, c })),
        ].sort((a, b) => a.name.localeCompare(b.name, "zh"))
    );

    const editingCol = $derived(ui.editing?.kind === "col" ? ui.editing : undefined);
    const editingDir = $derived(ui.editing?.kind === "dir" ? ui.editing : undefined);

    const rowTip = (r: ColRowView): string => {
        const stat = r.stat.lastAt
            ? `${t("colLastDrill")} ${fmtTime(r.stat.lastAt)} · ${Math.round(
                  (r.stat.correct / Math.max(1, r.stat.answered)) * 100
              )}%`
            : t("colNever");
        return `${r.title}\n${fmt(t("collectionCount"), { n: String(r.count) })} · ${stat}`;
    };

    // 暗雷 §5：编辑态/新建行的输入框出现即聚焦（对齐旧 DOM 重灌后手动 focus）
    function focusSelect(node: HTMLInputElement): void {
        node.focus();
        node.select();
    }
    function focusInput(node: HTMLInputElement): void {
        node.focus();
    }
</script>

{#if ui.folderInput?.prefix === prefix}
    {@const fi = ui.folderInput}
    <li class="b3-list-item" style={liVars(fi.depth)}>
        <span
            class="b3-list-item__toggle fn__hidden"
            style={fi.depth > 0 ? `padding-left:${fi.depth * TOGGLE_INDENT}px` : undefined}
        ></span>
        <span class="b3-list-item__icon">{@html svgIcon("iconFolder")}</span>
        <input
            class="b3-text-field fn__flex-1"
            style="min-width:0"
            placeholder={t("colFolderPh")}
            use:focusInput
            onkeydown={(e) => {
                if (e.key === "Enter") void ctl.confirmFolderEl(e.currentTarget);
                if (e.key === "Escape") ctl.closeFolderInput();
            }}
            onblur={() => ctl.closeFolderInput()}
        />
    </li>
{/if}
{#each items as it (it.kind === "row" ? it.r.id : it.c.path)}
    {#if it.kind === "row"}
        {@const r = it.r}
        <li class="b3-list-item b3-list-item--hide-action" style={liVars(depth)}>
            <span
                class="b3-list-item__toggle fn__hidden"
                style={depth > 0 ? `padding-left:${depth * TOGGLE_INDENT}px` : undefined}
            ></span>
            <span class="b3-list-item__icon">{@html svgIcon("iconList")}</span>
            {#if editingCol && editingCol.key === r.id}
                <span class="b3-list-item__text wengu-cp-name wengu-cp-editing">
                    <input
                        class="b3-text-field fn__flex-1"
                        style="min-width:0"
                        value={editingCol.origin}
                        use:focusSelect
                        onkeydown={(e) => {
                            if (e.key === "Enter") void ctl.commitRenameEl(e.currentTarget);
                            if (e.key === "Escape") ctl.cancelEdit();
                        }}
                        onblur={(e) => void ctl.commitRenameEl(e.currentTarget)}
                    />
                </span>
            {:else}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                    class="b3-list-item__text b3-tooltips b3-tooltips__e wengu-cp-name"
                    aria-label={rowTip(r)}
                    onclick={() => ctl.openCollection(r.id)}>{r.name}</span
                >
            {/if}
            <span class="counter">{r.count}</span>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
                class="b3-list-item__action b3-tooltips b3-tooltips__w"
                aria-label={t("colRename")}
                onclick={() => ctl.startRenameCol(r)}>{@html svgIcon("iconEdit")}</span
            >
            {#if ui.armed === r.id}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                    class="b3-list-item__action b3-tooltips b3-tooltips__w wengu-cp-armed"
                    onclick={() => ctl.armDeleteCol(r.id)}>{t("collectConfirm")}</span
                >
            {:else}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                    class="b3-list-item__action b3-tooltips b3-tooltips__w"
                    aria-label={t("collectDelete")}
                    onclick={() => ctl.armDeleteCol(r.id)}>{@html svgIcon("iconTrashcan")}</span
                >
            {/if}
        </li>
    {:else}
        {@const c = it.c}
        {@const open = !ui.closedDirs.has(c.path)}
        <li class="b3-list-item b3-list-item--hide-action" style={liVars(depth)}>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
                class="b3-list-item__toggle b3-list-item__toggle--hl"
                style={depth > 0 ? `padding-left:${depth * TOGGLE_INDENT}px` : undefined}
                onclick={() => ctl.toggleDir(c.path)}
                >{@html svgIcon(
                    "iconRight",
                    open ? "b3-list-item__arrow b3-list-item__arrow--open" : "b3-list-item__arrow"
                )}</span
            >
            <span class="b3-list-item__icon">{@html svgIcon("iconFolder")}</span>
            {#if editingDir && editingDir.key === c.path}
                <span class="b3-list-item__text wengu-cp-name wengu-cp-editing">
                    <input
                        class="b3-text-field fn__flex-1"
                        style="min-width:0"
                        value={editingDir.origin}
                        use:focusSelect
                        onkeydown={(e) => {
                            if (e.key === "Enter") void ctl.commitRenameEl(e.currentTarget);
                            if (e.key === "Escape") ctl.cancelEdit();
                        }}
                        onblur={(e) => void ctl.commitRenameEl(e.currentTarget)}
                    />
                </span>
            {:else}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                    class="b3-list-item__text b3-tooltips b3-tooltips__e wengu-cp-name"
                    aria-label={c.path}
                    onclick={() => ctl.toggleDir(c.path)}>{c.name}</span
                >
            {/if}
            <span class="counter">{countCols(c)}</span>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
                class="b3-list-item__action b3-tooltips b3-tooltips__w"
                aria-label={t("colNewSub")}
                onclick={() => ctl.openFolderInput(c.path)}>{@html svgIcon("iconAdd")}</span
            >
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
                class="b3-list-item__action b3-tooltips b3-tooltips__w"
                aria-label={t("colRename")}
                onclick={() => ctl.startRenameDir(c)}>{@html svgIcon("iconEdit")}</span
            >
            {#if ui.armed === c.path}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                    class="b3-list-item__action b3-tooltips b3-tooltips__w wengu-cp-armed"
                    onclick={() => ctl.armDeleteDir(c.path)}>{t("collectConfirm")}</span
                >
            {:else}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                    class="b3-list-item__action b3-tooltips b3-tooltips__w"
                    aria-label={t("colDelFolder")}
                    onclick={() => ctl.armDeleteDir(c.path)}>{@html svgIcon("iconTrashcan")}</span
                >
            {/if}
        </li>
        {#if open}
            <ul>
                <Self rows={c.rows} children={c.children} depth={depth + 1} prefix={c.path} />
            </ul>
        {/if}
    {/if}
{/each}
