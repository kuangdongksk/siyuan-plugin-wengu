<script lang="ts">
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import { typeKey } from "../render/CardParts";
    import type { CardHtmlModel } from "../render/CardParts";
    import { isChoice, isObjective } from "../render/CardHtml";
    import { optionInline } from "../service/ProtyleHost";
    import { hasSlots, hasSteps, isBriefLike, LETTERS, optionDisplayMd, QuestionType } from "../../types";
    import type { WenguQuestion } from "../../types";

    /**
     * 单张题卡（6-4a 渲染层组件化）：普通/多步(steps)/逐空(slots)三形态，
     * DOM 与旧 renderCardHtml/renderStepsCardHtml/renderSlotsCardHtml
     * 逐字一致——类名、data-* 契约、hidden 初始态全保留，三流程
     * （Answer/Steps/Slot）与 PreviewFlow 的 DOM 读写、全局 scss 零改动。
     * 组件无自有状态、props 挂载后不变，外部（判分/恢复/预览装饰）直改
     * DOM 不会被覆写；作答态收敛为卡内响应态是 6-4b。
     * 步骤引导语/选项留占位（data-step-stem/data-opt-text）由
     * StepsFlow.fillOneStep 填充渲染公式；cloze 当前空选项由
     * SlotFlow.fillClozeSlot 按空重灌——见各 Flow。
     */
    let {
        q,
        idx,
        m,
        hidden = false,
    }: {
        q: WenguQuestion;
        idx: number;
        m: CardHtmlModel;
        /** 材料组内非当前题初始隐藏（MaterialFlow 切题时挪 hidden）。 */
        hidden?: boolean;
    } = $props();

    // 以下派生值刻意只取挂载时快照：组件无自有状态，props（题目/设置
    // 开关）整壳重建才变——重建=卸载重挂，非响应更新（NumRail 同款）
    // svelte-ignore state_referenced_locally
    const t = m.t;
    // svelte-ignore state_referenced_locally
    // 卡头自评徽标口径：steps 卡恒带（false）、slots 卡恒不带（true）
    // svelte-ignore state_referenced_locally
    const headObjective = hasSteps(q) ? false : hasSlots(q) ? true : isObjective(q);
    // svelte-ignore state_referenced_locally
    const label = q.knowledge || q.chapter;
    // svelte-ignore state_referenced_locally
    const letters = (q.optionMd ?? []).map((_, i) => LETTERS[i] ?? "");
    // match 候选池渲染期一次性预建（旧 renderMatchArea 同源）
    // svelte-ignore state_referenced_locally
    const pool = (q.optionMd ?? []).map((md, i) => {
        const { body, tier } = optionInline(optionDisplayMd(md));
        return { letter: LETTERS[i] ?? "", body, tier };
    });
</script>

<!-- 卡头：题号 + 题型徽标 + 知识点标题 + 难度/来源/次数 + 重新生成（零样式差异） -->
{#snippet head(obj: boolean)}
    <div class="wengu-card-head">
        <span class="wengu-card-num">{idx + 1}</span>
        {#if q.type}<span class="wengu-badge">{t(typeKey(q.type))}</span>{/if}
        {#if label}<span class="wengu-card-title">{label}</span>{/if}
        {#if !obj}<span class="wengu-badge">{t("selfBadge")}</span>{/if}
        {#if q.difficulty}
            <span class="wengu-meta">{@html svgIcon("iconStar", "wengu-star").repeat(q.difficulty)}</span>
        {/if}
        {#if q.source}<span class="wengu-meta">{q.source}</span>{/if}
        {#if q.attempts > 0 && m.showAttempts}
            <span class="wengu-meta">{fmt(t("attempts"), { n: String(q.attempts) })}</span>
        {/if}
        {#if q.wrongCount > 0 && m.showWrongBadge}
            <span class="wengu-meta wengu-wrong-count">{fmt(t("wrongCount"), { n: String(q.wrongCount) })}</span>
        {/if}
        <button class="wengu-side-iconbtn wengu-regen-btn" data-act="regen" title={t("regenTitle")}>
            {@html svgIcon("iconRefresh")}
        </button>
    </div>
{/snippet}

<!-- 「思路」折叠输入区（收卷快照进会话 thoughts） -->
{#snippet thoughtArea()}
    <button class="wengu-thought-toggle" data-act="thought-toggle"
        >{@html svgIcon("iconEdit")} {t("thoughtToggle")}</button
    >
    <div class="wengu-thought" data-thought-wrap hidden>
        <textarea class="wengu-input" data-field="thought" rows="3" placeholder={t("thoughtPlaceholder")}></textarea>
    </div>
{/snippet}

<!-- 题干静态渲染占位（ProtyleHost.mountStatic 填 MdRender 产物 + 解析区） -->
{#snippet protyle()}
    <div class="wengu-qprotyle" data-qprotyle><span class="wengu-muted">…</span></div>
{/snippet}

<!-- 静态 Protyle 占位 + 结果/提示行（steps/slots/普通卡尾部件） -->
{#snippet tailRows()}
    <div class="wengu-result" data-result hidden></div>
    <div class="wengu-note" data-note hidden></div>
{/snippet}

<div class="wengu-card" data-qid={q.id} data-idx={idx} {hidden}>
    {@render head(headObjective)}
    {#if hasSteps(q)}
        <!-- 多步引导卡：Protyle 题干 + 逐步解锁作答区（step-* 子块在静态
             渲染里被 CSS 隐藏防剧透，选项解锁后由 fillOneStep 填充） -->
        {@render protyle()}
        <div class="wengu-steps" data-steps>
            {#each q.steps ?? [] as step, k (k)}
                <div class="wengu-step" data-step={k} hidden={k > 0}>
                    <div class="wengu-step-head">
                        <span class="wengu-badge wengu-step-kind">
                            {step.kind === "method" ? t("stepMethodBadge") : t("stepResultBadge")}
                        </span>
                        <span class="wengu-step-stem" data-step-stem></span>
                    </div>
                    <div class="wengu-step-opts">
                        {#each step.optionMd as _, i (i)}
                            <button class="wengu-step-opt" data-letter={LETTERS[i] ?? ""}>
                                <span class="wengu-step-letter">{LETTERS[i] ?? ""}</span>
                                <span class="wengu-step-text" data-opt-text></span>
                            </button>
                        {/each}
                    </div>
                    <button class="wengu-btn wengu-step-next" data-act="step-next">{t("stepNext")}</button>
                    <div class="wengu-step-result" data-step-result hidden></div>
                </div>
            {/each}
        </div>
        {@render thoughtArea()}
        {@render tailRows()}
    {:else if hasSlots(q)}
        <!-- 逐空卡：cloze=空号条+当前空选项；match=候选池+槽位行 -->
        {@render protyle()}
        <div class="wengu-slots" data-slots>
            {#if q.type === QuestionType.Match}
                <div class="wengu-matchpool">
                    {#each pool as p, i (i)}
                        <div class="wengu-match-poolitem{p.tier ? ` ${p.tier}` : ''}">
                            <span class="wengu-match-letter">{p.letter}</span><span>{@html p.body}</span>
                        </div>
                    {/each}
                </div>
                <div class="wengu-matchrows">
                    {#each q.slots ?? [] as _, k (k)}
                        <div class="wengu-match-row" data-matchrow={k}>
                            <span class="wengu-match-k">{k + 1}</span>
                            <select class="b3-select wengu-match-sel" data-matchsel={k}>
                                <option value="">—</option>
                                {#each letters as L, i (i)}<option value={L}>{L}</option>{/each}
                            </select>
                            <button class="wengu-btn wengu-match-go" data-act="match-submit" data-k={k}>
                                {t("slotSubmit")}
                            </button>
                        </div>
                    {/each}
                </div>
            {:else}
                <div class="wengu-slotbar" data-slotbar>
                    {#each q.slots ?? [] as _, k (k)}
                        <button class="wengu-slotbtn" data-slotbtn={k}>{k + 1}</button>
                    {/each}
                </div>
                <div class="wengu-slotcur" data-slotcur>
                    <span class="wengu-badge" data-slot-stem></span>
                    <div class="wengu-slot-opts" data-slot-opts></div>
                    <button class="wengu-btn" data-act="slot-submit">{t("slotSubmit")}</button>
                </div>
            {/if}
        </div>
        {@render thoughtArea()}
        {@render tailRows()}
    {:else}
        {@render protyle()}
        <!-- 作答位：选择题字母 chip / 判断按钮 / 填空输入 / 简答·作文·翻译多行 -->
        {#if isChoice(q)}
            <div class="wengu-chips">
                {#each letters as L, i (i)}
                    <button class="wengu-chip" data-letter={L}>{L}</button>
                {/each}
            </div>
        {:else if q.type === QuestionType.Judge}
            <div class="wengu-judge">
                <button class="wengu-btn" data-judge="√">{t("judgeYes")}</button>
                <button class="wengu-btn" data-judge="×">{t("judgeNo")}</button>
            </div>
        {:else if isBriefLike(q)}
            <textarea
                class="wengu-input"
                data-field="mine"
                rows={q.type === QuestionType.Essay ? 10 : 4}
                placeholder={t("inputPlaceholder")}></textarea>
            {#if q.type === QuestionType.Essay}<div class="wengu-wordcount" data-wordcount>0 words</div>{/if}
        {:else}
            <input class="wengu-input" data-field="mine" placeholder={t("inputPlaceholder")} />
        {/if}
        {@render thoughtArea()}
        <button class="wengu-btn" data-act="submit">{t("submit")}</button>
        {@render tailRows()}
        <div class="wengu-ai-comment" data-ai-comment hidden></div>
        <div class="wengu-self" data-self hidden>
            <span>{t("selfAssess")}</span>
            <button class="wengu-btn wengu-btn-success" data-act="self-right">
                {@html svgIcon("iconCheck")}
                {t("selfRight")}
            </button>
            <button class="wengu-btn wengu-btn-error" data-act="self-wrong">
                {@html svgIcon("iconClose")}
                {t("selfWrong")}
            </button>
        </div>
    {/if}
</div>
