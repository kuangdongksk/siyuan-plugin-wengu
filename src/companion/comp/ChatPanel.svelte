<script lang="ts">
    import type { CompanionCtl } from "../CompanionCtl";
    import type { CompanionUi } from "../CompanionUi";

    let { ctl, ui }: { ctl: CompanionCtl; ui: CompanionUi } = $props();

    let listEl: HTMLElement | undefined;
    $effect(() => {
        void ui.messages.length;
        void ui.chatBusy;
        if (listEl) listEl.scrollTop = listEl.scrollHeight;
    });

    const send = (): void => {
        if (!ui.chatBusy && ui.draft.trim()) ctl.ask(ui.draft);
    };
    const onKey = (ev: KeyboardEvent): void => {
        if (ev.key === "Enter" && !ev.isComposing) {
            ev.preventDefault();
            send();
        }
    };
</script>

<div class="wengu-comp-chat">
    <div class="wengu-comp-name">{ctl.profileName()}</div>
    <div class="wengu-comp-msgs" bind:this={listEl}>
        {#if ui.messages.length === 0}
            <div class="wengu-comp-msg wengu-comp-msg-ai">{ctl.t("companionChatHello")}</div>
        {:else}
            {#each ui.messages as m (m)}
                <div class="wengu-comp-msg wengu-comp-msg-{m.role}">{m.text}</div>
            {/each}
        {/if}
        {#if ui.chatBusy}
            <div class="wengu-comp-msg wengu-comp-msg-ai">{ctl.t("companionThinking")}</div>
        {/if}
    </div>
    {#if ui.explainKind}
        <button type="button" class="b3-button b3-button--text wengu-comp-explain" onclick={() => ctl.explain()}>
            {ctl.t(ui.explainKind === "word" ? "companionExplainWord" : "companionExplainQuiz")}
        </button>
    {/if}
    <div class="wengu-comp-input">
        <input
            class="b3-text-field"
            placeholder={ctl.t("companionChatPlaceholder")}
            bind:value={ui.draft}
            onkeydown={onKey}
            disabled={ui.chatBusy}
        />
        <button
            type="button"
            class="b3-button b3-button--outline"
            onclick={send}
            disabled={ui.chatBusy || !ui.draft.trim()}>{ctl.t("companionSend")}</button
        >
    </div>
</div>
