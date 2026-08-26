<script lang="ts">
    import { getContext } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";
    import type { WordView } from "../WordView";
    import { WORD_VIEW_CTX } from "../WordUi";

    /** AI 复盘手动触发按钮（有待办或运行中才显示，状态读 ui 镜像）。 */
    const view = getContext<WordView>(WORD_VIEW_CTX)!;
    const ui = view.ui;
    const t = view.t;
    const title = $derived(
        ui.aiRunning
            ? t("wordAiRunning")
            : ui.aiPending > 0
              ? fmt(t("wordAiPending"), { n: String(ui.aiPending) })
              : t("wordAiNone")
    );
</script>

{#if ui.aiPending > 0 || ui.aiRunning}
    <button class="wengu-iconbtn" {title} disabled={ui.aiRunning} onclick={() => view.aiAnalyze()}
        >{@html svgIcon("iconSparkles")}</button
    >
{/if}
