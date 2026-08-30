<script lang="ts">
    import type { Snippet } from "svelte";
    import { svgIcon } from "./FormHtml";
    import type { TreeListNode } from "./TreeListTypes";
    import Self from "./TreeList.svelte";

    /**
     * 共享树行组件（20260830 抽取：知识面板树与文档选择器树此前类名
     * 同款、渲染与 CSS 却各写一份，观感各自漂移——收敛为同源渲染）。
     * 行壳 b3-list-item--narrow + wengu-tree toggle/缩进全局类，类名与
     * 迁移前逐字一致（通用行样式归 base.scss `.wengu-tree` 一份）。
     * 宿主自备 `<div class="wengu-tree">` 容器（选择器作用域+缩进辅助线）。
     * 递归=Self 自引用（svelte-migration §暗雷：Svelte 5 无 svelte:self）。
     * 节点契约在 ./TreeListTypes.ts（.ts 侧具名导入用）。
     */

    let {
        nodes,
        openKeys,
        current = "",
        selected,
        onrowclick,
        ontoggle,
        main,
        trailing,
    }: {
        nodes: TreeListNode[];
        /** 共享可变展开集合（宿主 $state 深代理，组件内增删即响应）。 */
        openKeys: Set<string>;
        /** 单选当前 id（行高亮）；多选/无选中不传。 */
        current?: string;
        /** 多选已选 id 集合（传了才渲染勾位）。 */
        selected?: ReadonlySet<string>;
        /** 文档/小节行体点击（分支行组件内部消化=折叠，箭头已断冒泡）。 */
        onrowclick?: (node: TreeListNode, e: MouseEvent) => void;
        /** 折叠切换后回调（key+最新集合；宿主持久化展开态用）。 */
        ontoggle?: (key: string, openKeys: Set<string>) => void;
        /** 行主内容自定义（缺省渲染单行 b3-list-item__text；刷题侧栏
         *  两行「标题+元信息」行用它替换）。 */
        main?: Snippet<[TreeListNode]>;
        /** 行尾自定义区（计数/动作钮等宿主内容），勾位之前。 */
        trailing?: Snippet<[TreeListNode]>;
    } = $props();

    const toggle = (key: string): void => {
        if (openKeys.has(key)) openKeys.delete(key);
        else openKeys.add(key);
        ontoggle?.(key, openKeys);
    };

    // 箭头点击 stopPropagation：分支行体本身也=折叠，不阻断会双触发相互
    // 抵消（旧知识面板暗病）；文档行则防误触行体动作
    const toggleArrow = (node: TreeListNode, e: MouseEvent): void => {
        e.stopPropagation();
        toggle(node.key);
    };

    const rowClass = (n: TreeListNode): string =>
        n.kind === "branch" ? "wengu-kp-branch" : n.kind === "sec" ? "wengu-kp-sec-row" : "wengu-kp-doc";
</script>

{#each nodes as n (n.key)}
    {@const open = openKeys.has(n.key)}
    {@const expandable = n.children.length > 0}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="b3-list-item b3-list-item--narrow {rowClass(n)}{n.hideAction
            ? ' b3-list-item--hide-action'
            : ''}{current && n.id && current === n.id ? ' b3-list-item--focus' : ''}"
        data-id={n.id}
        title={n.tip ?? n.name}
        onclick={(e) => {
            if (n.kind === "branch") toggle(n.key);
            else onrowclick?.(n, e);
        }}
    >
        {#if expandable}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
                class="wengu-tree-toggle wengu-tree-toggle-btn{open ? ' wengu-tree-open' : ''}"
                onclick={(e) => toggleArrow(n, e)}>{@html svgIcon("iconRight")}</span
            >
        {:else}
            <span class="wengu-tree-toggle"></span>
        {/if}
        {#if main}
            {@render main(n)}
        {:else}
            <span class="b3-list-item__text">{n.name}</span>
        {/if}
        {@render trailing?.(n)}
        {#if selected}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="b3-list-item__action{selected.has(n.id ?? '') ? '' : ' fn__none'}"
                >{@html svgIcon("iconCheck")}</span
            >
        {/if}
    </div>
    {#if open && expandable}
        <div class="wengu-tree-children">
            <Self nodes={n.children} {openKeys} {current} {selected} {onrowclick} {ontoggle} {main} {trailing} />
        </div>
    {/if}
{/each}
