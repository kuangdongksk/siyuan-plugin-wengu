<script lang="ts">
    import TreeList from "./TreeList.svelte";
    import type { TreeListNode } from "./TreeListTypes";
    import { buildPickerTree, type PickerDocLite, type PickerTreeNode } from "./PickerTree";

    /**
     * 文档选择器的树态根组件（KnowPicker 浮层内经 mountApp 挂载）：
     * 展开集合与多选勾选都在此组件内是响应态；浮层宿主（KnowPicker.ts）
     * 经实例导出读写勾选——平铺搜索结果行与「清空/确定」钮共用同一份
     * 事实源，不再手动同步勾位 DOM。展开集合默认第一层（笔记本级）。
     */
    let {
        docs,
        current = "",
        multi = false,
        initialSelected = [],
        onpick,
    }: {
        /** 全量文档（浮层打开时已拉定，生命周期内冻结）。 */
        docs: PickerDocLite[];
        /** 单选当前 docId（行高亮）。 */
        current?: string;
        /** 多选模式（勾位）；缺省单选（点行即 onpick）。 */
        multi?: boolean;
        /** 打开时已勾中的 docId（回显）。 */
        initialSelected?: string[];
        /** 单选点行即确认（宿主关浮层回传）。 */
        onpick?: (id: string) => void;
    } = $props();

    const toRows = (ns: PickerTreeNode[]): TreeListNode[] =>
        ns.map((n) => ({
            key: n.path,
            name: n.name,
            tip: n.doc ? n.doc.hpath : n.path,
            kind: n.doc ? "doc" : "branch",
            id: n.doc?.id,
            children: toRows(n.children),
        }));

    // docs 冻结：建树与展开种子只算一次，无需 $derived
    // svelte-ignore state_referenced_locally
    const rows = toRows(buildPickerTree(docs));
    const openKeys = $state(new Set<string>());
    for (const n of rows) if (n.children.length > 0) openKeys.add(n.key);

    // svelte-ignore state_referenced_locally
    const selected = $state(new Set<string>(initialSelected));

    /** 勾选切换（组件内点行与宿主平铺行共用）。 */
    export function toggleSelected(id: string): void {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
    }

    /** 清空勾选（浮层「清空」钮）。 */
    export function clearSelected(): void {
        selected.clear();
    }

    /** 当前勾选（浮层「确定」钮回传）。 */
    export const getSelected = (): string[] => Array.from(selected);

    const rowclick = (n: TreeListNode): void => {
        if (!n.id) return;
        if (!multi) {
            onpick?.(n.id);
            return;
        }
        toggleSelected(n.id);
    };
</script>

<div class="wengu-tree">
    <TreeList
        nodes={rows}
        {openKeys}
        current={multi ? "" : current}
        selected={multi ? selected : undefined}
        onrowclick={rowclick}
    />
</div>
