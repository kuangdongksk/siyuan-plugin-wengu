/**
 * TreeList 共享树组件的节点契约（src/ui/TreeList.svelte 消费）。
 * 单独放 .ts：*.svelte 的环境声明不带具名导出类型，.ts 侧（挂载/映射
 * 编排，如 quiz/flow/SideTreeMount）无法从 .svelte 具名导入。
 */
export interface TreeListNode {
    /** 展开/折叠 key（同树内唯一；展开集合由宿主持有传入）。 */
    key: string;
    name: string;
    tip?: string;
    /** 行种类：branch=路径分支（浅色小字、点行=折叠）；sec=小节行；
     * 缺省 doc=文档行（点行走 onrowclick）。 */
    kind?: "branch" | "doc" | "sec";
    /** 选中身份（单选高亮/多选勾比较用；行上带 data-id，右键委托可用）；
     * 缺省不参与选中。 */
    id?: string;
    /** 文档行动作区 hover 才显（b3-list-item--hide-action 兜底类）。 */
    hideAction?: boolean;
    children: TreeListNode[];
}
