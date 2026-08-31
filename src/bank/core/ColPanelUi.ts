import type { ColRowView } from "../ui/CollectionPanel";
import type { ColPanelCtl } from "./ColPanelCtl";

/**
 * 专题管理工作区面板的响应态形状（四件套之一，模式见
 * docs/svelte-migration.md）。树数据（rows/folders）进 ui 后由组件
 * $derived(buildColTree) 现算；折叠存反集（closedDirs）——默认全展开
 * 对齐旧首绘，且数据刷新不再丢折叠态（旧 innerHTML 重绘全重置）。
 */

/** 子组件经 context 取的载荷（树是递归组件，props 层级太深）。 */
export interface ColPanelCtx {
    ctl: ColPanelCtl;
    ui: ColPanelUi;
    t: (key: string) => string;
}

export const COL_PANEL_CTX = Symbol("wengu-col-panel");

export interface ColPanelUi {
    /** nobank=无题库（空态文案）、loading=装载中、ready=树可渲染。 */
    phase: "nobank" | "loading" | "ready";
    /** 全量专题行（buildColTree 的输入；reload 整体重赋值触发重绘）。 */
    rows: ColRowView[];
    /** 手动文件夹路径（BankData.folders，树化第二路输入）。 */
    folders: string[];
    /** 折叠中的目录路径集合（存反集：不在集合=展开，与旧默认全展开一致）。 */
    closedDirs: Set<string>;
    /** 行内改名编辑态（专题=完整标题、文件夹=完整路径；undefined=无）。 */
    editing: ColEditing | undefined;
    /** 两击确认删除的 key（专题 cid 或文件夹 path；3s 自动复位）。 */
    armed: string | undefined;
    /** 确认态文案（删文件夹时明示连带专题数；undefined=通用「确认」）。 */
    armedNote: string | undefined;
    /** 新建文件夹内联输入行（prefix 定位插入层级；undefined=无）。 */
    folderInput: ColFolderInput | undefined;
}

export interface ColEditing {
    kind: "col" | "dir";
    /** 专题 id 或文件夹完整路径（提交键）。 */
    key: string;
    /** 原值（Esc 复原/未改动短路）。 */
    origin: string;
}

export interface ColFolderInput {
    /** 父目录路径（空串=树顶层）。 */
    prefix: string;
    /** 插入行深度（缩进/箭头占位对齐同层子行）。 */
    depth: number;
}

/** 初始态（$state 包装在 ColListSection 内完成）。 */
export function initialColPanelUi(): ColPanelUi {
    return {
        phase: "loading",
        rows: [],
        folders: [],
        closedDirs: new Set(),
        editing: undefined,
        armed: undefined,
        armedNote: undefined,
        folderInput: undefined,
    };
}
