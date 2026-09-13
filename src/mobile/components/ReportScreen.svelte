<script lang="ts">
    import { getContext } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import Button from "../../ui/Button.svelte";
    import { MOBILE_DRILL_CTX, type MobileDrill } from "../core/MobileCtx";
    import { reportStats, wrongRows } from "../core/MobileModel";

    /**
     * 屏 ⑦ 轮次报告：得分环形图居中直读 +「答对 / 答错 / 未答」三项统计；
     * 错题清单点击回看原题，底部一键「错题再练一轮」。
     * 环形用纯 CSS conic-gradient（零依赖，与桌面报告的条形图同策）。
     */
    const drill: MobileDrill = getContext(MOBILE_DRILL_CTX);
    const t = (k: string) => drill.t(k);
    const stats = $derived(reportStats(drill.ui.list, drill.ui.session));
    const rows = $derived(wrongRows(drill.ui.list, drill.ui.session, t));
    const mmss = (sec: number) => {
        const m = Math.floor(sec / 60);
        return `${m}:${String(sec % 60).padStart(2, "0")}`;
    };
</script>

<div class="wengu-md-toolrow">
    <button class="wengu-md-iconbtn" aria-label={t("mobileBackToSet")} onclick={() => drill.backHome()}>
        {@html svgIcon("iconLeft")}
    </button>
    <div class="wengu-md-brand wengu-md-brand-center">{t("reportTitle")}</div>
    <span class="wengu-md-spacer"></span>
</div>

<div class="wengu-md-scroll">
    <p class="wengu-md-report-meta">
        {drill.ui.home.activeSetTitle} · {stats.total}
        {t("mobileCountSuffix")} · {t("mobileElapsed")}
        {mmss(drill.ui.elapsedSec)}
    </p>

    <section class="wengu-md-hero">
        <div
            class="wengu-md-ring"
            style="--pct:{stats.score}%"
            role="img"
            aria-label="{t('reportScore')} {stats.score}"
        >
            <span class="wengu-md-ringnum"><b>{stats.score}</b><span>{t("mobileScoreLabel")}</span></span>
        </div>
        <div class="wengu-md-stat3">
            <div class="wengu-md-cell">
                <span class="wengu-md-lab">{t("mobileLegendOk")}</span>
                <span class="wengu-md-num ok">{stats.right}</span>
            </div>
            <div class="wengu-md-cell">
                <span class="wengu-md-lab">{t("mobileLegendBad")}</span>
                <span class="wengu-md-num bad">{stats.wrong}</span>
            </div>
            <div class="wengu-md-cell">
                <span class="wengu-md-lab">{t("mobileLegendNone")}</span>
                <span class="wengu-md-num">{stats.none}</span>
            </div>
        </div>
    </section>

    {#if rows.length > 0}
        <section class="wengu-md-card wengu-md-listcard">
            <div class="wengu-md-card-label">{t("mobileWrongList")} · {rows.length}</div>
            {#each rows as r (r.qid)}
                <button class="wengu-md-wrongitem" onclick={() => drill.openQuestion(r.idx)}>
                    <span class="wengu-md-wno">{r.idx + 1}</span>
                    <span class="wengu-md-wt">
                        <b>{t(r.typeKey)} · {r.title}</b>
                        <span>{r.detail}</span>
                    </span>
                </button>
            {/each}
        </section>
    {/if}
</div>

<footer class="wengu-md-dock">
    <div class="wengu-md-dockmain">
        <Button variant="outline" class="wengu-md-btn-slim" onclick={() => drill.backHome()}>
            {t("mobileBackToSet")}
        </Button>
        {#if rows.length > 0}
            <Button class="wengu-md-btn-solid" onclick={() => drill.retryWrong()}>
                {t("mobileRetryWrong")} · {rows.length}
                {t("mobileCountSuffix")}
            </Button>
        {/if}
    </div>
</footer>
