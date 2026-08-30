<script lang="ts">
    import { svgIcon } from "../../ui/FormHtml";
    import type { WenguWorkspace } from "../render/RailMount";

    /**
     * 左侧工作区导航栏（组件半；类型与挂载编排见 render/RailMount.ts
     * 的 mountRailFor）：刷题/专题管理/知识文档/学伴管理四个图标钮。
     * rail 是「随壳重绘」的一部分——四处壳拼接（做题主壳/错误兜底/
     * 工作区分支/复习分支）都在 innerHTML 最前放 RAIL_ANCHOR_HTML
     * 锚，mountRailFor 以 anchor 法把组件根插到 v.el 直下后删锚
     * （flex 三栏布局依赖直接子元素，不能包宿主 div）。
     */
    let {
        t,
        active,
        onSwitch,
    }: {
        t: (k: string) => string;
        active: WenguWorkspace;
        onSwitch(ws: WenguWorkspace): void;
    } = $props();

    const buttons: { ws: WenguWorkspace; icon: string; key: string }[] = [
        { ws: "drill", icon: "iconWengu", key: "railDrill" },
        { ws: "collection", icon: "iconList", key: "railCollection" },
        { ws: "knowledge", icon: "iconInfo", key: "railKnowledge" },
        { ws: "companion", icon: "iconStar", key: "railCompanion" },
    ];
</script>

<div class="wengu-rail">
    {#each buttons as b (b.ws)}
        <button
            type="button"
            class="wengu-rail-btn{active === b.ws ? ' wengu-rail-active' : ''}"
            title={t(b.key)}
            aria-label={t(b.key)}
            onclick={() => onSwitch(b.ws)}>{@html svgIcon(b.icon)}</button
        >
    {/each}
</div>
