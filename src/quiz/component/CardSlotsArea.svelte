<script lang="ts">
    import { renderMathIn } from "../service/ProtyleHost";
    import type { CardCtl } from "../render/CardCtl";
    import { gotoSlot, pickMatch, pickSlotOpt, submitMatch, submitSlot } from "../flow/SlotFlow";
    import type { WenguQuestion } from "../../types";

    /**
     * 逐空作答区（6-4b 状态化）：cloze=空号条+当前空选项（CardUi.slots
     * 的 cur/curOpts 快照，切空重灌）；match=候选池+槽位行（marks 派生
     * 锁、描色、提交钮隐现）。DOM 契约（data-slot 系/data-match 系/
     * data-act）保留。当前空选项的公式渲染 $effect 对齐旧 fillClozeSlot
     * 时机。
     */
    let {
        ctl,
        q,
        t,
        on,
        letters,
        pool,
    }: {
        ctl: CardCtl;
        q: WenguQuestion;
        t: (k: string) => string;
        on: boolean;
        /** 候选字母序列（match 下拉/池共用，父组件预建）。 */
        letters: string[];
        /** match 候选池预渲染行（父组件预建）。 */
        pool: { letter: string; body: string; tier: string }[];
    } = $props();

    const ui = ctl.ui;
    const host = ctl.host;
    const slots = ui.slots!;

    let optsEl = $state<HTMLElement | undefined>(undefined);

    // 换空重灌后渲公式（旧 fillClozeSlot 的 renderMathIn 时机对齐）
    $effect(() => {
        slots.curOpts;
        if (optsEl) renderMathIn(optsEl);
    });
</script>

<div class="wengu-slots" data-slots>
    {#if slots.kind === "match"}
        <div class="wengu-matchpool">
            {#each pool as p, i (i)}
                <div class="wengu-match-poolitem{p.tier ? ` ${p.tier}` : ''}">
                    <span class="wengu-match-letter">{p.letter}</span><span>{@html p.body}</span>
                </div>
            {/each}
        </div>
        <div class="wengu-matchrows">
            {#each slots.marks as mark, k (k)}
                <div
                    class="wengu-match-row{mark.answered
                        ? mark.ok
                            ? ' wengu-match-right'
                            : ' wengu-match-wrong'
                        : ''}"
                    data-matchrow={k}
                >
                    <span class="wengu-match-k">{k + 1}</span>
                    <select
                        class="b3-select wengu-match-sel"
                        data-matchsel={k}
                        disabled={mark.answered || ui.locked}
                        value={mark.letter}
                        onchange={(e) => (on && !mark.answered ? pickMatch(ctl, k, e.currentTarget.value) : undefined)}
                    >
                        <option value="">—</option>
                        {#each letters as L, i (i)}<option value={L}>{L}</option>{/each}
                    </select>
                    <button
                        class="wengu-btn wengu-match-go"
                        data-act="match-submit"
                        data-k={k}
                        hidden={mark.answered}
                        onclick={on && !mark.answered ? () => submitMatch(host, q, ctl, k) : undefined}
                    >
                        {t("slotSubmit")}
                    </button>
                </div>
            {/each}
        </div>
    {:else}
        <div class="wengu-slotbar" data-slotbar>
            {#each slots.marks as mark, k (k)}
                <button
                    class="wengu-slotbtn{mark.answered
                        ? mark.ok
                            ? ' wengu-slotbtn-right'
                            : ' wengu-slotbtn-wrong'
                        : ''}{slots.cur === k ? ' wengu-slotbtn-cur' : ''}"
                    data-slotbtn={k}
                    onclick={on && !mark.answered ? () => gotoSlot(ctl, k) : undefined}
                >
                    {k + 1}
                </button>
            {/each}
        </div>
        <div class="wengu-slotcur" data-slotcur>
            <span class="wengu-badge" data-slot-stem>{slots.curStem}</span>
            <div class="wengu-slot-opts" data-slot-opts bind:this={optsEl}>
                {#each slots.curOpts as opt (opt.letter)}
                    <button
                        class="wengu-slot-opt{opt.tier ? ` ${opt.tier}` : ''}{opt.mark === 1
                            ? ' wengu-slot-right'
                            : opt.mark === 2
                              ? ' wengu-slot-wrong'
                              : ''}{slots.curSelected === opt.letter ? ' wengu-slot-selected' : ''}"
                        data-letter={opt.letter}
                        disabled={slots.curLocked || ui.locked}
                        onclick={on && !slots.curLocked ? () => pickSlotOpt(ctl, opt.letter) : undefined}
                    >
                        <span class="wengu-slot-letter">{opt.letter}</span>
                        <span class="wengu-slot-text" data-opt-text>{@html opt.html}</span>
                    </button>
                {/each}
            </div>
            <button
                class="wengu-btn"
                data-act="slot-submit"
                hidden={slots.cur >= slots.marks.length}
                onclick={on ? () => submitSlot(host, q, ctl) : undefined}
            >
                {t("slotSubmit")}
            </button>
        </div>
    {/if}
</div>
