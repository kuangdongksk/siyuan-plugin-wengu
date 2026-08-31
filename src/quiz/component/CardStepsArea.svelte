<script lang="ts">
    import { renderMathIn } from "../service/ProtyleHost";
    import type { CardCtl } from "../render/CardCtl";
    import { appealStep, nextStep, pickStep, rtFallback } from "../flow/StepsFlow";
    import type { WenguQuestion } from "../../types";

    /**
     * 多步引导作答区（6-4b 状态化）：步骤引导语/选项在 CardUi.steps
     * 预渲染快照（离线初始态与 AI 实时追加同构），描色/解锁/申诉钮
     * 全派生自状态；旧 fillOneStep 的公式渲染改 $effect 对齐（挂载与
     * 实时追加步各渲一次）。DOM 契约（data-step 与 data-opt-text）保留
     * ——PreviewFlow 预览装饰仍按这些钩子做 DOM 手术。
     */
    let {
        ctl,
        q,
        t,
        on,
    }: {
        ctl: CardCtl;
        q: WenguQuestion;
        t: (k: string) => string;
        /** interactive（预览/渐进不绑事件）。 */
        on: boolean;
    } = $props();

    const ui = ctl.ui;
    const host = ctl.host;

    let stepsEl = $state<HTMLElement | undefined>(undefined);

    // 挂载与实时追加步后渲公式（旧 fillOneStep 的 renderMathIn 时机对齐）
    $effect(() => {
        ui.steps?.length;
        if (stepsEl) renderMathIn(stepsEl);
    });
</script>

<div class="wengu-steps" data-steps bind:this={stepsEl}>
    {#each ui.steps ?? [] as step, k (k)}
        <div class="wengu-step" data-step={k} hidden={step.hidden}>
            <div class="wengu-step-head">
                <span class="wengu-badge wengu-step-kind">{step.badge}</span>
                <span class="wengu-step-stem" data-step-stem>{@html step.stemHtml}</span>
            </div>
            <div class="wengu-step-opts">
                {#each step.opts as opt (opt.letter)}
                    <button
                        class="wengu-step-opt{opt.tier ? ` ${opt.tier}` : ''}{opt.mark === 1
                            ? ' wengu-step-right'
                            : opt.mark === 2
                              ? ' wengu-step-wrong'
                              : ''}{step.selected === opt.letter ? ' wengu-step-selected' : ''}"
                        data-letter={opt.letter}
                        disabled={step.locked}
                        onclick={on && !step.graded ? () => pickStep(ctl, k, opt.letter) : undefined}
                    >
                        <span class="wengu-step-letter">{opt.letter}</span>
                        <span class="wengu-step-text" data-opt-text>{@html opt.html}</span>
                    </button>
                {/each}
            </div>
            <button
                class="wengu-btn wengu-step-next"
                data-act="step-next"
                disabled={step.locked}
                onclick={on ? () => void nextStep(host, q, ctl, k) : undefined}
            >
                {t("stepNext")}
            </button>
            {#if step.resultOn}
                <div class="wengu-step-result{step.resultCls ? ` ${step.resultCls}` : ''}" data-step-result>
                    {@html step.resultHtml}
                </div>
            {:else}
                <div class="wengu-step-result" data-step-result hidden></div>
            {/if}
            {#if step.appeal}
                <!-- method 步答错的「AI 复核」申诉（收口后仍可发起） -->
                <button
                    class="wengu-btn wengu-step-appeal"
                    data-act="step-appeal"
                    disabled={step.appeal === "busy"}
                    onclick={on ? () => void appealStep(host, q, ctl, k) : undefined}
                >
                    {step.appeal === "busy" ? t("stepAppealing") : t("stepAppeal")}
                </button>
            {/if}
        </div>
    {/each}
    {#if ui.rtError}
        <!-- 实时失败：报错 + 「切离线继续」（重建静态步骤从头作答） -->
        <div class="wengu-step-error" data-rt-error="1">
            <span class="wengu-wrong">{ui.rtError}</span>
            <button class="wengu-btn" data-act="rt-fallback" onclick={on ? () => rtFallback(host, q, ctl) : undefined}>
                {t("rtFallback")}
            </button>
        </div>
    {/if}
</div>
