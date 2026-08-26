<script lang="ts">
    import { getContext } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import { dueTomorrowCount } from "../WordStore";
    import type { WordView } from "../WordView";
    import { WORD_VIEW_CTX } from "../WordUi";
    import AiButton from "./AiButton.svelte";
    import AiMsg from "./AiMsg.svelte";
    import QuizCard from "./QuizCard.svelte";
    import WordHead from "./WordHead.svelte";

    /** 刷卡屏：头部（今日统计+误认徽标+查词入口）+ AI 条 + 卡片 + 进度条。 */
    const view = getContext<WordView>(WORD_VIEW_CTX)!;
    const ui = view.ui;
    const t = view.t;
    const p = $derived(ui.progress!);
    const mistake = $derived(p.mistakes[String(ui.idx)]);
    const stats = $derived(
        fmt(t("wordTodayStats"), {
            a: String(p.today.newCount),
            b: String(p.today.revCount),
            c: String(ui.queueLen - ui.pos),
            d: String(dueTomorrowCount(p)),
        })
    );
    const pct = $derived(ui.queueLen > 0 ? Math.round((ui.pos / ui.queueLen) * 100) : 0);
</script>

<div class="wengu-word">
    <WordHead {stats} showHome showSet>
        {#snippet mid()}
            {#if mistake}
                <span class="wengu-word-badge">{fmt(t("wordMistakeBadge"), { n: String(mistake.count) })}</span>
            {/if}
        {/snippet}
        {#snippet extra()}
            <!-- 查词入口仅非答题态（已翻面/已作答）给 -->
            {#if ui.phase === "result" || ui.answered}
                <button class="wengu-iconbtn" title={t("wordLookup")} onclick={() => view.enterLookup()}
                    >{@html svgIcon("iconSearch")}</button
                >
            {/if}
            <AiButton />
        {/snippet}
    </WordHead>
    <AiMsg />
    <QuizCard />
    <div class="b3-progress__bar"><span style="width:{pct}%"></span></div>
</div>
