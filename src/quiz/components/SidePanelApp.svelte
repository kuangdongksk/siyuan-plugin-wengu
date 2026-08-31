<script lang="ts">
    import TreeList from "../../ui/TreeList.svelte";
    import type { TreeListNode } from "../../ui/TreeListTypes";
    import { SvelteSet } from "svelte/reactivity";
    import { svgIcon } from "../../ui/FormHtml";
    import { buildSideTree, type SideTreeNode } from "../render/SideTree";
    import { fmt, mmss } from "../../ui/shared";
    import type { WenguDoc } from "../../types";

    /**
     * 刷题侧栏（批次6-5 Svelte 化）：头部图标操作（刷新、设置、收起）
     * + 顶部工具区（搜索、统计、专题、AI 转习题）+ 主体清单。主体空
     * 搜索=树形（TreeList，展开态组件内持 Set、折叠经 onPersistOpen
     * 回写 prefs），有搜索词=平铺分组——原来是 renderSideBodyHtml
     * 字符串加 applySideFilter 重灌加 remountSideTree 重挂三件套，现
     * 统一为 $derived 切片（树与平铺同一份 docs 派生源），搜索不再
     * 重灌 DOM、输入框不重建、焦点天然不丢。专题区（collections
     * 非空）恒在主体顶部。DOM 契约（类名、data 属性、占位槽）与旧
     * 字符串渲染逐字一致——转换按钮文案槽 [data-convert-label] 仍由
     * convert 域的 updateConvertBtn 命令式刷新，文档行右键菜单仍由
     * ViewBindings 委托（识别 data-docid 与 data-id）。
     */
    let {
        t,
        docs,
        docId,
        sideCollapsed,
        hasSettingsButton,
        filter,
        collections,
        activeCollection,
        sideTreeOpen,
        onAct,
        onSearch,
        onOpenDoc,
        onOpenCollection,
        onPersistOpen,
    }: {
        t(key: string): string;
        docs: WenguDoc[];
        docId: string;
        sideCollapsed: boolean;
        hasSettingsButton: boolean;
        /** 初始搜索词（整壳重建时由视图回灌）。 */
        filter: string;
        collections: { id: string; title: string; count: number }[];
        activeCollection: string;
        sideTreeOpen: string[];
        /** 头部/工具区按钮（act 名同 data-act）。 */
        onAct(act: string): void;
        /** 搜索输入（视图记 sideFilter，供整壳重建回灌）。 */
        onSearch(text: string): void;
        onOpenDoc(docId: string): void;
        onOpenCollection(colId: string): void;
        onPersistOpen(open: string[]): void;
    } = $props();

    /** 文档行元信息串（题数 · 已刷 · 累计用时；与旧渲染逐字一致）。 */
    function docMeta(d: WenguDoc): string {
        return [
            fmt(t("exerciseCount"), { n: String(d.total) }),
            d.attempted > 0 ? fmt(t("drilledCount"), { a: String(d.attempted) }) : "",
            d.totalTime > 0 ? mmss(d.totalTime) : "",
        ]
            .filter(Boolean)
            .join(" · ");
    }

    /** 树节点 → TreeListNode（doc 行的 meta 直接塞进 name 旁的 meta 字段）。 */
    type SideRow = TreeListNode & { meta?: string };
    function toRows(nodes: SideTreeNode[]): SideRow[] {
        return nodes.map((n): SideRow => {
            const children = toRows(n.children);
            if (!n.doc) return { key: n.path, name: n.name, tip: n.path, kind: "branch", children };
            return {
                key: n.path,
                name: n.doc.title || n.doc.id,
                tip: n.doc.hPath,
                kind: "doc",
                id: n.doc.id,
                meta: docMeta(n.doc),
                children,
            };
        });
    }

    // 响应式数据：整壳重建时 props 全新（组件随之重挂）；挂载后专题
    // 清单/选中的轻量刷新（题库迁移/专题编辑，不打断作答）走实例导出
    // updateCols 覆写下面两个 $state（docs 重建才变，仍作快照）。
    // svelte-ignore state_referenced_locally
    let cols = $state(collections.filter((c) => !c.id.startsWith("doc:")));
    // svelte-ignore state_referenced_locally
    let activeCol = $state(activeCollection);
    // svelte-ignore state_referenced_locally
    const treeRows = toRows(buildSideTree(docs));
    // 展开集合必须 SvelteSet：$state 不深代理 Set，裸集合增删不重渲
    // （20260831 三树折叠失灵根因），SvelteSet 自带信号无需再裹 $state
    const openKeys = new SvelteSet<string>(sideTreeOpen);
    let query = $state(filter);

    /** 专题清单/选中轻量刷新（CollectionFlow.refreshSide 用；不重灌树与搜索）。 */
    export function updateCols(next: { id: string; title: string; count: number }[], active: string): void {
        cols = next.filter((c) => !c.id.startsWith("doc:"));
        activeCol = active;
    }

    /** 搜索态平铺分组（按父路径分组便于扫结果；空搜索返回空不渲染）。 */
    const flatGroups = $derived.by(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [] as { group: string; docs: WenguDoc[] }[];
        const groups = new Map<string, WenguDoc[]>();
        for (const d of docs) {
            if (!`${d.title}\n${d.hPath}`.toLowerCase().includes(q)) continue;
            const seg = (d.hPath || "").split("/").filter(Boolean);
            seg.pop();
            const key = seg.length ? `/${seg.join("/")}` : "/";
            const arr = groups.get(key) ?? [];
            arr.push(d);
            groups.set(key, arr);
        }
        return [...groups.entries()].map(([group, gdocs]) => ({ group, docs: gdocs }));
    });

    const searching = $derived(query.trim() !== "");
    const empty = $derived(docs.length === 0);

    const ontreeclick = (n: TreeListNode): void => {
        if (n.id) onOpenDoc(n.id);
    };
    const persist = (_key: string, keys: Set<string>): void => onPersistOpen([...keys]);
    const search = (e: Event): void => {
        query = (e.currentTarget as HTMLInputElement).value;
        onSearch(query);
    };
</script>

<div class="wengu-side{sideCollapsed ? ' wengu-side-collapsed' : ''}" data-side>
    <div class="wengu-side-head">
        <span>{t("sideTitle")}</span>
        <span class="wengu-side-headbtns">
            <button
                class="wengu-side-iconbtn"
                data-act="refresh"
                title={t("quizRefresh")}
                onclick={() => onAct("refresh")}
            >
                {@html svgIcon("iconRefresh")}
            </button>
            {#if hasSettingsButton}
                <button
                    class="wengu-side-iconbtn"
                    data-act="settings"
                    title={t("settingsBtn")}
                    onclick={() => onAct("settings")}
                >
                    {@html svgIcon("iconSettings")}
                </button>
            {/if}
            <button
                class="wengu-side-iconbtn"
                data-act="side-fold"
                title={t("sideFold")}
                onclick={() => onAct("side-fold")}
            >
                {@html svgIcon("iconLeft")}
            </button>
        </span>
    </div>
    <div class="wengu-side-tools">
        <input
            class="b3-text-field wengu-side-search"
            data-act="side-search"
            type="search"
            spellcheck="false"
            placeholder={t("sideSearch")}
            value={query}
            oninput={search}
        />
        <div class="wengu-side-actions">
            <button class="wengu-side-iconbtn" data-act="stats" title={t("statsTitle")} onclick={() => onAct("stats")}>
                {@html svgIcon("iconInfo")}
            </button>
            <button
                class="wengu-side-iconbtn"
                data-act="collections"
                title={t("collectionsBtn")}
                onclick={() => onAct("collections")}
            >
                {@html svgIcon("iconList")}
            </button>
            <button
                class="b3-button b3-button--outline wengu-side-convert"
                data-act="convert"
                title={t("convertBtn")}
                onclick={() => onAct("convert")}
            >
                {@html svgIcon("iconSparkles")} <span data-convert-label>{t("convertBtn")}</span>
            </button>
        </div>
    </div>
    <div class="wengu-side-body" data-side-body>
        {#if cols.length > 0}
            <div class="wengu-side-group">
                <div class="wengu-side-label">{t("collectionsTitle")}</div>
                {#each cols as c (c.id)}
                    <div
                        class="wengu-side-item{c.id === activeCol ? ' wengu-side-active' : ''}"
                        data-colid={c.id}
                        title={c.title}
                        role="button"
                        tabindex="0"
                        onclick={() => onOpenCollection(c.id)}
                        onkeydown={(e) => e.key === "Enter" && onOpenCollection(c.id)}
                    >
                        <div class="wengu-side-title">{c.title}</div>
                        <div class="wengu-side-meta">{fmt(t("collectionCount"), { n: String(c.count) })}</div>
                    </div>
                {/each}
            </div>
        {/if}
        {#if !searching}
            {#if empty}
                <div class="wengu-muted wengu-side-empty">{t("noExerciseDocs")}</div>
            {:else}
                <div class="wengu-tree">
                    <TreeList
                        nodes={treeRows}
                        {openKeys}
                        current={activeCol ? "" : docId}
                        onrowclick={ontreeclick}
                        ontoggle={persist}
                    >
                        {#snippet main(n)}
                            {#if n.id}
                                <div class="wengu-tree-main">
                                    <div class="wengu-side-title">{n.name}</div>
                                    <div class="wengu-side-meta">{(n as SideRow).meta ?? ""}</div>
                                </div>
                            {:else}
                                <span class="b3-list-item__text">{n.name}</span>
                            {/if}
                        {/snippet}
                    </TreeList>
                </div>
            {/if}
        {:else if flatGroups.length === 0}
            <div class="wengu-muted wengu-side-empty">{t(empty ? "noExerciseDocs" : "sideNoMatch")}</div>
        {:else}
            {#each flatGroups as g (g.group)}
                <div class="wengu-side-group">
                    <div class="wengu-side-label">{g.group}</div>
                    {#each g.docs as d (d.id)}
                        <div
                            class="wengu-side-item{d.id === docId && !activeCol ? ' wengu-side-active' : ''}"
                            data-docid={d.id}
                            title={d.hPath || d.title}
                            role="button"
                            tabindex="0"
                            onclick={() => onOpenDoc(d.id)}
                            onkeydown={(e) => e.key === "Enter" && onOpenDoc(d.id)}
                        >
                            <div class="wengu-side-title">{d.title || d.id}</div>
                            <div class="wengu-side-meta">{docMeta(d)}</div>
                        </div>
                    {/each}
                </div>
            {/each}
        {/if}
    </div>
</div>
