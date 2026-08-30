<script lang="ts">
    import { getContext } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import { GROUP_SIZES, groupSizeOf, windowCapOf } from "../core/WordStore";
    import type { WordView } from "../core/WordView";
    import { WORD_VIEW_CTX } from "../core/WordUi";

    /** 起点设置面板：每组单词数/新学窗口（即时生效）+ 词书管理（导入/
     *  设当前/删除，redesign §五）+ 进度导入（TSV）。行样式沿 FormHtml
     *  规范（config-group/config__item，见 docs/design-review.md §〇）。 */
    const view = getContext<WordView>(WORD_VIEW_CTX)!;
    const ui = view.ui;
    const t = view.t;
    const p = $derived(ui.progress!);
    const gs = $derived(groupSizeOf(p));
    const wc = $derived(windowCapOf(p));
    const hasProgress = $derived(Object.keys(p.words).length > 0 || Object.keys(p.ladder).length > 0);

    let tplCopied = $state(false);
    /** 复制 TSV 模板（值在 i18n wordImportTplValue，随语言本地化；
     * 单测锚定其可被 parseTsv 干净解析）。 */
    async function copyTpl(): Promise<void> {
        const text = t("wordImportTplValue");
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
        }
        tplCopied = true;
        setTimeout(() => (tplCopied = false), 2000);
    }
</script>

<div class="wengu-word">
    <div class="wengu-word-head">
        <span class="wengu-word-title">{t("wordAppTitle")}</span>
        <span class="wengu-word-booksub">{ui.book.title}</span>
    </div>
    <div class="wengu-word-form">
        <div class="config-group">
            <div class="config-title">{t("wordSetStart")}</div>
            <div class="config-items">
                <div class="fn__flex b3-label config__item">
                    <div class="fn__flex-1 fn__flex-center">
                        {t("wordGroupSize")}
                        <div class="b3-label__text">{t("wordGroupSizeDesc")}</div>
                    </div>
                    <div class="fn__space"></div>
                    <select
                        class="b3-select fn__flex-center fn__size200"
                        data-field="groupsize"
                        value={gs}
                        onchange={(e) => view.startCtl().setGroupSize(Number(e.currentTarget.value))}
                    >
                        {#each GROUP_SIZES as n}
                            <option value={n}>{fmt(t("wordGroupOpt"), { n: String(n) })}</option>
                        {/each}
                    </select>
                </div>
                <div class="fn__flex b3-label config__item">
                    <div class="fn__flex-1 fn__flex-center">
                        {t("wordWindowCap")}
                        <div class="b3-label__text">{t("wordWindowCapDesc")}</div>
                    </div>
                    <div class="fn__space"></div>
                    <select
                        class="b3-select fn__flex-center fn__size200"
                        data-field="windowcap"
                        value={wc}
                        onchange={(e) => view.startCtl().setWindowCap(Number(e.currentTarget.value))}
                    >
                        {#each [3, 4, 5, 6, 8, 10] as n}
                            <option value={n}>{fmt(t("wordGroupOpt"), { n: String(n) })}</option>
                        {/each}
                    </select>
                </div>
            </div>
        </div>
        <div class="wengu-word-form-actions">
            {#if hasProgress}
                <button class="b3-button b3-button--cancel" onclick={() => view.cancelSet()}>{t("cancel")}</button>
            {/if}
            <button class="b3-button b3-button--outline" onclick={() => view.applyStart()}>{t("wordApply")}</button>
        </div>
        <div class="config-group">
            <div class="config-title">{t("wordBookGroup")}</div>
            <div class="config-items">
                {#each ui.books as b (b.id)}
                    <div class="fn__flex b3-label config__item">
                        <div class="fn__flex-1 fn__flex-center">
                            <span class="wengu-word-bookname">{b.name}</span>
                            <span class="wengu-word-bookcount">{b.count}</span>
                            {#if b.id === ui.book.id}<span class="b3-tag b3-tag--secondary">{t("wordBookCurrent")}</span
                                >{/if}
                        </div>
                        <div class="fn__space"></div>
                        {#if b.id !== ui.book.id}
                            <button class="b3-button b3-button--small" onclick={() => view.switchBook(b.id)}
                                >{t("wordBookUse")}</button
                            >
                        {/if}
                        <button
                            class="b3-button b3-button--small b3-button--error wengu-word-del"
                            disabled={ui.books.length <= 1}
                            title={ui.books.length <= 1 ? t("wordBookKeepOne") : t("wordBookDelete")}
                            onclick={() => view.removeBook(b.id)}
                        >
                            {@html svgIcon("iconTrashcan")}
                        </button>
                    </div>
                {/each}
                <div class="fn__flex b3-label config__item">
                    <div class="fn__flex-1 fn__flex-center">
                        {t("wordBookImport")}
                        <div class="b3-label__text">{t("wordBookImportDesc")}</div>
                    </div>
                    <div class="fn__space"></div>
                    <button
                        class="b3-button b3-button--outline fn__flex-center"
                        type="button"
                        style="position:relative"
                    >
                        {t("wordBookImport")}
                        <input
                            type="file"
                            accept=".json,.csv"
                            data-field="importbook"
                            class="b3-form__upload"
                            onchange={(e) => {
                                const f = e.currentTarget.files?.[0];
                                if (f) view.importBook(f, e.currentTarget);
                            }}
                        />
                    </button>
                </div>
            </div>
        </div>
        <div class="config-group">
            <div class="config-title">{t("wordImportTitle")}</div>
            <div class="config-items">
                <div class="fn__flex b3-label config__item">
                    <div class="fn__flex-1 fn__flex-center">
                        {t("wordImportFile")}
                        <div class="b3-label__text">{t("wordImportFileDesc")}</div>
                    </div>
                    <div class="fn__space"></div>
                    <button
                        class="b3-button b3-button--outline fn__flex-center"
                        type="button"
                        style="position:relative"
                    >
                        {t("wordImportFile")}
                        <input
                            type="file"
                            accept=".tsv,.txt,.csv"
                            data-field="importfile"
                            class="b3-form__upload"
                            onchange={(e) => {
                                const f = e.currentTarget.files?.[0];
                                if (f) view.importFile(f, e.currentTarget);
                            }}
                        />
                    </button>
                    <button class="b3-button b3-button--outline fn__flex-center" onclick={copyTpl}>
                        {tplCopied ? t("wordImportCopied") : t("wordImportCopyTpl")}
                    </button>
                </div>
            </div>
        </div>
        {#if ui.startMsg}
            <div class="wengu-word-aimsg">{ui.startMsg}</div>
        {/if}
    </div>
</div>
