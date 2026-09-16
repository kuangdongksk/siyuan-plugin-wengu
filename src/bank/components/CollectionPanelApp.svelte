<script lang="ts">
    import { onMount, setContext } from "svelte";
    import type { QuizView } from "../../quiz";
    import { COL_PANEL_CTX, initialColPanelUi } from "../core/ColPanelUi";
    import { ColPanelCtl } from "../core/ColPanelCtl";
    import { buildColTree } from "../ui/CollectionPanel";
    import { svgIcon } from "../../ui/FormHtml";
    import ColTreeLevel from "./ColTreeLevel.svelte";
    import Button from "../../ui/Button.svelte";

    /**
     * 专题管理工作区面板根组件（四件套之一）：屏幕路由=phase 三态
     * （nobank/loading/ready），树由 rows/folders 现算。旧实现刷新即
     * innerHTML 全量重绘（折叠态重置）；现在折叠/编辑/确认态都在 ui，
     * 刷新只重赋数据。挂载编排见 bank/index.ts mountCollectionPanel
     * （20260901 拆回独立工作区：20260831 □4 曾并入知识面板下半区）。
     */
    let { v }: { v: QuizView } = $props();

    // svelte-ignore state_referenced_locally
    const t = v.t;
    // 深代理响应态：$state 只能在 Svelte 编译单元里创建（四件套约定）
    const ui = $state(initialColPanelUi());
    // svelte-ignore state_referenced_locally
    const ctl = new ColPanelCtl(ui, v);
    setContext(COL_PANEL_CTX, { ctl, ui, t });

    const tree = $derived(buildColTree(ui.rows, ui.folders));
    const empty = $derived(tree.rows.length + tree.children.length === 0);

    /**
     * 标题行「更多」菜单的锚点（null=收起；Issue #145 把低频动作收进来，
     * 标题行只留「新建 / 刷新 / 更多」三钮，窄窗宽也不换行）。
     * 菜单本体由控制器开（`ColPanelCtl.openMoreMenu`，内核 Menu 需要 `v`），
     * 这里只负责算锚点坐标——挂 popover 会让组件自带定位与内核菜单打架。
     */
    let moreMenu: { x: number; y: number } | undefined = $state();

    const openMore = (el: HTMLButtonElement): void => {
        const r = el.getBoundingClientRect();
        moreMenu = { x: r.left, y: r.bottom + 4 };
        ctl.openMoreMenu(moreMenu.x, moreMenu.y);
    };

    onMount(() => {
        void ctl.load();
        return () => ctl.destroy();
    });
</script>

{#if ui.phase === "nobank"}
    <div class="wengu-ws-page"><div class="wengu-muted">{t("colEmpty")}</div></div>
{:else if ui.phase === "loading"}
    <div class="wengu-ws-page"><div class="wengu-muted">{t("loading")}</div></div>
{:else}
    <div class="wengu-ws-page">
        <div class="wengu-ws-title">
            {t("colPanelTitle")}
            <span class="wengu-ws-titlebtns">
                <!-- 标题行只留高频三钮：「新建」（outline 主视觉）+ 刷新 + 更多。
                     低频的「按知识点收集… / 题库体检」收进「更多」菜单
                     （Issue #145：三钮全 outline 平铺会挤爆标题行，且违反
                     design-spec §2「一行至多一个主视觉重心」）——功能一个不少，
                     只是收编布局。菜单锚点见脚本里的 moreMenu。 -->
                <Button type="button" variant="outline" onclick={() => ctl.openFolderInput("")}
                    >{@html svgIcon("iconAdd")} {t("colNewFolder")}</Button
                >
                <Button type="button" variant="text" onclick={() => void ctl.load()}
                    >{@html svgIcon("iconRefresh")}</Button
                >
                <Button
                    type="button"
                    variant="text"
                    aria-label={t("colMore")}
                    aria-haspopup="menu"
                    aria-expanded={moreMenu ? "true" : "false"}
                    onclick={(e) => openMore(e.currentTarget)}>{@html svgIcon("iconMore")}</Button
                >
            </span>
        </div>
        <div class="wengu-col-list wengu-cp-list">
            <ul class="b3-list b3-list--background wengu-cp-tree">
                <ColTreeLevel rows={tree.rows} children={tree.children} depth={0} prefix="" />
            </ul>
            {#if empty}
                <div class="wengu-muted">{t("colEmpty")}</div>
            {/if}
        </div>
    </div>
{/if}
