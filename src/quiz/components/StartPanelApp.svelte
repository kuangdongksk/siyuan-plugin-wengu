<script lang="ts">
    import FormRow from "../../ui/FormRow.svelte";
    import { clampMinutes, fmt } from "../../ui/shared";
    import type { WenguTimingMode } from "../../types";
    import type { WenguRoundScope } from "../service/HistoryStore";
    import type { RoundConfig, StartPanelModel } from "../render/StartPanel";

    /**
     * 开刷面板（四件套之组件半，编排见 render/StartPanel.ts 的
     * mountStartPanelFor）：四组选择一张表单——①上次进度（继续上次/
     * 重新开始，有未完成轮才出现）②刷题范围（全部/上轮错题/错题重刷）
     * ③答案展示 ④多步题模式 ⑤计时方式（含倒计时分钟）。
     * **继续上次 = 原样恢复**：选中后其余选项锁定并回显该轮原配置
     * （渲染值走 $derived，旧 bindStartPanel 的 setVal 重放消失）；
     * 切回重新开始恢复设置页默认值（progress 切换处理器显式重置，
     * 对齐旧 sync 行为）。开刷配置由组件读出经 onStart 回调交编排。
     */
    let {
        model,
        onStart,
        onPreview,
        onReview,
        drift,
    }: {
        model: StartPanelModel;
        onStart(cfg: RoundConfig): void;
        onPreview?(): void;
        onReview?(): void;
        /** 当前文档镜像漂移提示（有才出现：更新镜像/忽略）。 */
        drift?: { count: number; onAdopt(): void; onIgnore(): void };
    } = $props();

    // model 是挂载时一次性快照（壳重绘=卸载重挂，编排层重建模型），
    // 只读初值是本意——state_referenced_locally 警告两条均为此处
    // svelte-ignore state_referenced_locally
    const { t, defaults, resume } = model;
    // svelte-ignore state_referenced_locally
    const cont0 = model.unfinishedAnswered !== undefined && !!resume;
    // 表单字段（$state——切换/锁定联动全靠它们触发重渲染）
    let progress = $state<"continue" | "fresh">(cont0 ? "continue" : "fresh");
    let scope = $state("all");
    let reveal = $state(cont0 ? resume!.reveal : defaults.reveal);
    let stepsMode = $state(cont0 ? resume!.stepsMode : defaults.stepsMode);
    let timing = $state(cont0 ? resume!.timing : defaults.timing);
    let countdownMin = $state(String(cont0 ? resume!.countdownMin : defaults.countdownMin));

    const cont = $derived(progress === "continue");
    // 渲染值：继续=锁定回显原配置；重新开始=用户可改的当前值
    const curReveal = $derived(cont && resume ? resume.reveal : reveal);
    const curSteps = $derived(cont && resume ? resume.stepsMode : stepsMode);
    const curTiming = $derived(cont && resume ? resume.timing : timing);
    const curMinutes = $derived(cont && resume ? String(resume.countdownMin) : countdownMin);
    // 继续=回显该轮原范围；范围 option 未渲染（无错题）回退 all
    const scopeOptions = $derived<WenguRoundScope[]>([
        ...(model.lastWrong > 0 ? (["wrong"] as WenguRoundScope[]) : []),
        ...(model.wrongAll > 0 ? (["wrongAll"] as WenguRoundScope[]) : []),
    ]);
    const curScope = $derived(cont && resume && scopeOptions.includes(resume.scope) ? resume.scope : "all");

    /** 切回「重新开始」恢复设置页默认值（对齐旧 sync 的 setVal 重放）。 */
    function onProgressChange(v: string): void {
        progress = v === "continue" ? "continue" : "fresh";
        if (progress === "fresh") {
            scope = "all";
            reveal = defaults.reveal;
            stepsMode = defaults.stepsMode;
            timing = defaults.timing;
            countdownMin = String(defaults.countdownMin);
        }
    }

    function start(): void {
        onStart({
            progress,
            scope: curScope,
            reveal: curReveal,
            stepsMode: curSteps,
            timing: curTiming,
            countdownMin: clampMinutes(Number(curMinutes) || defaults.countdownMin),
        });
    }
</script>

<div class="wengu-start">
    {#if drift}
        <div class="wengu-status wengu-status-err">
            <span class="fn__flex-1">{fmt(t("driftLine"), { n: String(drift.count) })}</span>
            <button class="b3-button b3-button--small" onclick={() => drift.onAdopt()}>{t("driftAdopt")}</button>
            <button class="b3-button b3-button--small b3-button--outline" onclick={() => drift.onIgnore()}
                >{t("driftIgnore")}</button
            >
        </div>
    {/if}
    {#if model.unfinishedAnswered !== undefined || scopeOptions.length > 0}
        <div class="config-group">
            <div class="config-title">{t("progressScopeTitle")}</div>
            <div class="config-items">
                {#if model.unfinishedAnswered !== undefined}
                    <FormRow
                        label={t("progressTitle")}
                        desc={fmt(t("continueHint"), { n: String(model.unfinishedAnswered ?? 0) })}
                    >
                        <select
                            class="b3-select fn__flex-center fn__size200"
                            value={progress}
                            onchange={(e) => onProgressChange(e.currentTarget.value)}
                        >
                            <option value="continue"
                                >{fmt(t("continueLast"), { n: String(model.unfinishedAnswered ?? 0) })}</option
                            >
                            <option value="fresh">{t("startFresh")}</option>
                        </select>
                    </FormRow>
                {/if}
                {#if scopeOptions.length > 0}
                    <FormRow label={t("scopeTitle")} desc={t("scopeHint")}>
                        <select
                            class="b3-select fn__flex-center fn__size200"
                            disabled={cont}
                            value={curScope}
                            onchange={(e) => (scope = e.currentTarget.value)}
                        >
                            <option value="all">{t("scopeAll")}</option>
                            {#if model.lastWrong > 0}
                                <option value="wrong">{fmt(t("scopeWrongOnly"), { n: String(model.lastWrong) })}</option
                                >
                            {/if}
                            {#if model.wrongAll > 0}
                                <option value="wrongAll"
                                    >{fmt(t("scopeWrongAll"), { n: String(model.wrongAll) })}</option
                                >
                            {/if}
                        </select>
                    </FormRow>
                {/if}
            </div>
        </div>
    {/if}
    <div class="config-group">
        <div class="config-title">{t("runSettingsTitle")}</div>
        <div class="config-items">
            <FormRow label={t("revealTitle")} desc={t("revealHint")}>
                <select
                    class="b3-select fn__flex-center fn__size200"
                    disabled={cont}
                    value={curReveal}
                    onchange={(e) => (reveal = e.currentTarget.value === "after" ? "after" : "instant")}
                >
                    <option value="instant">{t("revealInstant")}</option>
                    <option value="after">{t("revealAfter")}</option>
                </select>
            </FormRow>
            <FormRow label={t("stepsModeTitle")} desc={t("stepsModeHint")}>
                <select
                    class="b3-select fn__flex-center fn__size200"
                    disabled={cont}
                    value={curSteps}
                    onchange={(e) => (stepsMode = e.currentTarget.value === "ai" ? "ai" : "offline")}
                >
                    <option value="offline">{t("stepsModeOffline")}</option>
                    <option value="ai">{t("stepsModeAi")}</option>
                </select>
            </FormRow>
            <FormRow label={t("timingTitle")} desc={t("timingHint")}>
                <select
                    class="b3-select fn__flex-center fn__size200"
                    disabled={cont}
                    value={curTiming}
                    onchange={(e) => (timing = e.currentTarget.value as WenguTimingMode)}
                >
                    <option value="countUp">{t("timingCountUp")}</option>
                    <option value="countdown">{t("timingCountdown")}</option>
                    <option value="perQuestion">{t("timingPerQuestion")}</option>
                    <option value="none">{t("timingNone")}</option>
                </select>
            </FormRow>
            <FormRow label={t("timingMinutes")} desc={t("timingMinutesHint")}>
                <input
                    class="b3-text-field fn__flex-center fn__size200"
                    type="number"
                    min="1"
                    max="600"
                    disabled={cont}
                    value={curMinutes}
                    onchange={(e) => (countdownMin = e.currentTarget.value)}
                />
            </FormRow>
        </div>
    </div>
    <div class="wengu-start-actions">
        {#if onPreview}
            <button class="b3-button b3-button--outline" onclick={() => onPreview?.()}>{t("previewEntry")}</button>
        {/if}
        <button class="b3-button b3-button--outline" onclick={start}>{t("startDrill")}</button>
        {#if onReview}
            <button class="b3-button b3-button--outline" onclick={() => onReview?.()}>{t("reviewEntry")}</button>
        {/if}
    </div>
</div>
