<script lang="ts">
    import { getContext } from "svelte";
    import { statusIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import WORD_BOOK from "../WordBook";
    import { confusableHtml, wordNoteHtml } from "../WordConfusables";
    import { buildMeaningOptions, buildWordOptions, meaningLine, MODE_KEY } from "../WordQuiz";
    import type { WordView } from "../WordView";
    import { WORD_VIEW_CTX } from "../WordUi";

    /** 一张答题卡（五题型；题面标色/详情/自述输入按作答态切换）。 */
    const view = getContext<WordView>(WORD_VIEW_CTX)!;
    const ui = view.ui;
    const t = view.t;

    let cardEl: HTMLElement | undefined = $state();
    let spellEl: HTMLInputElement | undefined = $state();
    // 换卡/翻面/作答后恢复焦点（对齐旧 innerHTML 全量重绘的焦点行为：
    // 键盘热键依赖焦点落在容器内）
    $effect(() => {
        void ui.idx;
        void ui.phase;
        void ui.cardMode;
        void ui.answered;
        if (ui.cardMode === "spell" && ui.phase === "prompt" && !ui.answered) spellEl?.focus();
        else cardEl?.focus();
    });

    const p = $derived(ui.progress!);
    const idx = $derived(ui.idx);
    const entry = $derived(WORD_BOOK.words[idx]);
    const mode = $derived(ui.cardMode);
    const reveal = $derived(ui.phase === "result");
    const answered = $derived(ui.answered);
    const isChoice = $derived(mode === "choiceEn" || mode === "choiceZh");
    const choices = $derived(
        isChoice ? (mode === "choiceEn" ? buildMeaningOptions(idx, ui.confIds) : buildWordOptions(idx, ui.confIds)) : []
    );
    const correctText = $derived(mode === "choiceEn" ? meaningLine(idx) : entry.w);
    const mistake = $derived(p.mistakes[String(idx)]);
    const starred = $derived(!!p.starred[String(idx)]);
    const wrongPending = $derived(reveal || (answered !== undefined && !answered.correct));
    const revealedCls = $derived(reveal || answered !== undefined ? " wengu-word-revealed" : "");
    // 自述框出现条件：「记错了」已点 / 正面选了「忘记」（对应参考流三态）
    const confessPending = $derived(ui.mistakeClaimed || ui.selfGrade === "no");

    function optCls(i: number): string {
        if (!answered) return "";
        if (answered.pick === i) return answered.correct ? " is-correct" : " is-wrong";
        if (choices[i].text === correctText) return " is-correct";
        return " is-dim";
    }
</script>

<!-- 键盘可达性由根容器统一分发（空格=翻面），卡片 div 只承接点击翻面与焦点 -->
<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_noninteractive_tabindex,a11y_no_static_element_interactions -->
<div class="wengu-word-card{revealedCls}" tabindex="0" bind:this={cardEl} onclick={() => view.reveal()}>
    <div class="wengu-word-unit">{t(MODE_KEY[mode])}</div>
    <div class="wengu-word-tools">
        <button
            class="wengu-iconbtn wengu-word-star"
            class:is-starred={starred}
            title={t("wordStar")}
            onclick={(e) => {
                e.stopPropagation();
                view.toggleStarCard();
            }}
        >
            <svg><use xlink:href="#iconStar"></use></svg>
        </button>
        {#if wrongPending}
            <button
                class="wengu-iconbtn"
                title={t("wordFamiliarTip")}
                onclick={(e) => {
                    e.stopPropagation();
                    view.finishMastered();
                }}>{t("wordFamiliar")}</button
            >
        {/if}
    </div>

    {#snippet detail()}
        <div class="wengu-word-detail">
            <div class="wengu-word-detail-word">{entry.w}</div>
            <div class="wengu-word-detail-meaning">{entry.m}</div>
            {#if mistake?.confused}
                <div class="wengu-word-confused">{fmt(t("wordConfusedChip"), { v: mistake.confused })}</div>
            {/if}
            {@html wordNoteHtml(p, idx) + confusableHtml(t, p, idx)}
            {#if mistake?.note}
                <div class="wengu-word-ainote">{t("wordAiNote")}{mistake.note}</div>
            {/if}
        </div>
    {/snippet}

    <!-- 结果视图公共件：自述输入（客观题答错/记错了/选了忘记）；熟按钮在右上角工具组 -->
    {#snippet resultTail()}
        {#if confessPending}
            <div class="wengu-word-confess">
                <span class="wengu-word-confess-label">{fmt(t("wordConfusedHint"), { w: entry.w })}</span>
                <input
                    class="b3-text-field wengu-word-spell"
                    data-field="confessed"
                    autocomplete="off"
                    placeholder={t("wordConfusedPh")}
                    bind:value={ui.confessedDraft}
                />
            </div>
        {/if}
    {/snippet}

    {#if isChoice}
        <div class={mode === "choiceEn" ? "wengu-word-text" : "wengu-word-zh"}>
            {mode === "choiceEn" ? entry.w : meaningLine(idx)}
        </div>
        {#if answered}
            <div class="wengu-word-feedback">
                {@html statusIcon(answered.correct ? "right" : "wrong")}
                {answered.correct ? t("wordCorrectPick") : t("wordWrongPick2")}
            </div>
        {:else}
            <div class="wengu-word-hint">{t("wordPickHint")}</div>
        {/if}
        <div class="wengu-word-opts">
            {#each choices as o, i}
                <button
                    class="b3-button wengu-word-opt{optCls(i)}"
                    disabled={answered !== undefined}
                    onclick={() => view.option(i)}>{o.text}</button
                >
            {/each}
        </div>
        {#if answered && !answered.correct && answered.pickFrom !== undefined && answered.pickFrom !== idx}
            <div class="wengu-word-wrongpick">
                {t("wordWrongPickEntry")}：{WORD_BOOK.words[answered.pickFrom].w}
                {WORD_BOOK.words[answered.pickFrom].m.split("\n")[0]}
            </div>
        {/if}
        {#if answered}
            {@render detail()}
            {@render resultTail()}
            <div class="wengu-word-actions wengu-word-grades">
                <button class="b3-button b3-button--outline" onclick={() => view.continueObjective()}
                    >{t("wordNext")}</button
                >
                {#if !answered.correct}
                    <button class="b3-button b3-button--outline" onclick={() => view.claimMistake()}
                        >{t("wordMarkWrong")}</button
                    >
                {/if}
            </div>
        {/if}
    {:else if mode === "spell"}
        <div class="wengu-word-zh">{meaningLine(idx)}</div>
        {#if answered}
            <div class="wengu-word-feedback">
                {@html statusIcon(answered.correct ? "right" : "wrong")}
                {answered.correct ? t("wordSpellOk") : fmt(t("wordSpellWrong"), { w: entry.w })}
            </div>
            {@render detail()}
            {@render resultTail()}
            <div class="wengu-word-actions wengu-word-grades">
                <button class="b3-button b3-button--outline" onclick={() => view.continueObjective()}
                    >{t("wordNext")}</button
                >
                {#if !answered.correct}
                    <button class="b3-button b3-button--outline" onclick={() => view.claimMistake()}
                        >{t("wordMarkWrong")}</button
                    >
                {/if}
            </div>
        {:else}
            <input
                class="b3-text-field wengu-word-spell"
                data-field="spell"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder={t("wordSpellPlaceholder")}
                bind:value={ui.spellLive}
                bind:this={spellEl}
            />
            <div class="wengu-word-actions">
                <button class="b3-button b3-button--outline" onclick={() => view.submitSpell()}
                    >{t("wordSubmit")}</button
                >
            </div>
        {/if}
    {:else if reveal}
        <!-- recallEn/recallZh 翻面结果：正面已选档 → 下一个 + 记错了；空翻（点卡/空格）仍给三档兜底 -->
        <div class="wengu-word-feedback">{t(mode === "recallEn" ? "wordSelfEn" : "wordSelfZh")}</div>
        {@render detail()}
        {@render resultTail()}
        {#if ui.selfGrade}
            <div class="wengu-word-actions wengu-word-grades">
                <button class="b3-button b3-button--outline" onclick={() => view.nextGraded()}>{t("wordNext")}</button>
                <button class="b3-button b3-button--outline" onclick={() => view.claimMistake()}
                    >{t("wordMarkWrong")}</button
                >
            </div>
        {:else}
            <div class="wengu-word-actions wengu-word-grades">
                <button class="b3-button b3-button--outline" onclick={() => view.grade("no")}>{t("wordGradeNo")}</button
                >
                <button class="b3-button b3-button--outline" onclick={() => view.grade("fuzzy")}
                    >{t("wordGradeFuzzy")}</button
                >
                <button class="b3-button b3-button--outline" onclick={() => view.grade("know")}
                    >{t("wordGradeKnow")}</button
                >
            </div>
        {/if}
    {:else}
        <!-- 回想正面：直接选档（选完翻面看详情），点卡/空格仍可静默翻面 -->
        <div class={mode === "recallEn" ? "wengu-word-text" : "wengu-word-zh"}>
            {mode === "recallEn" ? entry.w : meaningLine(idx)}
        </div>
        <div class="wengu-word-hint">{t("wordRecallHint")}</div>
        <div class="wengu-word-actions wengu-word-grades">
            <button class="b3-button b3-button--outline" onclick={() => view.pickSelfGrade("know")}
                >{t("wordGradeKnow")}</button
            >
            <button class="b3-button b3-button--outline" onclick={() => view.pickSelfGrade("fuzzy")}
                >{t("wordGradeFuzzy")}</button
            >
            <button class="b3-button b3-button--outline" onclick={() => view.pickSelfGrade("no")}
                >{t("wordGradeNo")}</button
            >
        </div>
    {/if}
</div>
