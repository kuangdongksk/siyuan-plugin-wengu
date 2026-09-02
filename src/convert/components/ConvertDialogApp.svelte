<script lang="ts">
    import { onMount } from "svelte";
    import FormRow from "../../ui/FormRow.svelte";
    import { modelPickAction, modelPickLabel } from "../../ui/ModelPicker";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import type { ConvertDialogDeps } from "../ui/ConvertDialog";
    import type { ConvertDialogCtl } from "../core/ConvertDialogCtl";
    import { initialConvertDialogUi } from "../core/ConvertDialogUi";

    /**
     * AI 转习题弹窗内容（四件套之一，Dialog 壳见 ui/ConvertDialog.ts）：
     * 常显 AI 模型/源文档，其余收进「更多选项」details 折叠区（类名与
     * 旧字符串模板逐字一致）。表单状态全在 ui（旧实现散在 DOM 控件、
     * start 时逐个 querySelector 收集）。产物直写题库（20260903 起不落
     * 文档，无「生成位置」选项）。
     */
    let { ctl, deps, onClose }: { ctl: ConvertDialogCtl; deps: ConvertDialogDeps; onClose: () => void } = $props();

    // svelte-ignore state_referenced_locally
    const t = deps.t;
    const ui = $state(initialConvertDialogUi());

    const pickText = (echo: string): string => echo || t("knowPickBtn");

    onMount(() => {
        ctl.attach(ui, deps, onClose);
        return () => ctl.detach();
    });
</script>

<div class="b3-dialog__content wengu-dialog wengu-convert-dialog">
    <div class="wengu-muted">{t("convertDialogHint")}</div>

    <div class="config-group">
        <div class="config-title">{t("convertBtn")}</div>
        <div class="config-items">
            <FormRow label={t("modelLabel")} desc={t("setModelHint")}>
                <button
                    class="b3-button b3-button--outline fn__size200 wengu-pick"
                    title={modelPickLabel(ui.modelId)}
                    use:modelPickAction={{ t, onPick: (v: string) => ctl.setModel(v) }}
                    >{modelPickLabel(ui.modelId)}</button
                >
            </FormRow>
            <FormRow label={t("docIdLabel")}>
                <button
                    class="b3-button b3-button--outline fn__size200 wengu-pick"
                    title={pickText(ui.docEcho)}
                    onclick={(e) => ctl.pickDoc(e.currentTarget)}>{pickText(ui.docEcho)}</button
                >
            </FormRow>
            <details class="wengu-convert-more">
                <summary>{@html svgIcon("iconRight", "wengu-convert-more-arrow")}{t("convertMore")}</summary>
                <FormRow label={t("fillToChoice")} desc={t("fillToChoiceHint")}>
                    <input
                        class="b3-switch fn__flex-center"
                        type="checkbox"
                        checked={ui.fillToChoice}
                        onchange={(e) => ctl.setFill(e.currentTarget.checked)}
                    />
                </FormRow>
                <FormRow label={t("bigToSteps")} desc={t("bigToStepsHint")}>
                    <input
                        class="b3-switch fn__flex-center"
                        type="checkbox"
                        checked={ui.bigToSteps}
                        onchange={(e) => ctl.setSteps(e.currentTarget.checked)}
                    />
                </FormRow>
                <FormRow label={t("convertParallelLabel")} desc={t("convertParallelHint")}>
                    <select
                        class="b3-select fn__flex-center fn__size200"
                        value={String(ui.parallel)}
                        onchange={(e) => ctl.setParallel(Number(e.currentTarget.value) || 1)}
                    >
                        <option value="1">{t("convertParallel1")}</option>
                        <option value="2">{fmt(t("convertParallelN"), { n: "2" })}</option>
                        <option value="3">{fmt(t("convertParallelN"), { n: "3" })}</option>
                        <option value="4">{fmt(t("convertParallelN"), { n: "4" })}</option>
                    </select>
                </FormRow>
                <FormRow label={t("convertKnowLabel")}>
                    <button
                        class="b3-button b3-button--outline fn__size200 wengu-pick"
                        title={pickText(ui.knowEcho)}
                        onclick={(e) => ctl.pickKnow(e.currentTarget)}>{pickText(ui.knowEcho)}</button
                    >
                </FormRow>
            </details>
        </div>
    </div>

    {#if ui.status}
        <div class="wengu-status wengu-status-{ui.status.kind}">
            {@html ui.status.html}
            {#if ui.status.keptPartial}<br />{t("convertPartialKept")}{/if}
        </div>
    {/if}
    {#if ui.resumeRec}
        <div>
            <button class="b3-button b3-button--text" onclick={() => ctl.resume()}>{t("convertResumeBtn")}</button>
        </div>
    {/if}
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" onclick={onClose}>{t("cancel")}</button>
    {#if ui.running}
        <button class="b3-button b3-button--outline" onclick={() => ctl.manage()}>{t("convertDialogManage")}</button>
    {/if}
    <button class="b3-button b3-button--outline" onclick={() => ctl.start()}>{t("convertStart")}</button>
</div>
