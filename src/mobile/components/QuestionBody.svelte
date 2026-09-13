<script lang="ts">
    import { svgIcon } from "../../ui/FormHtml";
    import { renderMdHtml } from "../../ui/MdRender";
    import { optionInline } from "../../quiz/service/ProtyleHost";
    import { QuestionType, hasSteps } from "../../types";
    import type { WenguQuestion } from "../../types";
    import type { MobileCardState } from "../core/MobileDrill";
    import { isMobileText, lettersOf, stemSummary } from "../core/MobileModel";

    /**
     * 题干 / 材料 / 作答位 / 揭示范（设计稿屏 ②③④⑤⑥）：
     * - 材料组题：材料面板默认收起（只留摘要行 + 展开箭头），小题在材料下方作答；
     * - 单选/多选：选项行（≥52px 触控），多选可多点齐亮、可反悔；
     * - 判断：横排「正确 / 错误」两项式，点选即答；
     * - 简答/解答/填空/翻译：文本输入区 + 公式符号工具条（解答题）；
     * - 揭示：选项标出你的选择与正确答案，答案/解析可折叠展开（屏 ⑤）。
     *
     * 收卷模式（after）下提交只出「已答」，选项**不揭对错**（屏 ⑥）——
     * 描色判据只看 `ui.revealed`，与桌面口径一致。
     */
    let {
        q,
        ui,
        materialHtml,
        matOpen,
        onPick,
        onMine,
        onToggleMat,
    }: {
        q: WenguQuestion;
        ui: MobileCardState;
        /** 材料正文 HTML（组题展开时由编排层过装饰出口产出）。 */
        materialHtml: string;
        matOpen: boolean;
        onPick(letter: string): void;
        onMine(text: string): void;
        onToggleMat(): void;
    } = $props();

    const letters = $derived(lettersOf(q));
    const locked = $derived(ui.locked || ui.revealed);
    const options = $derived((q.optionMd ?? []).map((md, i) => ({ letter: letters[i], ...optionInline(md) })));
    const rightLetters = $derived((q.answer ?? "").toUpperCase());
    const isJudge = $derived(q.type === QuestionType.Judge);
    const isChoice = $derived(letters.length > 0 && !isJudge);
    const isText = $derived(!isJudge && !isChoice && isMobileText(q));
    const judgeRight = $derived(rightLetters.includes("×") ? "×" : "√");
    const matSummary = $derived(stemSummary(q));

    /** 选项描色：揭示后正确项绿、误选红、其余弱化（收卷模式不描）。 */
    function optCls(letter: string): string {
        const picked = ui.letters.includes(letter);
        if (!ui.revealed) return picked ? " on" : "";
        if (rightLetters.includes(letter)) return " right";
        return picked ? " wrong-pick" : " dim";
    }

    /** 判断题描色（√/× 两态）。 */
    function judgeCls(v: string): string {
        const picked = ui.judge === v;
        if (!ui.revealed) return picked ? " on" : "";
        if (judgeRight === v) return " right";
        return picked ? " wrong-pick" : " dim";
    }

    /** 多步题的步骤标题（引导语首行，纯文本）。 */
    const stepTitles = $derived(
        (q.steps ?? []).map((s, i) => ({
            i,
            title: (s.stemMd ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
        }))
    );

    /** 公式符号工具条（插入 LaTeX 片段，解答题用）。 */
    const FT = ["x^{2}", "x_{2}", "\\\\frac{a}{b}", "\\\\sqrt{x}", "\\\\pi", "\\\\lambda", "\\\\theta", "\\\\infty"];
</script>

{#if q.group}
    <section class="wengu-md-matcard{matOpen ? ' open' : ''}">
        <button class="wengu-md-mathead" aria-expanded={matOpen} onclick={onToggleMat}>
            <span class="wengu-md-mattit">
                <b>{q.chapter || q.knowledge || ""}</b>
                {#if !matOpen}<span>{matSummary}</span>{/if}
            </span>
            <span class="wengu-md-chev">{@html svgIcon("iconDown")}</span>
        </button>
        {#if matOpen && materialHtml}
            <div class="wengu-md-matbody">{@html materialHtml}</div>
        {/if}
    </section>
{/if}

<h2 class="wengu-md-stem" data-stem>{@html renderMdHtml(q.stemMd ?? "")}</h2>

{#if hasSteps(q)}
    <ol class="wengu-md-steplist">
        {#each stepTitles as s (s.i)}
            <li class="wengu-md-step{ui.revealed ? ' done' : ''}">{s.title}</li>
        {/each}
    </ol>
{/if}

{#if isJudge}
    <div class="wengu-md-opts duo{locked ? ' locked' : ''}">
        <button class="wengu-md-opt{judgeCls('√')}" disabled={locked} onclick={() => onPick("√")}>
            正确
            {#if ui.revealed && judgeRight === "√"}
                <span class="wengu-md-mark">{@html svgIcon("iconCheck")}答案</span>
            {:else if ui.revealed && ui.judge === "√"}
                <span class="wengu-md-mark">{@html svgIcon("iconClose")}你的选择</span>
            {/if}
        </button>
        <button class="wengu-md-opt{judgeCls('×')}" disabled={locked} onclick={() => onPick("×")}>
            错误
            {#if ui.revealed && judgeRight === "×"}
                <span class="wengu-md-mark">{@html svgIcon("iconCheck")}答案</span>
            {:else if ui.revealed && ui.judge === "×"}
                <span class="wengu-md-mark">{@html svgIcon("iconClose")}你的选择</span>
            {/if}
        </button>
    </div>
{:else if isChoice}
    <div class="wengu-md-opts{locked ? ' locked' : ''}">
        {#each options as o (o.letter)}
            <button class="wengu-md-opt{optCls(o.letter)}" disabled={locked} onclick={() => onPick(o.letter)}>
                <span class="wengu-md-key">{o.letter}</span>
                <span class="wengu-md-txt">{@html o.body}</span>
                {#if ui.revealed && rightLetters.includes(o.letter)}
                    <span class="wengu-md-mark">{@html svgIcon("iconCheck")}答案</span>
                {:else if ui.revealed && ui.letters.includes(o.letter)}
                    <span class="wengu-md-mark">{@html svgIcon("iconClose")}你的选择</span>
                {/if}
            </button>
        {/each}
    </div>
{/if}

{#if isText && !ui.revealed}
    <div class="wengu-md-writer">
        <textarea
            class="wengu-md-input"
            rows={q.type === QuestionType.Essay ? 10 : 4}
            placeholder="输入你的答案…"
            disabled={locked}
            value={ui.mine}
            oninput={(e) => onMine(e.currentTarget.value)}></textarea>
        {#if q.type === QuestionType.Essay}
            <div class="wengu-md-ftools">
                {#each FT as s (s)}
                    <button class="wengu-md-ftool" onclick={() => onMine(`${ui.mine}${s}`)}>{s}</button>
                {/each}
            </div>
        {/if}
    </div>
{/if}

{#if ui.revealed && (q.answer || q.solutionMd)}
    <section class="wengu-md-verdict{ui.ok ? ' good' : ''}">
        <div class="wengu-md-verdict-head">
            <span class="wengu-md-vbadge">
                {@html ui.ok ? svgIcon("iconCheck") : svgIcon("iconClose")}
                {ui.ok ? "答对" : "答错"}
            </span>
            {#if q.answer}
                <span class="wengu-md-vans">答案 <b>{q.answer}</b></span>
            {/if}
        </div>
        {#if q.solutionMd}
            <details class="wengu-md-exp" open>
                <summary>解析</summary>
                <div class="wengu-md-expbody">{@html renderMdHtml(q.solutionMd)}</div>
            </details>
        {/if}
    </section>
{/if}
