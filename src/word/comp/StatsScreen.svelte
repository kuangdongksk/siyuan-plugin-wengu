<script lang="ts">
    import { getContext } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import { buildStats } from "../WordStore";
    import type { WordView } from "../WordView";
    import { WORD_VIEW_CTX } from "../WordUi";
    import NavExtras from "./NavExtras.svelte";
    import WordHead from "./WordHead.svelte";

    /** 统计页：累计进度/今日打卡/误认与太简单/连续天数 + 未来 7 天到期柱状。 */
    const view = getContext<WordView>(WORD_VIEW_CTX)!;
    const ui = view.ui;
    const t = view.t;
    const p = $derived(ui.progress!);
    const s = $derived(buildStats(p));
    const max = $derived(Math.max(1, ...s.next7));

    /** 未来第 i 天的横轴标签（0=今天，1=明天，其余 MM-DD）。 */
    function dayLabel(i: number): string {
        if (i === 0) return "今";
        if (i === 1) return "明";
        const d = new Date(Date.now() + i * 86400_000);
        return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
</script>

<div class="wengu-word">
    <WordHead showSet>
        {#snippet extra()}
            <NavExtras />
        {/snippet}
    </WordHead>
    <div class="wengu-stats">
        {#snippet cell(v: number, key: string)}
            <div class="wengu-stats-cell">
                <div class="wengu-stats-num">{v}</div>
                <div class="wengu-stats-label">{t(key)}</div>
            </div>
        {/snippet}
        <div class="wengu-stats-row">
            {@render cell(s.learned, "wordStatsLearned")}
            {@render cell(s.left, "wordStatsLeft")}
            {@render cell(s.mastered, "wordStatsMastered")}
        </div>
        <div class="wengu-stats-row">
            {@render cell(s.todayNew, "wordStatsTodayNew")}
            {@render cell(s.todayRev, "wordStatsTodayRev")}
            {@render cell(s.streak, "wordStatsStreakN")}
        </div>
        <div class="wengu-stats-sub">
            {fmt(t("wordStatsLine2"), {
                a: String(s.mistakes),
                b: String(s.mistakesPending),
                c: String(s.familiar),
                d: String(s.starred),
                e: String(s.simple),
            })}
        </div>
        <div class="wengu-stats-chart-title">{t("wordStatsNext7")}</div>
        <div class="wengu-stats-bars">
            {#each s.next7.slice(0, 8) as c, i}
                <div class="wengu-stats-bar" class:wengu-stats-bar-today={i === 0} title={String(c)}>
                    <div class="wengu-stats-bar-col" style="height:{Math.max(4, Math.round((c / max) * 100))}%"></div>
                    <div class="wengu-stats-bar-count">{c > 0 ? c : ""}</div>
                    <div class="wengu-stats-bar-label">{dayLabel(i)}</div>
                </div>
            {/each}
        </div>
        <div class="wengu-word-form-actions">
            <button class="b3-button b3-button--outline" onclick={() => view.goHome()}
                >{@html svgIcon("iconList")} {t("wordBackHome")}</button
            >
        </div>
    </div>
</div>
