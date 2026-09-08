<script lang="ts">
    import { getContext } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import { keyOf } from "../core/WordStore";
    import { confusableHtml, groupsOf, wordNoteHtml } from "../service/WordConfusables";
    import { searchWords, statusLine } from "../flow/WordLookup";
    import type { WordView } from "../core/WordView";
    import { WORD_VIEW_CTX } from "../core/WordUi";
    import AiButton from "./AiButton.svelte";
    import Button from "../../ui/Button.svelte";
    import WordHead from "./WordHead.svelte";

    /** 查词屏：非答题期间搜词书任意词；词条详情可星标/标熟/写笔记。 */
    const view = getContext<WordView>(WORD_VIEW_CTX)!;
    const ui = view.ui;
    const t = view.t;
    const p = $derived(ui.progress!);
    const sel = $derived(ui.lookupSel);
    const hits = $derived(searchWords(ui.lookupQuery));
    const selEntry = $derived(sel !== undefined ? ui.book.words[sel] : undefined);
    const selMistake = $derived(sel !== undefined ? p.mistakes[keyOf(sel)] : undefined);
    const hasConfGroup = $derived(sel !== undefined && groupsOf(p, sel).length > 0);

    // 挂载即聚焦搜索框（输入框随列表态常驻，输入期间焦点自然保持）
    function focusInput(node: HTMLInputElement): void {
        node.focus();
    }
</script>

<div class="wengu-word">
    <WordHead showSet>
        {#snippet extra()}
            <Button class="wengu-iconbtn" title={t("wordStatsTitle")} onclick={() => view.showStats()}
                >{@html svgIcon("iconInfo")}</Button
            >
            {#if ui.fromCard}
                <Button class="wengu-iconbtn" title={t("wordResumeCard")} onclick={() => view.resumeCard()}
                    >{@html svgIcon("iconBack")}</Button
                >
            {:else}
                <Button class="wengu-iconbtn" title={t("wordBackHome")} onclick={() => view.goHome()}
                    >{@html svgIcon("iconList")}</Button
                >
            {/if}
            <AiButton />
        {/snippet}
    </WordHead>
    {#if sel !== undefined && selEntry}
        <div class="wengu-word-card wengu-word-revealed">
            <div class="wengu-word-unit">{statusLine(p, sel, t)}</div>
            <div class="wengu-word-text">{selEntry.w}</div>
            <div class="wengu-word-detail-meaning">{selEntry.m}</div>
            {#if selMistake?.confused}
                <div class="wengu-word-confused">{fmt(t("wordConfusedChip"), { v: selMistake.confused })}</div>
            {/if}
            {@html wordNoteHtml(p, sel) + confusableHtml(t, p, sel)}
            {#if selMistake?.note}
                <div class="wengu-word-ainote">{t("wordAiNote")}{selMistake.note}</div>
            {/if}
            <div class="wengu-word-confuse-edit">
                <input
                    class="b3-text-field"
                    data-field="wordnote"
                    placeholder={t("wordNotePh")}
                    value={view.confCtl.wordDraft}
                    oninput={(e) => view.noteInput("wordnote", e.currentTarget.value)}
                />
                <Button variant="outline" onclick={() => view.wordNoteSave(sel)}>{t("wordNoteSave")}</Button>
            </div>
            {#if hasConfGroup}
                <div class="wengu-word-confuse-edit">
                    <input
                        class="b3-text-field"
                        data-field="confnote"
                        placeholder={t("wordConfuseNotePh")}
                        value={view.confCtl.draft}
                        oninput={(e) => view.noteInput("confnote", e.currentTarget.value)}
                    />
                    <Button variant="outline" onclick={() => view.confAsk(sel)}>{t("wordConfuseAsk")}</Button>
                    <Button variant="outline" onclick={() => view.confSave(sel)}>{t("wordConfuseSave")}</Button>
                </div>
            {/if}
            <div class="wengu-word-actions">
                <Button variant="outline" onclick={() => view.lookupStar(sel)}
                    >{@html svgIcon("iconStar")}{t("wordStar")}</Button
                >
                <Button variant="outline" onclick={() => view.lookupFamiliar(sel)}>{t("wordFamiliar")}</Button>
                <Button variant="outline" onclick={() => view.enterLookup()}>{t("wordLookupBack")}</Button>
            </div>
        </div>
    {:else}
        <div class="wengu-word-card">
            <input
                class="b3-text-field wengu-word-spell"
                data-field="lookup"
                placeholder={t("wordLookupPh")}
                autocomplete="off"
                value={ui.lookupQuery}
                oninput={(e) => view.lookupInput(e.currentTarget.value)}
                use:focusInput
            />
            <div class="wengu-word-opts wengu-word-hits">
                {#if ui.lookupQuery.trim() === ""}
                    <div class="wengu-word-hint">{t("wordLookupHint")}</div>
                {:else if hits.length === 0}
                    <div class="wengu-word-hint">{t("wordLookupNone")}</div>
                {:else}
                    {#each hits as i}
                        <Button class="wengu-word-opt wengu-word-lk" onclick={() => view.lookupPick(i)}>
                            <span class="wengu-word-lk-word">{ui.book.words[i].w}</span>
                            <span class="wengu-word-lk-meaning">{ui.book.words[i].m.split("\n")[0]}</span>
                        </Button>
                    {/each}
                {/if}
            </div>
        </div>
    {/if}
</div>
