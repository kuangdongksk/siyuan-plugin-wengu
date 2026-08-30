<script lang="ts">
    import { onMount, setContext } from "svelte";
    import { wordKeydown } from "../core/WordBind";
    import type { WordStore } from "../core/WordStore";
    import { WordView } from "../core/WordView";
    import { initialWordUi, WORD_VIEW_CTX, type WordUi } from "../core/WordUi";
    import CardScreen from "./CardScreen.svelte";
    import DoneScreen from "./DoneScreen.svelte";
    import HomeScreen from "./HomeScreen.svelte";
    import LookupScreen from "./LookupScreen.svelte";
    import StartScreen from "./StartScreen.svelte";
    import StatsScreen from "./StatsScreen.svelte";

    let { i18n, store }: { i18n: Record<string, string>; store: WordStore } = $props();

    // 深代理响应态：$state 只能在 Svelte 编译单元里创建，控制器与组件同持引用
    const ui: WordUi = $state(initialWordUi());
    // svelte-ignore state_referenced_locally
    export const view = new WordView(ui, i18n, store);
    setContext(WORD_VIEW_CTX, view);

    let rootEl: HTMLElement;
    onMount(() => {
        view.attach(rootEl);
        void view.render();
        return () => view.destroy();
    });
</script>

<!-- 键盘热键统一在此分发（wordKeydown），非交互容器不需要 ARIA 角色 -->
<!-- 看板娘走全局悬浮层（companion/index.mountCompanionGlobal），此处不嵌 -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="wengu-word-root" bind:this={rootEl} onkeydown={(ev) => wordKeydown(view, ev)}>
    {#if ui.progress}
        {#if ui.mode === "setstart"}
            <StartScreen />
        {:else if ui.mode === "stats"}
            <StatsScreen />
        {:else if ui.mode === "lookup"}
            <LookupScreen />
        {:else if ui.mode === "home" || ui.mode === "askreview"}
            <HomeScreen />
        {:else if ui.mode === "done"}
            <DoneScreen />
        {:else}
            <CardScreen />
        {/if}
    {/if}
</div>
