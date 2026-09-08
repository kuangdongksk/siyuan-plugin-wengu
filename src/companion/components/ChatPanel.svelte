<script lang="ts">
    import type { CompanionCtl } from "../core/CompanionCtl";
    import type { CompanionUi } from "../core/CompanionUi";
    import Button from "../../ui/Button.svelte";

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
            <div class="wengu-comp-msg wengu-comp-msg-ai">
                {ctl.t("companionThinking").replace("{name}", ctl.profileName())}
            </div>
        {/if}
    </div>
    {#if ui.explainKind}
        <Button type="button" variant="text" class="wengu-comp-explain" onclick={() => ctl.explain()}>
            {ctl.t(ui.explainKind === "word" ? "companionExplainWord" : "companionExplainQuiz")}
        </Button>
    {/if}
    <div class="wengu-comp-input">
        <input
            class="b3-text-field"
            placeholder={ctl.t("companionChatPlaceholder").replace("{name}", ctl.profileName())}
            bind:value={ui.draft}
            onkeydown={onKey}
            disabled={ui.chatBusy}
        />
        <Button type="button" variant="outline" onclick={send} disabled={ui.chatBusy || !ui.draft.trim()}
            >{ctl.t("companionSend")}</Button
        >
    </div>
</div>
