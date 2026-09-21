<script lang="ts">
    import { onMount } from "svelte";
    import { svgIcon } from "../../../ui/FormHtml";
    import { fmt, mmss } from "../../../ui/shared";
    import { typeKey } from "../../render/CardParts";
    import type { CardHtmlModel } from "../../render/CardParts";
    import { isChoice, isObjective } from "../../render/CardHtml";
    import { buildCardInit, chipMarkOf, resultRowHtml, type CardInitCtx } from "../../render/CardState";
    import { CardCtl } from "../../render/CardCtl";
    import { registerCard, unregisterCard } from "../../render/CardRegistry";
    import { streamFor, type StreamHandle } from "../../render/FocusStream";
    import { registerTimerSync, unregisterTimerSync } from "../../render/FocusSync";
    import { optionInline, optionsHtml, renderMathWhenVisible, solutionHtml } from "../../service/ProtyleHost";
    import { decorateMaterialEntry } from "../../service/MaterialDecorate";
    import Button from "../../../ui/Button.svelte";
    import { markNumRailAnswered } from "../../render/NumRail";
    import { selfStarsOf, setSelfStars } from "../../flow/AnswerFlow";
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

    /* ── 单题计时切换（Issue #182 / 设计稿 v6） ──
       焦点态与两处读数都是响应态；流光由 FocusStream 岛驱动（逐帧改
       `stroke-dasharray`，不进 Svelte 响应链——每帧改状态会拖垮长卷）。 */
    const qTimer = host.questionTimer?.();
    /** 本卡是当前计时题（视图侧 `newQuestionFor` 切焦点后回灌）。 */
    let focused = $state(qTimer ? qTimer.active === q.id : false);
    /** 已提交＝流光淡出、读数换成静态注记（R4 冻结）。 */
    let submittedSec = $state(qTimer ? qTimer.secOf(q.id) : 0);
    let lap = $state(1);
    let stream: StreamHandle | undefined;

    /** 同步焦点/冻结态（视图在切焦点与结算后调；挂载时先跑一次）。
     *  登记进 `FocusTimerSync` 模块表——视图侧按 qid 触发，组件卸载即退表。 */
    const syncTimer = (): void => {
        if (!qTimer) return;
        focused = qTimer.active === q.id;
        submittedSec = qTimer.secOf(q.id);
        if (submittedSec > 0) stream?.freeze(submittedSec);
        else {
            stream?.setOn(focused);
            if (focused) {
                stream?.play();
                lap = Math.floor(qTimer.live() / 60000) + 1;
            } else stream?.stop();
        }
    };
    onMount((): (() => void) => {
        if (!qTimer) return () => undefined;
        registerTimerSync(q.id, syncTimer);
        return () => unregisterTimerSync(q.id, syncTimer);
    });

    /** 考点 chips（Issue #135 §7.a）：数据源 q.knowledge（卡头 label 同源）
     *  + chapter（章节名同档粒度，检索口两者都认）；多考点字段尚无=留位。
     *  **去重**（Set）：`{#each}` 带值 key，knowledge 与 chapter 同串时
     *  重复 key 会抛 each_key_duplicate（整卡崩），故先收敛。 */
    const kcaps = [...new Set([q.knowledge, q.chapter].filter((k): k is string => !!k && k.trim() !== ""))];
    /** 自评五星当前值（1..5，0=未评）；初值取自会话记录（改判/恢复回显）。 */
    let stars = $state(selfStarsOf(host, q.id));
    /** 点第 n 星=评 n；再点同值=取消（§7.b 交互）。 */
    const rate = (n: number): void => {
        stars = stars === n ? 0 : n;
        setSelfStars(host, q.id, stars);
    };
    /** 键盘左右移动（radiogroup 语义；← 在 0 值时无动作）。 */
    const starKey = (e: KeyboardEvent): void => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const next = Math.min(5, Math.max(0, stars + (e.key === "ArrowRight" ? 1 : -1)));
        if (next !== stars) {
            stars = next;
            setSelfStars(host, q.id, stars);
        }
    };

    onMount(() => {
        ctl.el = rootEl;
        registerCard(ctl);
        // 题干静态填充（旧 ProtyleHost.mountStatic 单节点语义）+ 解析区
        // （CSS 随 wengu-revealed 揭示闸显隐，Issue #12）；KaTeX 惰性到接近视口
        if (protoEl) {
            // Issue #53 三期：题干装饰走**唯一出口**（数据层入口：基础渲染
            // → 权威节点表；gloss:false = 题干无词表、不做词形联动）。
            // 选项行与答案解析区**不是原文**（非权威区），在装饰之外拼进
            // 同一容器——顺序与改造前逐字一致（题干 → 选项行 → 解析区）
            decorateMaterialEntry(protoEl, { md: q.stemMd ?? "", gloss: false });
            protoEl.insertAdjacentHTML("beforeend", optionsHtml(q) + solutionHtml(q));
            if (rootEl) renderMathWhenVisible(rootEl);
        }
        // Issue #28：题干挂载后过统一的高亮后处理（会话恢复/重开页签
        // 的线索在此重新落 mark；组题在材料面板侧由组单元调）
        host.refreshClueMarks?.(q);
        // after 恢复的已答题：题号标「已答」不透对错（旧 restore 路径补标）
        if (ui.graded && ui.resultStatus === "warn") markNumRailAnswered(idx + 1);
        // steps 模式分派：AI 实时引导开跑（离线初始态已含内容）
        if (on && hasSteps(q)) bindStepsMode(host, q, ctl);
        // 单题计时：流光层是卡的**兄弟节点**（卡内判分重绘不动它），
        // 建立后先对齐几何再按当前焦点/冻结态同步一次。
        if (qTimer && rootEl) {
            stream = streamFor(q.id, rootEl);
            stream.timer = qTimer;
            stream.layout();
            stream.observe();
            syncTimer();
        }
        return () => {
            stream?.unobserve();
            stream?.dispose();
            stream = undefined;
            unregisterCard(ctl);
        };
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
        {#if qTimer}
            {#if submittedSec > 0}
                <span class="wengu-card-qtime" data-qtime>{fmt(t("perQTime"), { t: mmss(submittedSec) })}</span>
            {:else}
                <span class="wengu-card-lap" data-lap>{fmt(t("timerLap"), { n: String(lap) })}</span>
            {/if}
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

<!-- 考点 chips 行（Issue #135 §4.3/§7.a）：**仅揭示后渲染**（防剧透，
     整行不出而非留白）；组题在组内当前卡同位（本组件即组内卡）。
     点击=按考点检索（视图层接既有统计入口；无目标降级纯展示）。 -->
{#snippet kcapsRow()}
    {#if kcaps.length > 0 && ui.revealed}
        <div class="wengu-kcaps" data-kcaps>
            <span class="wengu-kcaps-label">{t("kcapsLabel")}</span>
            {#each kcaps as k (k)}
                <button
                    type="button"
                    class="wengu-kchip{ctx.kcapSearch ? '' : ' wengu-kchip-static'}"
                    data-kcap={k}
                    title={ctx.kcapSearch ? t("kcapSearchTitle") : k}
                    onclick={on && ctx.kcapSearch ? () => ctx.kcapSearch?.(k) : undefined}
                >
                    {k}
                </button>
            {/each}
        </div>
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
    class="wengu-card{focused ? ' wengu-focus' : ''}{ui.graded ? ' wengu-graded' : ''}{ui.revealed
        ? ' wengu-revealed'
        : ''}"
    data-qid={q.id}
    data-idx={idx}
    data-graded={ui.graded ? "1" : undefined}
    bind:this={rootEl}
    {hidden}
>
    {@render head(headObjective)}
    {#if hasSteps(q)}
        {@render protyle()}
        {@render kcapsRow()}
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
        {@render kcapsRow()}
        <CardSlotsArea {ctl} {q} {t} {on} {letters} {pool} />
        {@render thoughtArea()}
        {@render tailRows()}
    {:else}
        {@render protyle()}
        {@render kcapsRow()}
        <!-- 作答位：字母 chip 在选项行之后（先读选项、再作答）/ 判断按钮 /
             填空输入 / 简答·作文·翻译多行 -->
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
        <!-- 自评行（`.wengu-self` + `data-self` + `selfOn` 三闸不动）：
             ① 判对错/改判钮（既有功能，**不可删**——契约
                `docs/question-block-contract.md` 三点六「原自评按钮保留为改判
                入口」，且 AI 判分失败补账、缺题型/答案的降级自评都靠它记账）；
             ② 新增五星掌握度（Issue #135 §4.4/§7.b，与对错是两个维度）。 -->
        <div class="wengu-self" data-self hidden={!ui.selfOn}>
            <span class="wengu-self-label">{ui.selfLabel}</span>
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
            <span class="wengu-self-label">{t("selfStarsLabel")}</span>
            <!-- 五星 radiogroup（Issue #135 §4.4/§7.b）：点第 n 星=评 n，
                 再点同值=取消，已评可改；键盘左右移动 -->
            <span class="wengu-stars" role="radiogroup" aria-label={t("selfStarsLabel")} onkeydown={starKey}>
                {#each [1, 2, 3, 4, 5] as n (n)}
                    <button
                        type="button"
                        class="wengu-star-btn{stars >= n ? ' on' : ''}"
                        role="radio"
                        aria-checked={stars === n}
                        aria-label={fmt(t("selfStarsAria"), { n: String(n) })}
                        disabled={!on}
                        onclick={on ? () => rate(n) : undefined}
                    >
                        {@html svgIcon("iconStar")}
                    </button>
                {/each}
            </span>
            <span class="wengu-self-hint">{t("selfStarsHint")}</span>
        </div>
    {/if}
</div>
