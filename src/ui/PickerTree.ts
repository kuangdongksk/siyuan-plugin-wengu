import { esc } from "./shared";
import { svgIcon } from "./FormHtml";

/**
 * 文档选择器树（docs/variant-and-doctree.md §二 T1~T3）：全量文档按
 * hPath 切分建树，首段（笔记本）为纯容器根；默认树 + 关键词切平铺
 * （搜索行为在 KnowPicker 编排，本文件只管建树与渲染）。结构借思源
 * 文档树（toggle 箭头旋转 + 子级缩进），复用侧栏 wengu-tree 的
 * toggle/children 全局类，行壳走 b3-list-item 紧凑风。
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

export interface PickerTreeRenderOpts {
    /** 多选已选集合（勾选回显）。 */
    selected: ReadonlySet<string>;
    /** 单选当前值（行高亮）。 */
    current: string;
    /** 展开的完整路径集合。 */
    openPaths: ReadonlySet<string>;
}

function toggleHtml(node: PickerTreeNode, open: boolean): string {
    if (node.children.length === 0) return '<span class="wengu-tree-toggle"></span>';
    return `<span class="wengu-tree-toggle wengu-tree-toggle-btn${open ? " wengu-tree-open" : ""}" data-tree-path="${esc(
        node.path
    )}" title="${esc(node.name)}">${svgIcon("iconRight")}</span>`;
}

function nodeHtml(node: PickerTreeNode, o: PickerTreeRenderOpts, single: boolean): string {
    const open = o.openPaths.has(node.path);
    const kids =
        node.children.length > 0
            ? `<div class="wengu-tree-children"${open ? "" : " hidden"}>${node.children
                  .map((c) => nodeHtml(c, o, single))
                  .join("")}</div>`
            : "";
    if (node.doc) {
        const on = single ? o.current === node.doc.id : o.selected.has(node.doc.id);
        return `<div class="b3-list-item b3-list-item--narrow wengu-kp-doc${
            single && on ? " b3-list-item--focus" : ""
        }" data-id="${esc(node.doc.id)}" title="${esc(node.doc.hpath)}">
  ${toggleHtml(node, open)}
  <span class="b3-list-item__text">${esc(node.name)}</span>${
      single ? "" : `<span class="b3-list-item__action${on ? "" : " fn__none"}">${svgIcon("iconCheck")}</span>`
  }
</div>${kids}`;
    }
    return `<div class="b3-list-item b3-list-item--narrow wengu-kp-branch" data-tree-path="${esc(node.path)}" title="${esc(
        node.path
    )}">
  ${toggleHtml(node, open)}
  <span class="b3-list-item__text wengu-kp-branch-name">${esc(node.name)}</span>
</div>${kids}`;
}

/** 整树渲染（空树由调用方给空态）。 */
export function renderPickerTree(nodes: PickerTreeNode[], o: PickerTreeRenderOpts, single: boolean): string {
    return nodes.map((n) => nodeHtml(n, o, single)).join("");
}
