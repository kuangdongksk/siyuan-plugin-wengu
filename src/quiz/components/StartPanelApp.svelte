<script lang="ts">
    import FormRow from "../../ui/FormRow.svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import Button from "../../ui/Button.svelte";
    import Select from "../../ui/Select.svelte";
    import { clampMinutes, fmt } from "../../ui/shared";
    import type { WenguTimingMode } from "../../types";
    import type { WenguRoundScope } from "../service/HistoryStore";
    import type { RoundConfig, StartPanelModel } from "../render/StartPanel";

    /**
     * 开刷面板（四件套之组件半，编排见 render/StartPanel.ts 的
     * mountStartPanelFor）：四组选择一张表单——①上次进度（继续上次/
     * 重新开始，有未完成轮才出现）②刷题范围（全部/上轮错题/错题重刷）
     * ③答案展示 ④多步题模式 ⑤计时方式（含倒计时分钟）。
     * Issue #100：结构照设计稿屏①——两张独立卡片（进度与范围 /
     * 作答设置，卡头在卡内带小图标）+ 底部动作行；「开始刷题」是唯一
     * 主操作（primary）。**「刷题范围」行恒渲染**（最少只有「全部题目」
     * 一项），无错题时不再整卡消失；「上次进度（继续上次）」仍按未完成
     * 轮条件渲染（逻辑口径不动）。
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
    }: {
        model: StartPanelModel;
        onStart(cfg: RoundConfig): void;
        onPreview?(): void;
        onReview?(): void;
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
    const progressOptions = $derived([
        { value: "continue", label: fmt(t("continueLast"), { n: String(model.unfinishedAnswered ?? 0) }) },
        { value: "fresh", label: t("startFresh") },
    ]);
    const scopeSelectOptions = $derived([
        { value: "all", label: t("scopeAll") },
        ...(model.lastWrong > 0
            ? [{ value: "wrong", label: fmt(t("scopeWrongOnly"), { n: String(model.lastWrong) }) }]
            : []),
        ...(model.wrongAll > 0
            ? [{ value: "wrongAll", label: fmt(t("scopeWrongAll"), { n: String(model.wrongAll) }) }]
            : []),
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
    <section class="wengu-start-card">
        <h3 class="wengu-start-cardhead">
            {@html svgIcon("iconList", "wengu-start-cardicon")}{t("progressScopeTitle")}
        </h3>
        {#if model.unfinishedAnswered !== undefined}
            <FormRow
                label={t("progressTitle")}
                desc={fmt(t("continueHint"), { n: String(model.unfinishedAnswered ?? 0) })}
            >
                <Select
                    class="b3-select fn__flex-center wengu-start-ctl"
                    options={progressOptions}
                    value={progress}
                    onchange={(e) => onProgressChange(e.currentTarget.value)}
                />
            </FormRow>
        {/if}
        <FormRow label={t("scopeTitle")} desc={t("scopeHint")}>
            <Select
                class="b3-select fn__flex-center wengu-start-ctl"
                options={scopeSelectOptions}
                disabled={cont}
                value={curScope}
                onchange={(e) => (scope = e.currentTarget.value)}
            />
        </FormRow>
    </section>
    <section class="wengu-start-card">
        <h3 class="wengu-start-cardhead">
            {@html svgIcon("iconEye", "wengu-start-cardicon")}{t("runSettingsTitle")}
        </h3>
        <FormRow label={t("revealTitle")} desc={t("revealHint")}>
            <Select
                class="b3-select fn__flex-center wengu-start-ctl"
                options={[
                    { value: "instant", label: t("revealInstant") },
                    { value: "after", label: t("revealAfter") },
                ]}
                disabled={cont}
                value={curReveal}
                onchange={(e) => (reveal = e.currentTarget.value === "after" ? "after" : "instant")}
            />
        </FormRow>
        <FormRow label={t("stepsModeTitle")} desc={t("stepsModeHint")}>
            <Select
                class="b3-select fn__flex-center wengu-start-ctl"
                options={[
                    { value: "offline", label: t("stepsModeOffline") },
                    { value: "ai", label: t("stepsModeAi") },
                ]}
                disabled={cont}
                value={curSteps}
                onchange={(e) => (stepsMode = e.currentTarget.value === "ai" ? "ai" : "offline")}
            />
        </FormRow>
        <FormRow label={t("timingTitle")} desc={t("timingHint")}>
            <Select
                class="b3-select fn__flex-center wengu-start-ctl"
                options={[
                    { value: "countUp", label: t("timingCountUp") },
                    { value: "countdown", label: t("timingCountdown") },
                    { value: "perQuestion", label: t("timingPerQuestion") },
                    { value: "none", label: t("timingNone") },
                ]}
                disabled={cont}
                value={curTiming}
                onchange={(e) => (timing = e.currentTarget.value as WenguTimingMode)}
            />
        </FormRow>
        <FormRow label={t("timingMinutes")} desc={t("timingMinutesHint")}>
            <input
                class="b3-text-field fn__flex-center wengu-start-ctl"
                type="number"
                min="1"
                max="600"
                disabled={cont}
                value={curMinutes}
                onchange={(e) => (countdownMin = e.currentTarget.value)}
            />
        </FormRow>
    </section>
    <div class="wengu-start-actions">
        {#if onPreview}
            <Button variant="outline" class="wengu-start-act" onclick={() => onPreview?.()}>{t("previewEntry")}</Button>
        {/if}
        <Button variant="primary" class="wengu-start-act" onclick={start}>{t("startDrill")}</Button>
        {#if onReview}
            <Button variant="outline" class="wengu-start-act" onclick={() => onReview?.()}>{t("reviewEntry")}</Button>
        {/if}
    </div>
</div>

<style>
    /* ── 开刷面板（首屏，Issue #100）：照设计稿 design/wengu-desktop-drill.html
   屏①——去外盒、改居中列容器：两张独立卡片 + 底部动作行（卡头在卡内）；
   行式控件沿用 FormRow 的 b3 行样式（与插件设置同款）。颜色全走 b3 令牌
   （Neo 的 #c5866a/#364852 只作观感参照，禁硬编码）。
   **20260915 起（整改 F1 / Issue #127）：样式随新规迁入组件 `<style>`**
   ——本片是纯组件独占（唯一消费者、零 TS 拼串触达），旧局部分片
   `src/scss/startpanel.scss` 已删。规格断言 `StartPanelStyle.test.ts` 同步
   改为对本组件 `<style>` 做 sass 真编译。类名逐字保留，DOM 零变化。
   ⚠️ 迁入后 scoped：凡类名由**子组件渲染**（FormRow/Select/Button 内的
   `wengu-formrow` / `fn__flex-1` / `wengu-start-ctl` / `wengu-start-act`）或
   经 `{@html}` 注入（卡头图标的 `wengu-start-cardicon`）的，一律用
   `:global()` 局部包裹——否则 scoped 哈希化后必然失配（选择器整条被删）。 */
    .wengu-start {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 18px;
        width: 100%;
        max-width: 760px;
        margin: 30px auto 0;
    }

    .wengu-start .wengu-start-card {
        width: 100%;
        box-sizing: border-box;
        padding: 22px 26px;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius-b);
        background: var(--b3-theme-surface);
        box-shadow: 0 2px 8px color-mix(in srgb, var(--b3-theme-on-background) 6%, transparent);
    }

    /* 卡头在卡内：小图标（主色）+ 标题（15px/600；间距照稿 .scard-h——
   gap 9px、下留白 6px，其后首行自带 13px 上衬） */
    .wengu-start .wengu-start-cardhead {
        display: flex;
        align-items: center;
        gap: 9px;
        margin: 0 0 6px;
        font-size: 15px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    /* 图标类名经 {@html svgIcon(...)} 注入（TS 侧拼串），scoped 会失配 →
   `:global()` 保其原样；哈希挂在同复合选择器的自有类 .wengu-start-cardhead 上 */
    .wengu-start .wengu-start-cardhead > :global(.wengu-start-cardicon) {
        flex: none;
        /* svgIcon 自带 14px 属性，卡头图标按设计稿略放大一档 */
        width: 16px;
        height: 16px;
        fill: currentColor;
        color: var(--b3-theme-primary);
    }

    /* 行：左标题+描述、右控件、行间分隔线（末行无——同设计稿 .srow）。
   行自身样式走 FormRow（b3 行式控件），此处只处理卡内边距、分隔线与
   行内排版：主题 .b3-label 自带 24px 水平内边距，与卡内衬（22/26）
   叠加后行会内缩一圈、分隔线短一截，故卡内的行**内缩归零 + 改纵向
   内衬**——分隔线随行撑满卡内宽，文字仍留呼吸位。
   ⚠️ `.wengu-formrow` 由 FormRow 子组件渲染 → `:global()`。 */
    .wengu-start .wengu-start-card :global(.wengu-formrow) {
        margin: 0;
        padding: 13px 0;
        border-bottom: 1px solid var(--b3-border-color);
    }

    /* 末行只去分隔线（设计稿 .srow:last-child 同款），纵向内衬照旧保留
   ——卡内衬 22px + 行 13px = 稿里 35px 的底留白。 */
    .wengu-start .wengu-start-card :global(.wengu-formrow:last-of-type) {
        border-bottom: 0;
    }

    /* 行排版照设计稿 .sr-t / .sr-d：左标题 13.5px/600、描述 12px 次要色。
   FormRow 的类名串是主题对抗的一部分（禁改，见 svelte-migration §10），
   行内无专属类可挂，故按结构定位：标题与描述同住一个 .fn__flex-1，
   容器给标题排版、描述再单独回落 12px/400。两处均子组件产物 → `:global()`。 */
    .wengu-start .wengu-start-card :global(.wengu-formrow) > :global(.fn__flex-1) {
        font-size: 13.5px;
        font-weight: 600;
    }

    .wengu-start :global(.wengu-formrow) :global(.b3-label__text) {
        margin-top: 2px;
        font-size: 12px;
        font-weight: 400;
        color: var(--b3-theme-on-surface-light);
    }

    /* 控件最小宽 300px（替换 fn__size200 的 200px；窄屏由内核响应式
   堆叠规则接管，见 base.scss 的 .b3-label.wengu-formrow 段）。
   控件类名经 class= 传给 Select/input 子组件 → `:global()`。 */
    .wengu-start :global(.wengu-start-ctl) {
        width: 300px;
        min-width: 300px;
    }

    :global(.b3-label.wengu-formrow) > :global(.wengu-start-ctl) {
        width: 300px;
        min-width: 300px;
        margin-top: 0;
    }

    /* 底部动作行：居中、gap 14px、按钮 min-width 132px。
   ⚠️ 本行是 §〇6「横向按钮行一律 8px」的**显式例外**——设计稿屏①
   动作行的规格就是 14px（间距随卡片尺寸放宽），以稿为准。 */
    .wengu-start-actions {
        display: flex;
        justify-content: center;
        gap: 14px;
    }

    .wengu-start :global(.wengu-start-act) {
        min-width: 132px;
        justify-content: center;
    }
</style>
