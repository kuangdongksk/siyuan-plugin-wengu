<script lang="ts">
    import { getContext } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import Button from "../../ui/Button.svelte";
    import { buildQueue, starredList } from "../core/WordStore";
    import type { WordView } from "../core/WordView";
    import { WORD_VIEW_CTX } from "../core/WordUi";
    import AiMsg from "./AiMsg.svelte";
    import NavExtras from "./NavExtras.svelte";
    import WordHead from "./WordHead.svelte";

    /** 每日首页（到期复习/新学/星标入口）与「先复习」确认层。 */
    const view = getContext<WordView>(WORD_VIEW_CTX)!;
    const ui = view.ui;
    const t = view.t;
    const p = $derived(ui.progress!);
    const queues = $derived(buildQueue(p));
    const starN = $derived(starredList(p).length);
    const empty = $derived(queues.review.length === 0 && queues.freshLeft === 0 && starN === 0);
</script>

<div class="wengu-word">
    <WordHead showSet>
        {#snippet extra()}
            <NavExtras />
        {/snippet}
    </WordHead>
    <AiMsg />
    {#if ui.mode === "askreview"}
        <div class="wengu-word-card wengu-word-revealed wengu-word-askreview">
            <span class="wengu-word-entry-ico">{@html svgIcon("iconRefresh")}</span>
            <div class="wengu-word-zh">{fmt(t("wordAskReview"), { n: String(queues.review.length) })}</div>
            <div class="wengu-word-actions">
                <Button variant="primary" onclick={() => view.goReview()}>{t("wordGoReview")}</Button>
                <Button variant="outline" onclick={() => view.goFreshAnyway()}>{t("wordStillFresh")}</Button>
            </div>
        </div>
    {:else}
        <div class="wengu-word-entries">
            {#if queues.review.length > 0}
                <Button class="wengu-word-entry wengu-word-entry-main" onclick={() => view.goReview()}>
                    <span class="wengu-word-entry-ico">{@html svgIcon("iconRefresh")}</span>
                    <span class="wengu-word-entry-txt">
                        <span class="wengu-word-entry-title">{t("wordHomeReviewTitle")}</span>
                        <span class="wengu-word-entry-count"
                            >{fmt(t("wordHomeReviewCount"), { n: String(queues.review.length) })}</span
                        >
                    </span>
                    <span class="wengu-word-entry-num">
                        <b>{queues.review.length}</b>
                        <span>{t("wordHomeUnit")}</span>
                    </span>
                </Button>
            {/if}
            {#if queues.freshLeft > 0}
                <Button class="wengu-word-entry" onclick={() => view.goFresh()}>
                    <span class="wengu-word-entry-ico">{@html svgIcon("iconAdd")}</span>
                    <span class="wengu-word-entry-txt">
                        <span class="wengu-word-entry-title">{t("wordHomeFreshTitle")}</span>
                        <span class="wengu-word-entry-count"
                            >{fmt(t("wordHomeFreshCount"), { n: String(queues.freshLeft) })}</span
                        >
                    </span>
                    <span class="wengu-word-entry-num">
                        <b>{queues.freshLeft}</b>
                        <span>{t("wordHomeUnit")}</span>
                    </span>
                </Button>
            {/if}
            {#if starN > 0}
                <Button class="wengu-word-entry" onclick={() => view.goStar()}>
                    <span class="wengu-word-entry-ico">{@html svgIcon("iconStar")}</span>
                    <span class="wengu-word-entry-txt">
                        <span class="wengu-word-entry-title">{t("wordHomeStarTitle")}</span>
                        <span class="wengu-word-entry-count">{fmt(t("wordHomeStarCount"), { n: String(starN) })}</span>
                    </span>
                    <span class="wengu-word-entry-num">
                        <b>{starN}</b>
                        <span>{t("wordHomeUnit")}</span>
                    </span>
                </Button>
            {/if}
            {#if empty}
                <div class="wengu-word-entry wengu-word-entry-muted">{t("wordBookDone")}</div>
            {/if}
        </div>
    {/if}
</div>

<!-- 样式绑定（design-spec §13.1）：入口卡类名不出现在 TS 拼串里、不被其它
    组件复用，且原 words-home.scss 对本组件成对覆写（移动片须同批迁移），
     故整族随组件走；子组件渲染 + {@html svgIcon} 注入的类名一律 :global() 包壳。 -->
<style lang="scss">
    .wengu-word .wengu-word-entries {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin: auto 0;
        width: 100%;
    }

    .wengu-word .wengu-word-entry {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 82px;
        padding: 13px 14px;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius-b);
        background: var(--b3-theme-surface);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        cursor: pointer;
        height: auto;
        width: 100%;
        text-align: left;

        &:hover {
            border-color: var(--b3-theme-primary-light);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
        }
    }

    /* 复习入口（稿①「主色软底 + 左侧主色竖条」）：唯一主色强调项。
       `wengu-word-entry-main` 随 class 传给 Button 子组件 ⇒ scoped 失配，
       整条必须 :global() 包壳。 */
    .wengu-word :global(.wengu-word-entry-main) {
        background: var(--b3-theme-primary-lightest);
        border-color: var(--b3-theme-primary-light);

        &::before {
            content: "";
            position: absolute;
            left: -1px;
            top: 14px;
            bottom: 14px;
            width: 3px;
            border-radius: 999px;
            background: var(--b3-theme-primary);
        }
    }

    .wengu-word :global(.wengu-word-entry-ico) {
        width: 36px;
        height: 36px;
        flex: 0 0 auto;
        border-radius: var(--b3-border-radius-b);
        display: grid;
        place-items: center;
        background: var(--b3-theme-background-light);
        color: var(--b3-theme-on-surface-light);

        :global(svg) {
            width: 18px;
            height: 18px;
        }
    }

    .wengu-word :global(.wengu-word-entry-main .wengu-word-entry-ico) {
        background: var(--b3-theme-primary-lighter);
        color: var(--b3-theme-primary);
    }

    .wengu-word :global(.wengu-word-entry-txt) {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .wengu-word :global(.wengu-word-entry-title) {
        font-size: 13.5px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .wengu-word :global(.wengu-word-entry-count) {
        font-size: 11.5px;
        color: var(--b3-theme-on-surface-light);
    }

    .wengu-word :global(.wengu-word-entry-num) {
        margin-left: auto;
        text-align: right;
        flex: 0 0 auto;

        b {
            display: block;
            font-size: 21px;
            line-height: 1.05;
            font-weight: 600;
            font-variant-numeric: tabular-nums;
            color: var(--b3-theme-on-background);
        }

        span {
            font-size: 10.5px;
            color: var(--b3-theme-on-surface-light);
        }
    }

    .wengu-word :global(.wengu-word-entry-main .wengu-word-entry-num b) {
        color: var(--b3-theme-primary);
    }

    .wengu-word .wengu-word-entry-muted {
        cursor: default;
        justify-content: center;
        color: var(--b3-theme-on-surface-light);
        font-size: 13px;
    }

    /* 先复习确认层（稿②）：单卡居中，一个主 CTA + 一个弱化动作 */
    .wengu-word .wengu-word-askreview {
        flex: 0 0 auto;
        gap: 14px;
        padding: 18px;
        margin: auto 0;
    }

    .wengu-word .wengu-word-askreview .wengu-word-zh {
        font-size: 13.5px;
        line-height: 1.7;
        color: var(--b3-theme-on-surface);
    }

    .wengu-word .wengu-word-askreview .wengu-word-actions {
        width: 100%;
        flex-direction: column;
        gap: 8px;
        margin-top: 2px;
    }
</style>
