import type { KnowDocView } from "../ui/KnowledgePanel";
import type { KnowPanelCtl } from "./KnowPanelCtl";
import { SvelteSet } from "svelte/reactivity";

/**
 * 知识文档面板的响应态形状（四件套之一，模式见 docs/svelte-migration.md）。
 * docs/info 是树化源数据（组件 $derived(buildKnowTree) 现算）；openPaths
 * 持折叠状态——旧实现装载后重置为「分支全开、小节收起」，保持同语义。
 * 集合类响应成员必须用 svelte/reactivity 的 SvelteSet/SvelteMap：$state
 * 深代理只覆盖普通对象/数组，Set/Map 类实例增删不触发更新（20260831
 * 知识树折叠失灵的根因）。
 */

/** 子组件经 context 取的载荷（树是递归组件）。 */
export interface KnowPanelCtx {
    ctl: KnowPanelCtl;
    ui: KnowPanelUi;
    t: (key: string) => string;
}

export const KNOW_PANEL_CTX = Symbol("wengu-know-panel");

export interface KnowPanelUi {
    /** nobank=无题库（空态文案）、loading=装载中、ready=树可渲染。 */
    phase: "nobank" | "loading" | "ready";
    /** 合并后的知识文档行（推导 × 手动导入，mergeKnowDocs 产物）。 */
    docs: KnowDocView[];
    /** docId → 标题/hPath（树化分支与 tooltip 用）。 */
    info: Map<string, { title: string; hPath: string }>;
    /** 展开集合：分支 key=树路径、文档小节容器 key=secKeyOf(path)。 */
    openPaths: SvelteSet<string>;
    /** 「移除」两击确认中的 docId（3s 自动复位）。 */
    rmArmed: string | undefined;
    /** 内容已变更的小节（标题块 id）：装载后台 diffDocs 比对小节哈希
     *  基线得出（一次性提示——基线自推进，重开面板不重复报）。 */
    staleSecs: Set<string>;
    /** 源已变更的内部知识树（源文档 id）：装载时比 srcHash 得出，
     *  行上出「源已变更·重新归纳」徽标。 */
    staleTrees: Set<string>;
    /** AI 归纳进行中的 docId（行按钮转「归纳中」，再点=中止）。 */
    outlining: string | undefined;
    /** 归纳失败信息（一行展示；undefined=无）。 */
    outlineErr: string | undefined;
}

/** 初始态（$state 包装在 KnowledgePanelApp 内完成）。 */
export function initialKnowPanelUi(): KnowPanelUi {
    return {
        phase: "loading",
        docs: [],
        info: new Map(),
        openPaths: new SvelteSet(),
        rmArmed: undefined,
        staleSecs: new Set(),
        staleTrees: new Set(),
        outlining: undefined,
        outlineErr: undefined,
    };
}
