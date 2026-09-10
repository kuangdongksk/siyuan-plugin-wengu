<script lang="ts">
    import { svgIcon } from "../../ui/FormHtml";
    import Button from "../../ui/Button.svelte";
    import type { WenguWorkspace } from "../render/RailMount";

    /**
     * 左侧工作区导航栏（组件半；类型与挂载编排见 render/RailMount.ts
     * 的 mountRailFor）：刷题/专题/知识/AI 会话/学伴五个工作区图标钮
     * （20260901 拆分：专题管理回独立工作区）+ 底部设置钮（20260910
     * 自刷题侧栏挪入，开设置弹窗不切工作区、无激活态）。rail 是
     * 「随壳重绘」的一部分——四处壳拼接（做题主壳/错误兜底/工作区分支/
     * 复习分支）都在 innerHTML 最前放 RAIL_ANCHOR_HTML 锚，mountRailFor
     * 以 anchor 法把组件根插到 v.el 直下后删锚（flex 三栏布局依赖直接
     * 子元素）。
     */
    let {
        t,
        active,
        onSwitch,
        onOpenSettings,
    }: {
        t: (k: string) => string;
        active: WenguWorkspace;
        onSwitch(ws: WenguWorkspace): void;
        /** 设置弹窗入口（视图未接插件时缺省不渲染该钮）。 */
        onOpenSettings?: () => void;
    } = $props();

    const buttons: { ws: WenguWorkspace; icon: string; key: string }[] = [
        { ws: "drill", icon: "iconWengu", key: "railDrill" },
        { ws: "collection", icon: "iconList", key: "railCollection" },
        { ws: "knowledge", icon: "iconInfo", key: "railKnowledge" },
        { ws: "ai", icon: "iconSparkles", key: "railAi" },
        { ws: "companion", icon: "iconStar", key: "railCompanion" },
    ];
</script>

<div class="wengu-rail">
    {#each buttons as b (b.ws)}
        <Button
            type="button"
            class="wengu-rail-btn{active === b.ws ? ' wengu-rail-active' : ''}"
            title={t(b.key)}
            aria-label={t(b.key)}
            onclick={() => onSwitch(b.ws)}>{@html svgIcon(b.icon)}</Button
        >
    {/each}
    {#if onOpenSettings}
        <Button
            type="button"
            class="wengu-rail-btn wengu-rail-settings"
            title={t("settingsBtn")}
            aria-label={t("settingsBtn")}
            onclick={onOpenSettings}>{@html svgIcon("iconSettings")}</Button
        >
    {/if}
</div>
