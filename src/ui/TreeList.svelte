<script lang="ts">
    import type { Snippet } from "svelte";
    import type { SvelteSet } from "svelte/reactivity";
    import { svgIcon } from "./FormHtml";
    import type { TreeListNode } from "./TreeListTypes";
    import Self from "./TreeList.svelte";

    /**
     * 共享树行组件（20260830 抽取：知识面板树与文档选择器树此前类名
     * 同款、渲染与 CSS 却各写一份，观感各自漂移——收敛为同源渲染）。
     * 渲染结构对齐 SiYuan 自身目录树（与 src/bank/components/
     * ColTreeLevel.svelte 走同款 SiYuan 原生方案）：
     * - 顶层 `<ul class="b3-list b3-list--background">`，递归子项裸 `<ul>`
     * - 行壳 `<li class="b3-list-item">`（节点 hideAction 才补
     *   `--hide-action`——选择器勾位要常驻可见，不能全树 hover 才显）
     *   注入 `style={liVars(depth)}` 喂 SiYuan 原生
     *   `--file-toggle-width` / `--file-action-offset` 拖拽高亮留位
     * - toggle 用 `b3-list-item__toggle b3-list-item__toggle--hl` + SVG
     *   `b3-list-item__arrow`/`--open`；缩进在 toggle 上以
     *   `padding-left:${depth * INDENT}px` 表达（与 ColTreeLevel 同公式）
     * - 宿主自备 `<div class="wengu-tree">` 容器仅作 CSS 作用域；
     *   `.wengu-tree ul` 在 base.scss 清 UA 默认 list-style/padding
     * 递归=Self 自引用（svelte-migration §暗雷：Svelte 5 无 svelte:self）。
     * 节点契约在 ./TreeListTypes.ts（.ts 侧具名导入用）。
     */

    /** 每行缩进增量（与 ColTreeLevel 的 TOGGLE_INDENT 一致）。 */
    const INDENT = 18;

    /** SiYuan 原生 li 缩进变量；公式与 src/bank/ui/CollectionPanel.ts
     *  liVars 完全一致（深度 0 用 22/22，之后每层加 INDENT）。 */
    const liVars = (depth: number): string => {
        const w = depth === 0 ? 22 : 18 + depth * INDENT;
        return `--file-toggle-width:${w}px;--file-action-offset:${depth === 0 ? 22 : w + 2}px`;
    };

    let {
        nodes,
        openKeys,
        current = "",
        selected,
        onrowclick,
        ontoggle,
        main,
        trailing,
        topLevel = true,
        depth = 0,
    }: {
        nodes: TreeListNode[];
        /** 共享可变展开集合。必须 svelte/reactivity 的 SvelteSet（自带
         *  信号，组件内 add/delete 即重渲）：$state 不深代理 Set——裸
         *  Set 增删不触发任何更新，折叠全树失灵（20260831 踩坑），
         *  故此处类型收紧为 SvelteSet 由 tsc 把关。 */
        openKeys: SvelteSet<string>;
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
        /** 顶层调用=真，给最外层 ul 挂 b3-list b3-list--background；递归
         *  自调传 false，子项 ul 裸走（对齐 SiYuan data-effective-sort-mode
         *  那套）。缺省 true。 */
        topLevel?: boolean;
        /** 递归深度（顶层=0，每层 +1）；驱动 liVars 与 toggle 的
         *  padding-left，模拟 ColTreeLevel 的递归累加。缺省 0。 */
        depth?: number;
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
</script>

<ul class={topLevel ? "b3-list b3-list--background" : ""}>
    {#each nodes as n (n.key)}
        {@const open = openKeys.has(n.key)}
        {@const expandable = n.children.length > 0}
        {@const indentStyle = depth > 0 ? `padding-left:${depth * INDENT}px` : undefined}
        {@const focus = !!(current && n.id && current === n.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <li
            class="b3-list-item{n.hideAction ? ' b3-list-item--hide-action' : ''} wengu-kp-doc{focus
                ? ' b3-list-item--focus'
                : ''}"
            style={liVars(depth)}
            data-id={n.id}
            data-kind={n.kind}
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
                    class="b3-list-item__toggle b3-list-item__toggle--hl"
                    style={indentStyle}
                    onclick={(e) => toggleArrow(n, e)}
                    >{@html svgIcon(
                        "iconRight",
                        open ? "b3-list-item__arrow b3-list-item__arrow--open" : "b3-list-item__arrow"
                    )}</span
                >
            {:else}
                <span class="b3-list-item__toggle fn__hidden" style={indentStyle}></span>
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
        </li>
        {#if open && expandable}
            <Self
                depth={depth + 1}
                topLevel={false}
                nodes={n.children}
                {openKeys}
                {current}
                {selected}
                {onrowclick}
                {ontoggle}
                {main}
                {trailing}
            />
        {/if}
    {/each}
</ul>
