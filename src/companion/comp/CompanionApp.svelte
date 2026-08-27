<script lang="ts">
    import { companionCtl } from "../index";
    import { EXPR_FACES } from "../rules/Expressions";
    import { initialCompanionUi, type CompanionUi } from "../core/CompanionUi";
    import ChatPanel from "./ChatPanel.svelte";

    // 双宿主共享单例：mount 传入的 host 仅作挂载辨识，不参与渲染
    const props = $props();

    const ctl = companionCtl()!;
    // $state 只能在 Svelte 编译单元顶层创建：每实例都建一份代理，
    // 首个被 acquireUi 采纳挂到单例控制器——双宿主（quiz 挂载层 +
    // word 内嵌）此后共享同一份，多余实例的代理直接弃用
    const localUi = $state(initialCompanionUi());
    const ui: CompanionUi = ctl.acquireUi(() => localUi);

    let bubbleOn = $state(false);
    let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
        ui.lineTs;
        if (!ui.line) return;
        bubbleOn = true;
        clearTimeout(bubbleTimer);
        bubbleTimer = setTimeout(() => (bubbleOn = false), 7000);
        return () => clearTimeout(bubbleTimer);
    });
</script>

{#if ctl.enabled()}
    <div class="wengu-companion-inner">
        {#if ui.chatOpen}
            <ChatPanel {ctl} {ui} />
        {/if}
        {#if bubbleOn && ui.line}
            <div class="wengu-comp-bubble">{ui.line}</div>
        {/if}
        <button
            type="button"
            class="wengu-comp-figure"
            title={ctl.t("companionHint")}
            onclick={() => (ui.chatOpen = !ui.chatOpen)}
        >
            {#if ui.imgExpr[ui.expr]}
                <img class="wengu-comp-img" src={ui.imgExpr[ui.expr]} alt="" draggable="false" />
            {:else}
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <circle class="wengu-comp-body" cx="32" cy="34" r="21" />
                    {#key ui.expr}
                        <g class="wengu-comp-face">
                            {@html EXPR_FACES[ui.expr].eyes}
                            {@html EXPR_FACES[ui.expr].mouth}
                            {@html EXPR_FACES[ui.expr].extra ?? ""}
                        </g>
                    {/key}
                </svg>
            {/if}
        </button>
    </div>
{/if}
