<script lang="ts">
    import { getContext } from "svelte";
    import { fmt } from "../../ui/shared";
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
        <div class="wengu-word-text">{title}</div>
        <div class="wengu-word-meaning wengu-word-revealed">{body}</div>
        <div class="wengu-word-actions">
            <button class="b3-button b3-button--outline" disabled={ui.hardN === 0} onclick={() => view.redoHard()}
                >{fmt(t("wordRedoHard"), { n: String(ui.hardN) })}</button
            >
            <button class="b3-button b3-button--outline" onclick={() => view.goHome()}>{t("wordBackHome")}</button>
        </div>
    </div>
</div>
