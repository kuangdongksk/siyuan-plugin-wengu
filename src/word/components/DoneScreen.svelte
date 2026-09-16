<script lang="ts">
    import { getContext } from "svelte";
    import { fmt } from "../../ui/shared";
    import Button from "../../ui/Button.svelte";
    import type { WordView } from "../core/WordView";
    import { WORD_VIEW_CTX } from "../core/WordUi";
    import AiMsg from "./AiMsg.svelte";
    import NavExtras from "./NavExtras.svelte";
    import WordHead from "./WordHead.svelte";

    /** 会话完成页：按队列种类给文案，含生词重过与回首页。 */
    const view = getContext<WordView>(WORD_VIEW_CTX)!;
    const ui = view.ui;
    const t = view.t;
    const p = $derived(ui.progress!);
    const title = $derived(ui.queueKind === "review" ? t("wordReviewDone") : t("wordDoneTitle"));
    const body = $derived(fmt(t("wordDoneBody"), { a: String(p.today.newCount), b: String(p.today.revCount) }));
</script>

<div class="wengu-word">
    <WordHead showSet>
        {#snippet extra()}
            <NavExtras />
        {/snippet}
    </WordHead>
    <AiMsg />
    <div class="wengu-word-card wengu-word-done">
        <div class="wengu-word-done-title">{title}</div>
        <div class="wengu-word-done-sub">{body}</div>
        <div class="wengu-word-actions">
            <Button variant="primary" disabled={ui.hardN === 0} onclick={() => view.redoHard()}
                >{fmt(t("wordRedoHard"), { n: String(ui.hardN) })}</Button
            >
            <Button variant="outline" onclick={() => view.goHome()}>{t("wordBackHome")}</Button>
        </div>
    </div>
</div>

<!-- 完成页（稿⑦ 完成卡）：类名仅本组件使用、不出现在 TS 拼串里，随组件走
     （design-spec §13.1）。 -->
<style lang="scss">
    .wengu-word .wengu-word-done {
        align-items: flex-start;
        justify-content: center;
        gap: 6px;
        padding: 18px;
    }

    .wengu-word .wengu-word-done-title {
        font-size: 20px;
        font-weight: 600;
        color: var(--b3-theme-on-background);
    }

    .wengu-word .wengu-word-done-sub {
        font-size: 12px;
        line-height: 1.6;
        color: var(--b3-theme-on-surface-light);
    }

    /* 完成页动作行（稿⑦）：整宽竖排，主 CTA 在上 */
    .wengu-word .wengu-word-done .wengu-word-actions {
        width: 100%;
        flex-direction: column;
        gap: 8px;
        margin-top: 6px;
        background: none;
    }

    .wengu-word .wengu-word-done .wengu-word-actions :global(.b3-button) {
        width: 100%;
        min-height: 36px;
    }
</style>
