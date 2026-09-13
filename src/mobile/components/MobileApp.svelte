<script lang="ts">
    import { onMount, setContext } from "svelte";
    import { initialMobileUi, MobileDrill } from "../core/MobileDrill";
    import { MOBILE_DRILL_CTX } from "../core/MobileCtx";
    import { markMobileUi } from "../../ui/shared";
    import type { MobileDeps } from "../types";
    import HomeScreen from "./HomeScreen.svelte";
    import DrillScreen from "./DrillScreen.svelte";
    import ReportScreen from "./ReportScreen.svelte";

    /**
     * 移动端刷题壳（Issue #59）：dock 面板内「仅刷题」三屏路由——
     * 开刷面板 / 做题 / 轮次报告。状态全在 MobileDrill（本组件只渲染）；
     * `.wengu-mobile` 根标记在挂载层打，触屏样式一律写成它的后代选择器
     * （桌面不带标记 → 样式逐字节不变，禁 media query）。
     */
    let { deps }: { deps: MobileDeps } = $props();

    // 响应态深代理必须在本编译单元创建（$state 不能在 .ts 里用）——
    // 控制器与组件同持这一份引用，控制器改字段即触发细粒度重渲染
    const ui = $state(initialMobileUi());
    // deps 是挂载时一次性快照（dock init 建实例、壳不复建），只读初值为本意
    // svelte-ignore state_referenced_locally
    const drill = new MobileDrill(ui, deps);
    setContext(MOBILE_DRILL_CTX, drill);
    // 实例导出：dock destroy 时编排层可取控制器（本域暂只需卸载函数）
    export const ctl = drill;

    onMount(() => {
        markMobileUi(rootEl);
        void drill.load(); // 装载在挂载后起（SSR/单测不触内核）
    });

    let rootEl: HTMLElement | undefined = $state();
</script>

<div class="wengu-md" bind:this={rootEl} data-screen={drill.ui.screen}>
    {#if drill.ui.screen === "home"}
        <HomeScreen />
    {:else if drill.ui.screen === "report"}
        <ReportScreen />
    {:else}
        <DrillScreen />
    {/if}
</div>
