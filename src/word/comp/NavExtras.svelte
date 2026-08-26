<script lang="ts">
    import { getContext } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import type { WordView } from "../WordView";
    import { WORD_VIEW_CTX } from "../WordUi";
    import AiButton from "./AiButton.svelte";

    /** 非答题页头部按钮组：统计 + 查词 + AI（Home/Done/Stats 共用）。 */
    const view = getContext<WordView>(WORD_VIEW_CTX)!;
    const t = view.t;
</script>

<button class="wengu-iconbtn" title={t("wordStatsTitle")} onclick={() => view.showStats()}
    >{@html svgIcon("iconInfo")}</button
>
<button class="wengu-iconbtn" title={t("wordLookup")} onclick={() => view.enterLookup()}
    >{@html svgIcon("iconSearch")}</button
>
<AiButton />
