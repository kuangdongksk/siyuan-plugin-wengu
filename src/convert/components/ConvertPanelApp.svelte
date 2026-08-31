<script lang="ts">
    import { onMount } from "svelte";
    import FormRow from "../../ui/FormRow.svelte";
    import { progressStatusText } from "../service/ConvertRun";
    import type { ConvertPanelDeps } from "../ui/ConvertPanel";
    import type { ConvertPanelCtl } from "../core/ConvertPanelCtl";
    import { initialConvertPanelUi } from "../core/ConvertPanelUi";
    import { fmt } from "../../ui/shared";

    /**
     * 转换管理面板内容（四件套之一，Dialog 壳见 ui/ConvertPanel.ts）：
     * 进行中/待抉择区（订阅 ConvertRun 快照响应式刷新）+ 未完成记录区
     * （继续生成/两击丢弃）。类名与旧字符串模板逐字一致。
     */
    let { ctl, deps, onClose }: { ctl: ConvertPanelCtl; deps: ConvertPanelDeps; onClose: () => void } = $props();

    // svelte-ignore state_referenced_locally
    const t = deps.t;
    const ui = $state(initialConvertPanelUi());

    const hasRunning = $derived(!!(ui.snap?.running || (ui.snap?.pendingChoice && ui.snap.pending)));

    onMount(() => {
        ctl.attach(ui, deps, onClose);
        return () => ctl.detach();
    });
</script>

<div class="b3-dialog__content wengu-dialog wengu-convert-panel">
    {#if !hasRunning && ui.records.length === 0}
        <div class="wengu-status wengu-status-muted">{t("convertPanelEmpty")}</div>
    {:else}
        {#if hasRunning && ui.snap}
            {@const snap = ui.snap}
            <div class="config-group">
                <div class="config-title">{t("convertPanelRunning")}</div>
                <div class="config-items">
                    {#if snap.running}
                        <div class="wengu-status wengu-status-muted wengu-convert-bar">
                            <span class="wengu-convert-bar-text"
                                >{snap.progress
                                    ? progressStatusText(t, snap.parallel, snap.progress)
                                    : t("converting")}</span
                            >
                            <button class="b3-button b3-button--outline" onclick={() => ctl.stopRun()}
                                >{t("convertStop")}</button
                            >
                        </div>
                    {:else if snap.pendingChoice && snap.pending}
                        <div class="wengu-status wengu-status-muted wengu-convert-bar">
                            <span class="wengu-convert-bar-text"
                                >{fmt(t("convertStopped"), {
                                    c: String(snap.pending.count),
                                    b: String(snap.pending.batches),
                                    n: String(snap.pending.total),
                                })}</span
                            >
                            <button class="b3-button b3-button--outline" onclick={() => ctl.keepRun()}
                                >{t("convertKeep")}</button
                            >
                            <button class="b3-button b3-button--cancel" onclick={() => ctl.discardRun()}
                                >{t("convertDiscard")}</button
                            >
                        </div>
                    {/if}
                </div>
            </div>
        {/if}
        {#if ui.records.length > 0}
            <div class="config-group">
                <div class="config-title">{t("convertPanelRecords")}</div>
                <div class="config-items">
                    {#each ui.records as { srcDocId, rec } (srcDocId)}
                        {@const armed = ui.armedDoc === srcDocId}
                        <FormRow
                            label={`《${rec.title || srcDocId}》`}
                            desc={fmt(t("convertPanelRecordMeta"), {
                                c: String(rec.count),
                                b: String(rec.batches),
                                n: String(rec.total),
                            })}
                        >
                            <button class="b3-button b3-button--outline" onclick={() => ctl.resume(srcDocId)}
                                >{t("convertPanelResume")}</button
                            >
                            <button
                                class="b3-button b3-button--cancel{armed ? ' b3-button--error' : ''}"
                                onclick={() => ctl.armDrop(srcDocId)}
                                >{armed ? t("confirmDiscard") : t("convertPanelDrop")}</button
                            >
                        </FormRow>
                    {/each}
                </div>
            </div>
        {/if}
    {/if}
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" onclick={onClose}>{t("convertPanelClose")}</button>
</div>
