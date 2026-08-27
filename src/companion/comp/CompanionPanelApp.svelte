<script lang="ts">
    import { onMount } from "svelte";
    import FormRow from "../../ui/FormRow.svelte";
    import { modelPickAction, modelPickLabel } from "../../ui/ModelPicker";
    import { CompanionPanelCtl, type CompanionPanelDeps } from "../core/CompanionPanelCtl";
    import { initialCompanionPanelUi } from "../core/CompanionPanelUi";

    /**
     * 学伴管理工作区面板（左列学伴卡片，右列编辑器，底部全局开关；
     * 类名与旧字符串模板逐字一致，样式全在全局 scss rail.scss）。
     * 表单输入非受控（value 只作初值，change 直写），与旧版行为一致。
     */
    let { t, deps }: { t: (key: string) => string; deps: CompanionPanelDeps } = $props();

    // 深代理响应态：$state 只能在 Svelte 编译单元里创建（四件套约定）
    const ui = $state(initialCompanionPanelUi());
    // svelte-ignore state_referenced_locally
    const ctl = new CompanionPanelCtl(ui, deps);

    const cur = $derived(ctl.active());
    const personas = [
        { id: "gentle", key: "personaGentle" },
        { id: "sharp", key: "personaSharp" },
        { id: "genki", key: "personaGenki" },
        { id: "calm", key: "personaCalm" },
    ] as const;

    onMount(() => () => ctl.destroy());
</script>

<div class="wengu-ws-page">
    <div class="wengu-ws-title">{t("companionPanelTitle")}</div>

    <div class="wengu-ws-foot">
        <FormRow label={t("companionEnableLabel")} desc={t("companionEnableDesc")}>
            <input
                class="b3-switch fn__flex-center"
                type="checkbox"
                checked={deps.settings.companionEnabled !== false}
                onchange={(e) => ctl.toggleEnabled(e.currentTarget.checked)}
            />
        </FormRow>
        <FormRow label={t("companionAiLabel")} desc={t("companionAiDesc")}>
            <input
                class="b3-switch fn__flex-center"
                type="checkbox"
                checked={deps.settings.companionAi !== false}
                onchange={(e) => ctl.toggleAi(e.currentTarget.checked)}
            />
        </FormRow>
        <FormRow label={t("companionPersonaLabel")} desc={t("companionPersonaDesc")}>
            <select
                class="b3-select fn__flex-center fn__size200"
                value={ctl.persona()}
                onchange={(e) => ctl.setPersona(e.currentTarget.value)}
            >
                {#each personas as p}
                    <option value={p.id}>{t(p.key)}</option>
                {/each}
            </select>
        </FormRow>
    </div>

    <div class="wengu-ws-cols">
        <div class="wengu-ws-list">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="wengu-ws-card{ui.activeId === '' ? ' wengu-ws-card-active' : ''}"
                onclick={() => ctl.activate("")}
            >
                <span class="wengu-ws-card-name">{t("companionDefaultOption")}</span>
                {#if ui.activeId === ""}
                    <span class="wengu-ws-card-badge">{t("companionUseBadge")}</span>
                {/if}
            </div>
            {#each ui.profiles as p (p.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    class="wengu-ws-card{ui.activeId === p.id ? ' wengu-ws-card-active' : ''}"
                    onclick={() => ctl.activate(p.id)}
                >
                    <span class="wengu-ws-card-name">{p.name || t("companionDefaultName")}</span>
                    {#if ui.activeId === p.id}
                        <span class="wengu-ws-card-badge">{t("companionUseBadge")}</span>
                    {/if}
                </div>
            {/each}
            <button type="button" class="b3-button b3-button--outline wengu-ws-newbtn" onclick={() => ctl.newProfile()}>
                {t("companionNew")}
            </button>
        </div>

        {#if cur}
            <div class="wengu-ws-editor">
                <FormRow label={t("companionNameLabel")}>
                    <input
                        class="b3-text-field fn__flex-center fn__size200"
                        type="text"
                        value={cur.name}
                        onchange={(e) => ctl.setName(e.currentTarget.value)}
                    />
                </FormRow>
                <!-- 大文本域不走 FormRow：主题 .fn__flex-1 零基宽的标题格会被
                     width:100% 的 textarea 挤成竖条（20260827 实测），保持
                     标签在上、文本域占满在下的堆叠布局 -->
                <div class="wengu-cp-stack">
                    <div class="wengu-cp-lab">
                        <span>{t("companionPromptLabel")}</span>
                        <div class="b3-label__text">{t("companionPromptDesc")}</div>
                    </div>
                    <textarea
                        class="b3-text-field"
                        style="width:100%;box-sizing:border-box;height:auto;resize:vertical"
                        rows="5"
                        spellcheck="false"
                        onchange={(e) => ctl.setPrompt(e.currentTarget.value)}>{cur.prompt}</textarea
                    >
                </div>
                <FormRow label={t("companionImageDirLabel")} desc={t("companionImageDirDesc")}>
                    <input
                        class="b3-text-field fn__flex-center fn__size200"
                        type="text"
                        spellcheck="false"
                        placeholder="assets/wengu/companion"
                        value={cur.imageDir}
                        onchange={(e) => ctl.setImageDir(e.currentTarget.value)}
                    />
                </FormRow>
                <FormRow label={t("companionModelLabel")} desc={t("companionModelHint")}>
                    <button
                        type="button"
                        class="b3-button b3-button--outline fn__size200 wengu-pick"
                        title={modelPickLabel(cur.modelId)}
                        use:modelPickAction={{ t, onPick: (v: string) => ctl.setModel(v) }}
                        >{modelPickLabel(cur.modelId)}</button
                    >
                </FormRow>
                <div class="fn__flex" style="gap:8px;justify-content:flex-end;padding:8px 0">
                    <button type="button" class="b3-button b3-button--text" onclick={() => ctl.delClick()}>
                        {ui.delArmed ? t("collectConfirm") : t("companionDelete")}
                    </button>
                </div>
            </div>
        {:else}
            <div class="wengu-ws-editor wengu-muted">{t("companionDefaultHint")}</div>
        {/if}
    </div>
</div>
