import type { WenguDoc } from "../../types";

/**
 * 刷题侧栏文档树·建树（docs/variant-and-doctree.md §三 S1~S3）：
 * WenguDoc[] 按 hPath 切分建树——中间路径是纯容器分支，叶子/有题
 * 节点挂文档行（父文档自身带题则行兼作文档行）。渲染收敛共享组件
 * TreeList（6-5 起由 SidePanelApp 内嵌），本文件只剩纯建树逻辑；
 * 展开集合由 QuizView 持有并持久化 prefs.sideTreeOpen。
 */

export interface SideTreeNode {
    /** 完整路径（唯一 key，展开集合/折叠事件都带它）。 */
    path: string;
    name: string;
    /** 该路径有对应习题文档时挂（父文档自身带题则行兼作文档行）。 */
    doc?: WenguDoc;
    children: SideTreeNode[];
}

/** hPath 切分建树（路径去重挂 Map；分支同名不同层天然隔离）。 */
export function buildSideTree(docs: WenguDoc[]): SideTreeNode[] {
    const roots: SideTreeNode[] = [];
    const byPath = new Map<string, SideTreeNode>();
    for (const d of docs) {
        const segs = (d.hPath || d.title || d.id).split("/").filter(Boolean);
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
            if (i === segs.length - 1) node.doc = d;
        });
    }
    const sortRec = (nodes: SideTreeNode[]): void => {
        nodes.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
        for (const n of nodes) sortRec(n.children);
    };
    sortRec(roots);
    return roots;
}
