<script lang="ts">
    import { getContext } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import Button from "../../ui/Button.svelte";
    import { MOBILE_DRILL_CTX, type MobileDrill } from "../core/MobileCtx";
    import { answerKindOf, answeredPct, drawerCells, isMultiSelect, typeLabelKey } from "../core/MobileModel";
    import { materialHtml, materialSummary } from "../core/MobileMaterials";
    import NumDrawer from "./NumDrawer.svelte";
    import QuestionBody from "./QuestionBody.svelte";

    /**
     * 屏 ②③⑤⑥ 刷题中：题头（题号 / 计时 / 答题卡 / 交卷）+ 题头 meta
     * （题型 + 来源 + 组内点）+ 题干/材料/作答位 + 底部操作区（跳过 /
     * 标不会 / 上一题 / 主操作）+ 题号抽屉 + 交卷确认弹层。
     *
     * 主操作按钮按形态分流：**所有可作答形态都出「确认答案」**
     * （单选/判断/多选/文本/填空/无题型兜底）——点选只落选择态、
     * 一律不自动提交，防误触（Issue #105）；已揭示后按钮变「下一题」。
     * 逐空题（slots）无作答位，不出现确认钮。
     */
    const drill: MobileDrill = getContext(MOBILE_DRILL_CTX);
    const t = (k: string) => drill.t(k);
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

    const q = $derived(drill.q);
    const ui = $derived(drill.cur);
    const batch = $derived(drill.ui.setup.reveal === "after");
    const answered = $derived(drill.ui.cards.filter((c) => c.graded).length);
    const cells = $derived(drawerCells(drill.ui.list, drill.ui.session, batch, (x) => t(typeLabelKey(x))));
    /** 组内题下标（组内进度点）。 */
    const groupIdx = $derived(
        q?.group
            ? drill.ui.list
                  .map((x, i) => ({ x, i }))
                  .filter((e) => e.x.group === q!.group)
                  .map((e) => e.i)
            : []
    );
    /** 材料面板（仅组题）：展开时才产出装饰后的正文 HTML。 */
    const material = $derived(q?.group ? drill.ui.materials.find((m) => m.id === q!.group) : undefined);
    const matBody = $derived(drill.ui.matOpen ? materialHtml(material) : "");
    const matSummary = $derived(materialSummary(material?.bodyMd));
    /** 作答形态（唯一判据，见 MobileModel.answerKindOf）。 */
    const kind = $derived(q ? answerKindOf(q) : "plain");
    /** 逐空题（完形/新题型）移动端暂无作答位：不出现「确认答案」，
     *  也不给「跳过 / 不会」（作答单位是「空」，题级记账会错位）。 */
    const unsupported = $derived(kind === "slots");
    /** 主操作：**所有可作答形态都要显式确认**（Issue #105 两段式——
     *  点选只落选择态、不再自动提交，防误触）；逐空题无作答位故排除。 */
    const needConfirm = $derived(!!q && !ui?.revealed && !unsupported);

    /** 选择/判断未选中任何项时禁用确认钮（未作答就是没得判）。
     *  文本/填空保持现行为：空提交按原样出「未作答」提示，不 disable。 */
    const confirmDisabled = $derived(
        !!ui?.busy || (kind === "choice" && !ui?.letters) || (kind === "judge" && !ui?.judge)
    );

    /** 点选只落选择态——提交一律由「确认答案」触发（Issue #105）。 */
    function pick(letter: string): void {
        drill.pickLetter(letter);
    }
</script>

<header class="wengu-md-qbar">
    <button class="wengu-md-iconbtn" aria-label={t("back")} onclick={() => drill.backHome()}>
        {@html svgIcon("iconLeft")}
    </button>
    <div class="wengu-md-qmid">
        <span class="wengu-md-qno">{drill.ui.qIdx + 1}<i>/{drill.ui.list.length}</i></span>
        <span class="wengu-md-qtimer">{@html svgIcon("iconClock")}{mmss(drill.ui.elapsedSec)}</span>
    </div>
    <button
        class="wengu-md-iconbtn primary-tone"
        aria-label={t("mobileDrawerTitle")}
        onclick={() => drill.toggleDrawer()}
    >
        {@html svgIcon("iconList")}
    </button>
    <button class="wengu-md-submitchip primary" onclick={() => drill.requestEnd()}>
        {batch ? t("endRoundRevealBtn") : t("mobileSubmitRound")}
    </button>
</header>

{#if batch}
    <div class="wengu-md-modestrip">
        <b>{t("mobileBatchMode")}</b>
        <span class="wengu-md-pbar thin"><i style="width:{answeredPct(answered, drill.ui.list.length)}%"></i></span>
        <span>{t("mobileRemain")} <b>{drill.ui.list.length - answered}</b> {t("mobileCountSuffix")}</span>
    </div>
{/if}

{#if q}
    <div class="wengu-md-qmeta">
        <span class="wengu-md-qtype">{t(typeLabelKey(q))}</span>
        <span class="wengu-md-qsrc">{drill.ui.home.activeSetTitle}</span>
        {#if q.group}
            <span class="wengu-md-dots">
                {#each groupIdx as i (i)}
                    <i class={drill.ui.cards[i]?.graded ? "ok" : i === drill.ui.qIdx ? "cur" : ""}></i>
                {/each}
            </span>
        {/if}
    </div>
{/if}

<div class="wengu-md-scroll">
    {#if q && ui}
        <QuestionBody
            {q}
            {ui}
            {t}
            materialHtml={matBody}
            matOpen={drill.ui.matOpen}
            onPick={pick}
            onMine={(text) => drill.setMine(text)}
            onToggleMat={() => drill.toggleMat()}
        />
        {#if ui.resultText}
            <div class="wengu-md-result{ui.revealed ? (ui.ok ? ' right' : ' wrong') : ' warn'}">{ui.resultText}</div>
        {/if}
        {#if ui.comment}
            <div class="wengu-md-comment">{ui.comment}</div>
        {/if}
        {#if ui.selfOn}
            <div class="wengu-md-self">
                <span>{t("rejudgeHint")}</span>
                <Button variant="success" onclick={() => drill.selfAssess(true)}>{t("selfRight")}</Button>
                <Button variant="error" onclick={() => drill.selfAssess(false)}>{t("selfWrong")}</Button>
            </div>
        {/if}
        {#if !ui.revealed}
            <div class="wengu-md-hintbar">
                {@html svgIcon("iconInfo")}
                {#if batch}
                    {t("mobileBatchHint")}
                {:else if isMultiSelect(q)}
                    {t("mobileMultiHint")}
                {:else}
                    {t("mobileAnswerHint")}
                {/if}
            </div>
        {:else if !ui.ok}
            <div class="wengu-md-hintbar">{@html svgIcon("iconBookmark")}{t("mobileWrongAdded")}</div>
        {/if}
    {/if}
</div>

<footer class="wengu-md-dock">
    {#if q && !unsupported}
        <div class="wengu-md-docksub">
            <button class="wengu-md-subtab" disabled={ui?.locked} onclick={() => drill.skip()}>
                {@html svgIcon("iconRight")}{t("mobileSkip")}
            </button>
            <button class="wengu-md-subtab" disabled={ui?.locked} onclick={() => drill.dunno()}>
                {@html svgIcon("iconBookmark")}{t("mobileDunno")}
            </button>
        </div>
    {/if}
    <div class="wengu-md-dockmain">
        <Button variant="outline" class="wengu-md-btn-slim" disabled={drill.ui.qIdx === 0} onclick={() => drill.prev()}>
            {t("mobilePrev")}
        </Button>
        {#if ui?.locked || ui?.revealed}
            <Button variant="main" class="wengu-md-btn-solid" onclick={() => drill.next()}>
                {t("mobileNext")}{@html svgIcon("iconRight")}
            </Button>
        {:else if needConfirm}
            <Button
                variant="main"
                class="wengu-md-btn-solid"
                disabled={confirmDisabled}
                onclick={() => void drill.submit()}
            >
                {ui?.busy ? t("aiJudging") : t("mobileConfirm")}
            </Button>
        {:else}
            <Button variant="main" class="wengu-md-btn-solid" onclick={() => drill.next()}>
                {t("mobileNext")}{@html svgIcon("iconRight")}
            </Button>
        {/if}
    </div>
</footer>

{#if drill.ui.drawer}
    <NumDrawer {cells} onClose={() => drill.toggleDrawer()} />
{/if}

{#if drill.ui.confirmEnd}
    <div class="wengu-md-scrim" role="presentation" onclick={() => drill.cancelEnd()}></div>
    <div class="wengu-md-sheet wengu-md-confirm" role="dialog" aria-label={t("mobileConfirmEndTitle")}>
        <div class="wengu-md-sheet-head">
            <b>{t("mobileConfirmEndTitle")}</b>
        </div>
        <p>{t("mobileConfirmEndBody")}</p>
        <div class="wengu-md-sheet-foot">
            <Button variant="outline" onclick={() => drill.cancelEnd()}>{t("cancel")}</Button>
            <Button variant="main" class="wengu-md-btn-solid" onclick={() => drill.endRound()}
                >{t("endRoundRevealBtn")}</Button
            >
        </div>
    </div>
{/if}
