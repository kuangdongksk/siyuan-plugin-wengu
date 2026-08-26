import type { WenguDoc } from "../types";
import { svgIcon } from "../ui/FormHtml";
import { esc, fmt, mmss } from "../ui/shared";

/**
 * 侧栏文档树（docs/variant-and-doctree.md §三 S1~S3）：WenguDoc[] 按
 * hPath 切分建树——中间路径是纯容器分支（点击折叠/展开，展开集合由
 * QuizView 持有并持久化 prefs.sideTreeOpen），叶子/有题节点挂文档行
 * （data-docid 点击开刷，事件在侧栏容器级委托，与旧平铺同款）。
 * 结构参考思源原生文档树（toggle 箭头展开旋转 90° + 子级容器缩进），
 * 类名自建 wengu-tree 只借结构，防内核升级 DOM 耦合。
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

export interface SideTreeRenderOpts {
    t: (key: string) => string;
    docId: string;
    /** 专题模式下文档行不亮（与旧平铺同款）。 */
    activeCollection: string;
    /** 展开的完整路径集合（默认只展开第一层=笔记本）。 */
    openPaths: ReadonlySet<string>;
}

/** 折叠箭头（有子级=按钮态可点，叶子=占位对齐）。 */
function toggleHtml(node: SideTreeNode, open: boolean): string {
    if (node.children.length === 0) return '<span class="wengu-tree-toggle"></span>';
    return `<span class="wengu-tree-toggle wengu-tree-toggle-btn${open ? " wengu-tree-open" : ""}" data-tree-path="${esc(
        node.path
    )}" title="${esc(node.name)}">${svgIcon("iconRight")}</span>`;
}

function docMeta(d: WenguDoc, t: (key: string) => string): string {
    return [
        fmt(t("exerciseCount"), { n: String(d.total) }),
        d.attempted > 0 ? fmt(t("drilledCount"), { a: String(d.attempted) }) : "",
        d.totalTime > 0 ? mmss(d.totalTime) : "",
    ]
        .filter(Boolean)
        .join(" · ");
}

function nodeHtml(node: SideTreeNode, o: SideTreeRenderOpts): string {
    const open = o.openPaths.has(node.path);
    const kids =
        node.children.length > 0
            ? `<div class="wengu-tree-children"${open ? "" : " hidden"}>${node.children
                  .map((c) => nodeHtml(c, o))
                  .join("")}</div>`
            : "";
    if (node.doc) {
        const active = node.doc.id === o.docId && !o.activeCollection ? " wengu-side-active" : "";
        return `<div class="wengu-tree-doc${active}" data-docid="${esc(node.doc.id)}" title="${esc(node.doc.hPath)}">
  ${toggleHtml(node, open)}
  <div class="wengu-tree-main">
    <div class="wengu-side-title">${esc(node.doc.title || node.doc.id)}</div>
    <div class="wengu-side-meta">${esc(docMeta(node.doc, o.t))}</div>
  </div>
</div>${kids}`;
    }
    return `<div class="wengu-tree-branch${open ? " wengu-tree-open" : ""}" data-tree-path="${esc(node.path)}">
  ${toggleHtml(node, open)}
  <span class="wengu-tree-name">${esc(node.name)}</span>
</div>${kids}`;
}

/** 整树渲染（无匹配文档时调用方给空态文案）。 */
export function renderSideTree(nodes: SideTreeNode[], o: SideTreeRenderOpts): string {
    return `<div class="wengu-tree">${nodes.map((n) => nodeHtml(n, o)).join("")}</div>`;
}
