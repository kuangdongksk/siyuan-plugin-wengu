<script lang="ts">
    import { onMount } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import { renderMdHtml } from "../../ui/MdRender";
    import { renderMathWhenVisible } from "../service/ProtyleHost";
    import type { CardHtmlModel } from "../render/CardParts";
    import type { CardInitCtx } from "../render/CardState";
    import type { AnswerHost } from "../flow/AnswerFlow";
    import {
        clampGroupQi,
        getGroupQi,
        getGroupScroll,
        registerGroup,
        setGroupQi,
        setGroupScroll,
        unregisterGroup,
    } from "../flow/MaterialFlow";
    import type { GroupUnitQ } from "../render/DrillUnits";
    import type { WenguMaterial } from "../../types";
    import QuizCardApp from "./QuizCardApp.svelte";

    /**
     * 材料组单元（6-4b 状态化）：组内导航（一次一题，qi 响应态——非当前
     * 卡 hidden、标签、逐题计时联动）与材料折叠/滚动记忆收进组件；组运行
     * 态（qi/材料滚动位置）跨重渲染存活，仍持在 MaterialFlow 的模块级
     * Map。材料面板静态填充在挂载时一次完成（旧 mountStatic 增量轨退役）。
     * focusIdx 实例导出供题号导航定位（MaterialFlow.focusQuestion）。
     */
    let {
        qs,
        mid,
        material,
        t,
        m,
        ctx,
        host,
        onActive,
    }: {
        qs: GroupUnitQ[];
        mid: string;
        material?: WenguMaterial;
        t: (k: string) => string;
        m: CardHtmlModel;
        ctx: CardInitCtx;
        host: AnswerHost;
        /** 切题后同步 activeQIdx/逐题计时（QuizView.onActiveQ）。 */
        onActive(idx: number): void;
    } = $props();

    let qi = $state(clampGroupQi(getGroupQi(mid) ?? 0, qs.length));
    let collapsed = $state(false);
    let rootEl = $state<HTMLElement | undefined>(undefined);
    let matEl = $state<HTMLElement | undefined>(undefined);

    /** 组内上一题/下一题（滚到新卡）。 */
    const step = (dir: number): void => {
        const next = clampGroupQi(qi + dir, qs.length);
        if (next === qi) return;
        qi = next;
        setGroupQi(mid, qi);
        onActive(qs[qi].idx);
        rootEl?.querySelector<HTMLElement>(`.wengu-gqs .wengu-card[data-idx='${qs[qi].idx}']`)?.scrollIntoView({
            block: "nearest",
            behavior: "smooth",
        });
    };

    onMount(() => {
        registerGroup(mid, { focusIdx, unitEl: () => rootEl });
        // 材料静态填充（旧 mountStatic 的 [data-mprotyle] 单节点语义）
        if (matEl && material?.bodyMd) {
            matEl.innerHTML = renderMdHtml(material.bodyMd);
            const top = getGroupScroll(mid);
            if (top !== undefined) matEl.scrollTop = top;
            if (rootEl) renderMathWhenVisible(rootEl);
        }
        onActive(qs[qi].idx); // 首帧同步当前题（旧 bindOneGroupUnit 首调）
        return () => unregisterGroup(mid);
    });

    /** 题号导航定位：idx 属本组则切到该题（不触发 onActive 回环）。 */
    export function focusIdx(idx: number): boolean {
        const hit = qs.findIndex((gq) => gq.idx === idx);
        if (hit < 0) return false;
        if (hit !== qi) {
            qi = hit;
            setGroupQi(mid, hit);
        }
        return true;
    }
</script>

<div class="wengu-gunit" data-mid={mid} data-collapsed={collapsed ? "" : undefined} bind:this={rootEl}>
    <div class="wengu-ghead">
        <button
            class="wengu-gmat-fold"
            data-act="gmat-fold"
            title={t("materialToggle")}
            onclick={() => (collapsed = !collapsed)}
        >
            {@html svgIcon("iconRight")}<span>{t("materialTitle")}</span>
        </button>
        <span class="wengu-gnav">
            <button class="wengu-gnav-btn" data-act="gq-prev" title={t("groupPrev")} onclick={() => step(-1)}>
                {@html svgIcon("iconLeft")}
            </button>
            <span class="wengu-gq-label" data-gq-label>{qi + 1}/{qs.length}</span>
            <button class="wengu-gnav-btn" data-act="gq-next" title={t("groupNext")} onclick={() => step(1)}>
                {@html svgIcon("iconRight")}
            </button>
        </span>
    </div>
    <div
        class="wengu-gmat"
        data-mprotyle
        bind:this={matEl}
        onscroll={(e) => setGroupScroll(mid, e.currentTarget.scrollTop)}
    >
        <span class="wengu-muted">…</span>
    </div>
    <div class="wengu-gqs">
        {#each qs as gq, i (gq.q.id)}
            <QuizCardApp q={gq.q} idx={gq.idx} {m} {ctx} {host} hidden={i !== qi} />
        {/each}
    </div>
    <div class="wengu-gclues" data-clues hidden></div>
</div>
