<script lang="ts">
    import { getContext } from "svelte";
    import type { WordView } from "../core/WordView";
    import { WORD_VIEW_CTX } from "../core/WordUi";

    /** AI 状态/结果条（卡片页/首页/完成页头部下方；"!" 前缀=失败标红）。 */
    const view = getContext<WordView>(WORD_VIEW_CTX)!;
    const ui = view.ui;
    const t = view.t;
    const isErr = $derived(!ui.aiRunning && ui.aiMsg.startsWith("!"));
    const text = $derived(ui.aiRunning ? t("wordAiRunning") : ui.aiMsg.replace(/^!/, ""));
</script>

{#if ui.aiRunning || ui.aiMsg}
    <div class="wengu-word-aimsg" class:wengu-word-ai-err={isErr}>{text}</div>
{/if}
