/**
 * 文档选择器树·建树（docs/variant-and-doctree.md §二 T1~T3）：全量文档
 * 按 hPath 切分建树，首段（笔记本）为纯容器根。渲染已收敛共享组件
 * TreeList（挂 KnowPickerApp，20260830），本文件只剩纯建树逻辑。
 */

export interface PickerDocLite {
    id: string;
    hpath: string;
}

export interface PickerTreeNode {
    /** 完整路径（唯一 key，展开集合/折叠事件都带它）。 */
    path: string;
    name: string;
    /** 该路径对应真实文档时挂（笔记本根/中间无文档段不挂）。 */
    doc?: PickerDocLite;
    children: PickerTreeNode[];
}

/** hPath 切分建树；同路径撞名（同步冲突等罕见场景）多余的文档
 * 以同名子行挂载，不静默丢失。 */
export function buildPickerTree(docs: PickerDocLite[]): PickerTreeNode[] {
    const roots: PickerTreeNode[] = [];
    const byPath = new Map<string, PickerTreeNode>();
    for (const d of docs) {
        const segs = (d.hpath || "").split("/").filter(Boolean);
        if (!segs.length) continue;
        let siblings = roots;
        let path = "";
        segs.forEach((seg, i) => {
            path = `${path}/${seg}`;
            let node = byPath.get(path);
            if (!node) {
                node = { path, name: seg, children: [] };
                byPath.set(path, node);
                siblings.push(node);
            }
            siblings = node.children;
            if (i === segs.length - 1) {
                if (!node.doc) node.doc = d;
                else {
                    const dup: PickerTreeNode = { path: `${path}#${d.id}`, name: seg, doc: d, children: [] };
                    byPath.set(dup.path, dup);
                    siblings.push(dup);
                }
            }
        });
    }
    const sortRec = (nodes: PickerTreeNode[]): void => {
        nodes.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
        for (const n of nodes) sortRec(n.children);
    };
    sortRec(roots);
    return roots;
}
