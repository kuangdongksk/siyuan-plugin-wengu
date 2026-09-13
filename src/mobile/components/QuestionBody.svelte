<script lang="ts">
    import { svgIcon } from "../../ui/FormHtml";
    import { renderMdHtml } from "../../ui/MdRender";
    import { optionInline } from "../../quiz/service/ProtyleHost";
    import { QuestionType, hasSteps } from "../../types";
    import type { WenguQuestion } from "../../types";
    import type { MobileCardState } from "../core/MobileDrill";
    import { answerKindOf, lettersOf, stemSummary } from "../core/MobileModel";

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
        t,
        materialHtml,
        matOpen,
        onPick,
        onMine,
        onToggleMat,
    }: {
        q: WenguQuestion;
        ui: MobileCardState;
        /** i18n 取词（由壳传入，本组件是纯展示件——不持控制器）。 */
        t: (key: string) => string;
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
    // 作答形态唯一判据（MobileModel.answerKindOf）：填空/简答/逐空各走自己的
    // 作答位——改造前按「有没有选项」就地派生，填空题落进空档没有任何作答位
    const kind = $derived(answerKindOf(q));
    const isJudge = $derived(kind === "judge");
    const isChoice = $derived(kind === "choice");
    const isText = $derived(kind === "text");
    const isFill = $derived(kind === "fill");
    const isSlots = $derived(kind === "slots");
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
        {#each ["√", "×"] as v (v)}
            <button class="wengu-md-opt{judgeCls(v)}" disabled={locked} onclick={() => onPick(v)}>
                {v === "√" ? t("judgeYes") : t("judgeNo")}
                {#if ui.revealed && judgeRight === v}
                    <span class="wengu-md-mark">{@html svgIcon("iconCheck")}{t("mobileMarkAnswer")}</span>
                {:else if ui.revealed && ui.judge === v}
                    <span class="wengu-md-mark">{@html svgIcon("iconClose")}{t("mobileMarkMine")}</span>
                {/if}
            </button>
        {/each}
    </div>
{:else if isChoice}
    <div class="wengu-md-opts{locked ? ' locked' : ''}">
        {#each options as o (o.letter)}
            <button class="wengu-md-opt{optCls(o.letter)}" disabled={locked} onclick={() => onPick(o.letter)}>
                <span class="wengu-md-key">{o.letter}</span>
                <span class="wengu-md-txt">{@html o.body}</span>
                {#if ui.revealed && rightLetters.includes(o.letter)}
                    <span class="wengu-md-mark">{@html svgIcon("iconCheck")}{t("mobileMarkAnswer")}</span>
                {:else if ui.revealed && ui.letters.includes(o.letter)}
                    <span class="wengu-md-mark">{@html svgIcon("iconClose")}{t("mobileMarkMine")}</span>
                {/if}
            </button>
        {/each}
    </div>
{/if}

<!-- 作答位：文本（简答/作文/翻译/多步）多行 + 公式工具条；
     填空单行；逐空题（完形/新题型）移动端暂无作答位，只明示需回桌面 -->
{#if !ui.revealed && (isText || isFill)}
    <div class="wengu-md-writer">
        {#if isText}
            <textarea
                class="wengu-md-input"
                rows={q.type === QuestionType.Essay ? 10 : 4}
                placeholder={t("inputPlaceholder")}
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
        {:else}
            <input
                class="wengu-md-input wengu-md-input-line"
                type="text"
                placeholder={t("inputPlaceholder")}
                disabled={locked}
                value={ui.mine}
                oninput={(e) => onMine(e.currentTarget.value)}
            />
        {/if}
    </div>
{:else if isSlots && !ui.revealed}
    <div class="wengu-md-hintbar">{@html svgIcon("iconInfo")}{t("mobileSlotsDesktopOnly")}</div>
{/if}

{#if ui.revealed && (q.answer || q.solutionMd)}
    <section class="wengu-md-verdict{ui.ok ? ' good' : ''}">
        <div class="wengu-md-verdict-head">
            <span class="wengu-md-vbadge">
                {@html ui.ok ? svgIcon("iconCheck") : svgIcon("iconClose")}
                {ui.ok ? t("mobileVerdictRight") : t("mobileVerdictWrong")}
            </span>
            {#if q.answer}
                <span class="wengu-md-vans">{t("answerLabel")}<b>{q.answer}</b></span>
            {/if}
        </div>
        {#if q.solutionMd}
            <details class="wengu-md-exp" open>
                <summary>{t("solution")}</summary>
                <div class="wengu-md-expbody">{@html renderMdHtml(q.solutionMd)}</div>
            </details>
        {/if}
    </section>
{/if}
