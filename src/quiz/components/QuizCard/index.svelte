<script lang="ts">
    import { onMount } from "svelte";
    import { svgIcon } from "../../../ui/FormHtml";
    import { fmt } from "../../../ui/shared";
    import { typeKey } from "../../render/CardParts";
    import type { CardHtmlModel } from "../../render/CardParts";
    import { isChoice, isObjective } from "../../render/CardHtml";
    import { buildCardInit, chipMarkOf, resultRowHtml, type CardInitCtx } from "../../render/CardState";
    import { CardCtl } from "../../render/CardCtl";
    import { registerCard, unregisterCard } from "../../render/CardRegistry";
    import { fallbackQuestionHtml, optionInline, renderMathWhenVisible } from "../../service/ProtyleHost";
    import { renderMdHtml } from "../../../ui/MdRender";
    import Button from "../../../ui/Button.svelte";
    import { markNumRailAnswered } from "../../render/NumRail";
    import { hasSlots, hasSteps, isBriefLike, LETTERS, optionDisplayMd, QuestionType } from "../../../types";
    import type { WenguQuestion } from "../../../types";
    import type { AnswerHost } from "../../flow/AnswerFlow";
    import {
        pickLetter,
        pickJudge,
        selfAssess,
        skipQuestion,
        dunnoQuestion,
        submitQuestion,
    } from "../../flow/AnswerFlow";
    import { bindStepsMode } from "../../flow/StepsFlow";
    import { dunnoSteps } from "../../flow/AnswerFlow";
    import CardStepsArea from "../CardStepsArea.svelte";
    import CardSlotsArea from "../CardSlotsArea.svelte";

    /**
     * 单张题卡（6-4b 状态化）：三写收敛的落点——初始渲染/恢复继续/判分
     * 揭示统一为 CardUi 响应态（buildCardInit 纯函数构建，恢复卡与新卡
     * 同一条路），作答/判分经 flow/* 写 ctl.ui 即细粒度更新。
     * DOM 契约（类名/data 属性/hidden）与旧字符串渲染逐字一致——
     * PreviewFlow 装饰与全局 scss 仍按这些钩子工作。
     * 事件仅 interactive（quiz 已开刷非渐进）时绑；挂载自登记进
     * CardRegistry（收卷锁卡、思路快照、收口检查按表遍历）。
     */
    let {
        q,
        idx,
        m,
        ctx,
        host,
        hidden = false,
        badMarked = false,
    }: {
        q: WenguQuestion;
        idx: number;
        m: CardHtmlModel;
        ctx: CardInitCtx;
        host: AnswerHost;
        /** 材料组内非当前题初始隐藏（组导航切换）。 */
        hidden?: boolean;
        /** 预览模式「标记为错题」初值（Issue #46；非预览恒 false=不出钮）。 */
        badMarked?: boolean;
    } = $props();

    // 快照语义：props（题目/开关/恢复源）整壳重建才变=卸载重挂（NumRail 同款）
    // svelte-ignore state_referenced_locally
    const ui = $state(buildCardInit(q, ctx));
    const ctl = new CardCtl(host, q, idx, ui, ctx.interactive);
    const t = m.t;
    const on = ctx.interactive;
    // 卡头自评徽标口径：steps 卡恒带（false）、slots 卡恒不带（true）
    // svelte-ignore state_referenced_locally
    const headObjective = hasSteps(q) ? false : hasSlots(q) ? true : isObjective(q);
    // svelte-ignore state_referenced_locally
    const label = q.knowledge || q.chapter;
    // svelte-ignore state_referenced_locally
    const letters = (q.optionMd ?? []).map((_, i) => LETTERS[i] ?? "");
    // match 候选池渲染期一次性预建（旧 renderMatchArea 同源）
    // svelte-ignore state_referenced_locally
    const pool = (q.optionMd ?? []).map((md, i) => {
        const { body, tier } = optionInline(optionDisplayMd(md));
        return { letter: LETTERS[i] ?? "", body, tier };
    });

    let rootEl = $state<HTMLElement | undefined>(undefined);
    let protoEl = $state<HTMLElement | undefined>(undefined);

    onMount(() => {
        ctl.el = rootEl;
        registerCard(ctl);
        // 题干静态填充（旧 ProtyleHost.mountStatic 单节点语义）+ 解析区
        // （CSS 随 wengu-revealed 揭示闸显隐，Issue #12）；KaTeX 惰性到接近视口
        if (protoEl) {
            const sol = [q.answer, q.solutionMd].filter(Boolean).join("\n\n");
            protoEl.innerHTML =
                fallbackQuestionHtml(q) +
                (sol ? `<div class="wengu-static-sol" data-static-sol">${renderMdHtml(sol)}</div>` : "");
            if (rootEl) renderMathWhenVisible(rootEl);
        }
        // Issue #28：题干挂载后过统一的高亮后处理（会话恢复/重开页签
        // 的线索在此重新落 mark；组题在材料面板侧由组单元调）
        host.refreshClueMarks?.(q);
        // after 恢复的已答题：题号标「已答」不透对错（旧 restore 路径补标）
        if (ui.graded && ui.resultStatus === "warn") markNumRailAnswered(idx + 1);
        // steps 模式分派：AI 实时引导开跑（离线初始态已含内容）
        if (on && hasSteps(q)) bindStepsMode(host, q, ctl);
        return () => unregisterCard(ctl);
    });
</script>

<!-- 卡头：题号 + 题型徽标 + 知识点标题 + 难度/来源/次数 + 重新生成 -->
{#snippet head(obj: boolean)}
    <div class="wengu-card-head">
        <span class="wengu-card-num">{idx + 1}</span>
        {#if q.type}<span class="wengu-badge">{t(typeKey(q.type))}</span>{/if}
        {#if label}<span class="wengu-card-title">{label}</span>{/if}
        {#if !obj}<span class="wengu-badge">{t("selfBadge")}</span>{/if}
        {#if q.difficulty}
            <span class="wengu-meta">{@html svgIcon("iconStar", "wengu-star").repeat(q.difficulty)}</span>
        {/if}
        {#if q.source}<span class="wengu-meta">{q.source}</span>{/if}
        {#if q.attempts > 0 && m.showAttempts}
            <span class="wengu-meta">{fmt(t("attempts"), { n: String(q.attempts) })}</span>
        {/if}
        {#if q.wrongCount > 0 && m.showWrongBadge}
            <span class="wengu-meta wengu-wrong-count">{fmt(t("wrongCount"), { n: String(q.wrongCount) })}</span>
        {/if}
        <Button class="wengu-side-iconbtn wengu-regen-btn" data-act="regen" title={t("regenTitle")}>
            {@html svgIcon("iconRefresh")}
        </Button>
        <!-- 预览模式专属「标记为错题」（Issue #46）：语义=题目本身出错/生成
             质量差，待批量重转——**不是**错题本的「作答错误」。两态：点击
             标记并高亮，已标记再点取消；点击由 bindCardActions 的
             [data-act='badmark'] 分支处理（与 regen 钮同机制，组件不持状态，
             标记态由视图刷新回灌） -->
        {#if m.preview}
            <Button
                class="wengu-side-iconbtn wengu-badmark-btn{badMarked ? ' wengu-badmark-on' : ''}"
                data-act="badmark"
                title={badMarked ? t("badMarkCancelTitle") : t("badMarkTitle")}
            >
                {@html svgIcon("iconBug")}
            </Button>
        {/if}
    </div>
{/snippet}

<!-- 「思路」折叠输入区（收卷快照进会话 thoughts） -->
{#snippet thoughtArea()}
    <Button
        class="wengu-thought-toggle"
        data-act="thought-toggle"
        onclick={on ? () => (ui.thoughtOpen = !ui.thoughtOpen) : undefined}
    >
        {@html svgIcon("iconEdit")}
        {t("thoughtToggle")}
    </Button>
    <div class="wengu-thought" data-thought-wrap hidden={!ui.thoughtOpen}>
        <textarea
            class="wengu-input"
            data-field="thought"
            rows="3"
            placeholder={t("thoughtPlaceholder")}
            disabled={ui.locked}
            value={ui.thought}
            oninput={(e) => (ui.thought = e.currentTarget.value)}></textarea>
    </div>
{/snippet}

<!-- 题干静态渲染占位（onMount 填 MdRender 产物 + 解析区）。
     Issue #28：非组题（题干自带长文本）的线索 chips 槽紧随题干——渲染
     位置在题干与作答区之间；组题的材料槽在组单元底部，此处不重复出
     （[data-clues] 命中以最近的祖先为界：组内卡的这层空槽会与组槽打架）。 -->
{#snippet protyle()}
    <div class="wengu-qprotyle" data-qprotyle bind:this={protoEl}><span class="wengu-muted">…</span></div>
    {#if !q.group}
        <div class="wengu-cclues" data-clues hidden></div>
    {/if}
{/snippet}

<!-- 结果/提示行（steps/slots/普通卡尾部件） -->
{#snippet tailRows()}
    <div
        class="wengu-result{ui.resultStatus === 'warn'
            ? ' wengu-muted'
            : ui.resultStatus
              ? ` wengu-${ui.resultStatus}`
              : ''}"
        data-result
        hidden={!ui.resultStatus}
    >
        {@html resultRowHtml(ui)}
    </div>
    <div class="wengu-note" data-note hidden={!ui.note}>{ui.note}</div>
{/snippet}

<div
    class="wengu-card{ui.graded ? ' wengu-graded' : ''}{ui.revealed ? ' wengu-revealed' : ''}"
    data-qid={q.id}
    data-idx={idx}
    data-graded={ui.graded ? "1" : undefined}
    bind:this={rootEl}
    {hidden}
>
    {@render head(headObjective)}
    {#if hasSteps(q)}
        {@render protyle()}
        <CardStepsArea {ctl} {q} {t} {on} />
        {@render thoughtArea()}
        <!-- 作答行（Issue #21）：steps 多步题与普通卡同款「跳过 / 不会」
             ——跳过纯导航（skipQuestion 对题型无感），「不会」题级语义
             （dunnoSteps：全步一次揭示 / after 只记已答可反悔）。
             slots 卡不提供（作答单位是空，维持现状）。无「提交」项：
             steps 的作答单位是步，提交由步内「下一步」承担 -->
        <div class="wengu-submit-row" data-submit-row>
            <Button
                variant="outline"
                class="wengu-btn wengu-skip-btn"
                data-act="skip"
                disabled={ui.locked}
                title={t("skipHint")}
                onclick={on ? () => skipQuestion(host, q) : undefined}
            >
                {@html svgIcon("iconRight")}
                {t("skipBtn")}
            </Button>
            <Button
                variant="outline"
                class="wengu-btn wengu-dunno-btn"
                data-act="dunno"
                disabled={ui.locked}
                title={t("dunnoHint")}
                onclick={on ? () => void dunnoSteps(host, q, ctl) : undefined}
            >
                {@html svgIcon("iconClose")}
                {t("dunnoBtn")}
            </Button>
        </div>
        {@render tailRows()}
    {:else if hasSlots(q)}
        {@render protyle()}
        <CardSlotsArea {ctl} {q} {t} {on} {letters} {pool} />
        {@render thoughtArea()}
        {@render tailRows()}
    {:else}
        {@render protyle()}
        <!-- 作答位：选择题字母 chip / 判断按钮 / 填空输入 / 简答·作文·翻译多行 -->
        {#if isChoice(q)}
            <div class="wengu-chips">
                {#each letters as L, i (i)}
                    <Button
                        class="wengu-chip{ui.letters.includes(L) ? ' wengu-chip-selected' : ''}{chipMarkOf(q, ui, i) ===
                        1
                            ? ' wengu-chip-right'
                            : chipMarkOf(q, ui, i) === 2
                              ? ' wengu-chip-wrong'
                              : ''}"
                        data-letter={L}
                        disabled={ui.locked}
                        onclick={on ? () => pickLetter(ctl, L) : undefined}
                    >
                        {L}
                    </Button>
                {/each}
            </div>
        {:else if q.type === QuestionType.Judge}
            <div class="wengu-judge">
                <Button
                    class="wengu-btn{ui.judge === '√' ? ' wengu-selected' : ''}"
                    data-judge="√"
                    disabled={ui.locked}
                    onclick={on ? () => pickJudge(ctl, "√") : undefined}
                >
                    {t("judgeYes")}
                </Button>
                <Button
                    class="wengu-btn{ui.judge === '×' ? ' wengu-selected' : ''}"
                    data-judge="×"
                    disabled={ui.locked}
                    onclick={on ? () => pickJudge(ctl, "×") : undefined}
                >
                    {t("judgeNo")}
                </Button>
            </div>
        {:else if isBriefLike(q)}
            <textarea
                class="wengu-input"
                data-field="mine"
                rows={q.type === QuestionType.Essay ? 10 : 4}
                placeholder={t("inputPlaceholder")}
                disabled={ui.locked}
                value={ui.mine}
                oninput={(e) => (ui.mine = e.currentTarget.value)}></textarea>
            {#if q.type === QuestionType.Essay}
                <div class="wengu-wordcount" data-wordcount>
                    {ui.mine.trim() ? ui.mine.trim().split(/\s+/).length : 0} words
                </div>
            {/if}
        {:else}
            <input
                class="wengu-input"
                data-field="mine"
                placeholder={t("inputPlaceholder")}
                disabled={ui.locked}
                value={ui.mine}
                oninput={(e) => (ui.mine = e.currentTarget.value)}
            />
        {/if}
        {@render thoughtArea()}
        <!-- 作答行：跳过 / 提交 / 不会（Issue #12 A；仅普通卡，steps/slots
             的作答单位是步/空另议）。「提交」恒可用——已答后可改并重交，
             空提交由 submitQuestion 的 noAnswer 兜住 -->
        <div class="wengu-submit-row" data-submit-row>
            <Button
                variant="outline"
                class="wengu-btn wengu-skip-btn"
                data-act="skip"
                disabled={ui.locked}
                title={t("skipHint")}
                onclick={on ? () => skipQuestion(host, q) : undefined}
            >
                {@html svgIcon("iconRight")}
                {t("skipBtn")}
            </Button>
            <Button
                class="wengu-btn"
                data-act="submit"
                disabled={ui.locked}
                onclick={on ? () => void submitQuestion(host, q, ctl) : undefined}
            >
                {t("submit")}
            </Button>
            <Button
                variant="outline"
                class="wengu-btn wengu-dunno-btn"
                data-act="dunno"
                disabled={ui.locked}
                title={t("dunnoHint")}
                onclick={on ? () => void dunnoQuestion(host, q, ctl) : undefined}
            >
                {@html svgIcon("iconClose")}
                {t("dunnoBtn")}
            </Button>
        </div>
        {@render tailRows()}
        <div class="wengu-ai-comment" data-ai-comment hidden={!ui.aiComment}>{ui.aiComment}</div>
        <div class="wengu-self" data-self hidden={!ui.selfOn}>
            <span>{ui.selfLabel}</span>
            <Button
                class="wengu-btn"
                variant="success"
                data-act="self-right"
                onclick={on ? () => void selfAssess(host, q, ctl, true) : undefined}
            >
                {@html svgIcon("iconCheck")}
                {t("selfRight")}
            </Button>
            <Button
                class="wengu-btn"
                variant="error"
                data-act="self-wrong"
                onclick={on ? () => void selfAssess(host, q, ctl, false) : undefined}
            >
                {@html svgIcon("iconClose")}
                {t("selfWrong")}
            </Button>
        </div>
    {/if}
</div>
