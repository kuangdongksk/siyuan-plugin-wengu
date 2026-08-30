<script lang="ts">
    import TreeList from "../../ui/TreeList.svelte";
    import type { TreeListNode } from "../../ui/TreeListTypes";

    /**
     * 刷题侧栏文档树宿主组件（TreeList 共享化 20260830）：数据/active/
     * 展开态全在组件内 $state，QuizView 侧经实例导出 update 驱动（整壳
     * innerHTML 重建的架构下每次重挂重灌，见 flow/SideTreeMount）。
     * 文档行是两行布局（标题+元信息，经 TreeList 的 main snippet 注入，
     * 元信息串在挂载侧预计算）；折叠经 ontoggle 回调持久化
     * prefs.sideTreeOpen，点文档行走 onOpen→selectDoc 整壳重载。
     */
    let {
        onOpen,
        onPersistOpen,
    }: {
        /** 点文档行=开刷该文档（复习模式=筛选错题本，由 selectDoc 分流）。 */
        onOpen(id: string): void;
        /** 折叠切换后持久化（回传最新展开路径全集）。 */
        onPersistOpen(open: string[]): void;
    } = $props();

    const ui = $state({
        rows: [] as TreeListNode[],
        /** 文档行元信息（docId → 预计算串，行渲染查表）。 */
        metas: new Map<string, string>(),
        active: "",
        activeCol: "",
    });
    const openKeys = $state(new Set<string>());

    /** 全量刷新（挂载/侧栏重灌时由 SideTreeMount 调）。 */
    export function update(
        rows: TreeListNode[],
        metas: Map<string, string>,
        active: string,
        activeCol: string,
        open: string[]
    ): void {
        ui.rows = rows;
        ui.metas = metas;
        ui.active = active;
        ui.activeCol = activeCol;
        openKeys.clear();
        for (const k of open) openKeys.add(k);
    }

    const rowclick = (n: TreeListNode): void => {
        if (n.id) onOpen(n.id);
    };
    const persist = (_key: string, keys: Set<string>): void => onPersistOpen([...keys]);
</script>

<div class="wengu-tree">
    <TreeList
        nodes={ui.rows}
        {openKeys}
        current={ui.activeCol ? "" : ui.active}
        onrowclick={rowclick}
        ontoggle={persist}
    >
        {#snippet main(n)}
            {#if n.id && ui.metas.has(n.id)}
                <div class="wengu-tree-main">
                    <div class="wengu-side-title">{n.name}</div>
                    <div class="wengu-side-meta">{ui.metas.get(n.id)}</div>
                </div>
            {:else}
                <span class="b3-list-item__text">{n.name}</span>
            {/if}
        {/snippet}
    </TreeList>
</div>
