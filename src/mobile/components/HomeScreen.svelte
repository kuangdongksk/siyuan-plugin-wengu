<script lang="ts">
    import { getContext } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import Button from "../../ui/Button.svelte";
    import { MOBILE_DRILL_CTX, type MobileDrill } from "../core/MobileCtx";
    import { countChoices, countLabel, groupSetsByDoc } from "../core/MobileModel";
    import { fmt } from "../../ui/shared";

    /**
     * 屏 ① 开刷面板（设计稿 `design/wengu-mobile-drill.html`）：续刷卡片
     * 置顶直达上次进度；先选「判分模式」与「本次题数」，再进入按源文档
     * 分组的题集清单，行内进度条显示做题进度。
     */
    const drill: MobileDrill = getContext(MOBILE_DRILL_CTX);

    const t = (k: string) => drill.t(k);
    const pct = (a: number, n: number) => (n > 0 ? Math.round((a / n) * 100) : 0);
    // 恢复卡的已答/题数/题集标题一律取 `ui.resumeView`（由 core/MobileRound
    // 的探测与恢复路径预解）——组件不再自拼分母：跨题集时那是错的
    // （Issue #167 A1/A2：未完成轮可能在别的题集，或来自「本次 N 题」裁剪）。
</script>

<div class="wengu-md-toolrow">
    <div class="wengu-md-brand">
        <span class="wengu-md-logo">{@html svgIcon("iconWengu")}</span>
        {t("pluginName")}<small>{t("mobileSubtitle")}</small>
    </div>
</div>

<div class="wengu-md-scroll">
    {#if drill.ui.home.loading}
        <div class="wengu-md-muted">{t("loading")}</div>
    {:else if drill.ui.home.error}
        <div class="wengu-md-status-err">{t("loadFailed")}{drill.ui.home.error}</div>
    {:else if drill.ui.home.sets.length === 0}
        <div class="wengu-md-muted">{t("noExerciseDocs")}</div>
    {:else}
        {#if drill.ui.resume && drill.ui.resumeView}
            {@const last = drill.ui.resume}
            {@const view = drill.ui.resumeView}
            <section class="wengu-md-resume">
                <div class="wengu-md-resume-top">
                    <span class="wengu-md-resume-tag">{@html svgIcon("iconPlay")}{t("mobileContinueTag")}</span>
                    <span class="wengu-md-resume-meta">{t("mobileAnsweredCount")} {view.answered}/{view.total}</span>
                </div>
                <h3>
                    {view.title}
                    <small>{last.revealMode === "after" ? t("revealAfter") : t("revealInstant")}</small>
                </h3>
                <div class="wengu-md-resume-foot">
                    <span class="wengu-md-pbar"><i style="width:{pct(view.answered, view.total)}%"></i></span>
                    <button class="wengu-md-resume-btn" onclick={() => void drill.resumeRound()}>
                        {t("mobileContinueCta")}{@html svgIcon("iconRight")}
                    </button>
                </div>
            </section>
        {/if}

        <section class="wengu-md-card">
            <div class="wengu-md-card-label">{t("mobileRevealTitle")}</div>
            <div class="wengu-md-modes">
                <button
                    class="wengu-md-mode{drill.ui.setup.reveal === 'instant' ? ' on' : ''}"
                    onclick={() => (drill.ui.setup.reveal = "instant")}
                >
                    <span class="wengu-md-radio"></span><b>{t("mobileRevealInstant")}</b>
                    <small>{t("mobileRevealInstantDesc")}</small>
                </button>
                <button
                    class="wengu-md-mode{drill.ui.setup.reveal === 'after' ? ' on' : ''}"
                    onclick={() => (drill.ui.setup.reveal = "after")}
                >
                    <span class="wengu-md-radio"></span><b>{t("mobileRevealAfter")}</b>
                    <small>{t("mobileRevealAfterDesc")}</small>
                </button>
            </div>
            <div class="wengu-md-card-label" style="margin-top:14px">{t("mobileCountTitle")}</div>
            <div class="wengu-md-seg">
                {#each countChoices(drill.ui.fullList.length) as n (n)}
                    <button class={drill.ui.setup.count === n ? "on" : ""} onclick={() => (drill.ui.setup.count = n)}>
                        {countLabel(n, drill.ui.fullList.length, t)}
                    </button>
                {/each}
            </div>
            <div class="wengu-md-setgroups">
                {#each groupSetsByDoc(drill.ui.home.sets) as g (g.key)}
                    <div class="wengu-md-setgroup">
                        <div class="wengu-md-setgroup-head">
                            {@html svgIcon("iconFile")}{g.title}
                            <span class="wengu-md-setcount"
                                >{fmt(t("mobileSetGroupCount"), { n: String(g.sets.length) })}</span
                            >
                        </div>
                        <div class="wengu-md-sets">
                            {#each g.sets as s (s.id)}
                                <button
                                    class="wengu-md-setitem{s.id === drill.ui.home.activeSetId ? ' on' : ''}"
                                    onclick={() => void drill.selectSet(s.id)}
                                >
                                    <span class="wengu-md-setrow1">
                                        <b>{s.title || s.id}</b>
                                        {#if s.id === drill.ui.home.activeSetId}
                                            <span class="wengu-md-setbadge">{t("mobileSetActive")}</span>
                                        {/if}
                                        <span class="wengu-md-setcount"
                                            >{fmt(t("exerciseCount"), { n: String(s.total) })}</span
                                        >
                                    </span>
                                    <span class="wengu-md-setrow2">
                                        <span class="wengu-md-pbar"
                                            ><i style="width:{pct(s.attempted, s.total)}%"></i></span
                                        >
                                        <span>{s.attempted}/{s.total}</span>
                                    </span>
                                </button>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>
        </section>

        <div class="wengu-md-startrow">
            <Button variant="primary" class="wengu-md-btn-solid" onclick={() => drill.start("fresh")}
                >{t("startDrill")}</Button
            >
        </div>
    {/if}
</div>
