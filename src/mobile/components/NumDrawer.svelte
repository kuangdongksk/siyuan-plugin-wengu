<script lang="ts">
    import { getContext } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import { MOBILE_DRILL_CTX, type MobileDrill } from "../core/MobileCtx";
    import type { MobileCell } from "../types";

    /**
     * 屏 ⑧ 题号抽屉（答题卡）：底部上拉抽屉 + 遮罩；色块图例区分
     * 已答对 / 答错 / 未答，当前题主色描边；材料组题合并为「15–19」
     * 连格占整行（连格宽 = 组内题数，1 题组仍占 1 格）；点任意题号
     * 直达该题（点遮罩或「继续作答」收起）。
     */
    let { cells, onClose }: { cells: MobileCell[]; onClose(): void } = $props();
    const drill: MobileDrill = getContext(MOBILE_DRILL_CTX);
    const t = (k: string) => drill.t(k);

    /** 连格横向跨度（组内题数，上限整行 =「全部小问」）。 */
    const spanOf = (c: MobileCell) => Math.max(1, c.end - c.idx + 1);
</script>

<div class="wengu-md-scrim" role="presentation" onclick={onClose}></div>
<div class="wengu-md-sheet" role="dialog" aria-label={t("mobileDrawerTitle")}>
    <div class="wengu-md-grip"></div>
    <div class="wengu-md-sheet-head">
        <b>{t("mobileDrawerTitle")}</b>
        <span>{t("mobileAnswered")} {drill.ui.cards.filter((c) => c.graded).length}/{drill.ui.list.length}</span>
        <button class="wengu-md-iconbtn" aria-label={t("mobileDrawerClose")} onclick={onClose}>
            {@html svgIcon("iconDown")}
        </button>
    </div>
    <div class="wengu-md-legend">
        <span><i class="lg-ok"></i>{t("mobileLegendOk")}</span>
        <span><i class="lg-bad"></i>{t("mobileLegendBad")}</span>
        <span><i class="lg-none"></i>{t("mobileLegendNone")}</span>
        <span><i class="lg-cur"></i>{t("mobileLegendCur")}</span>
    </div>
    <div class="wengu-md-grid">
        {#each cells as c (c.idx)}
            <button
                class="wengu-md-cellno {c.state}{drill.ui.qIdx === c.idx ? ' cur' : ''}"
                style={c.end > c.idx ? `grid-column: span ${spanOf(c)}` : ""}
                onclick={() => drill.goto(c.idx)}
            >
                {c.idx + 1}{#if c.end > c.idx}–{c.end + 1}{/if}
                {#if c.sub}<small>{c.sub}</small>{/if}
            </button>
        {/each}
    </div>
    <div class="wengu-md-sheet-foot">
        <button class="wengu-md-submitchip" onclick={() => drill.requestEnd()}>{t("mobileSubmitRound")}</button>
        <button class="wengu-md-resume-btn" onclick={onClose}>{t("mobileDrawerResume")}</button>
    </div>
</div>
