<script lang="ts">
    import { onMount, tick } from "svelte";
    import { svgIcon } from "../../ui/FormHtml";
    import { decorate } from "../service/MaterialDecorate";
    import { renderMathWhenVisible } from "../service/ProtyleHost";
    import Button from "../../ui/Button.svelte";
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
    import { fadeVisible, materialScrollCap } from "../flow/MaterialScroll";
    import type { GroupUnitQ } from "../render/DrillUnits";
    import type { WenguMaterial } from "../../types";
    import QuizCardApp from "./QuizCard/index.svelte";

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
        badMarks = new Set<string>(),
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
        /** 已标记为错题的 qid 集合（Issue #46；组内卡逐张回灌标记态）。 */
        badMarks?: Set<string>;
    } = $props();

    let qi = $state(clampGroupQi(getGroupQi(mid) ?? 0, qs.length));
    /** 阅读面（Issue #83 **改结构判据**）：本组件**就是**材料组单元
     *  （材料块 + 依附小题 = 一题多问），故根元素**无条件**带
     *  `.wengu-reading`（凹槽阅读栏 + 衬线正文 + ¶ 段落序号 + 题卡间距
     *  阶梯，见 scss/reading.scss）——全学科一致美化（英语阅读/完形、
     *  语文文言文、政治材料分析、工科一题多问都是材料组），零学科依赖、
     *  零壳层传值。
     *
     *  ⚠️ 旧口径（#81/#82）是「本组所在卷是英语卷才挂」，由壳层经
     *  `m.reading` 传入——英语判别不出来时材料组结构还在、美化却没了
     *  （#83 根因）。判据在 ReadingScope（纯逻辑带单测）；别再退回按卷判。 */
    let collapsed = $state(false);
    let rootEl = $state<HTMLElement | undefined>(undefined);
    let matEl = $state<HTMLElement | undefined>(undefined);
    /** 材料区限高内滚（Issue #87）：长材料下材料区占满整屏、题目被挤出
     *  视口，故材料区限高（`--wengu-mat-cap`，视口比例）+ 内部滚动。
     *  判定走纯函数 `MaterialScroll.materialScrollCap`——**溢出才限高**，
     *  短材料不挂属性 ⇒ 自然展开、无滚动条无渐隐，逐字节同现状（验收 2）。 */
    let cap = $state<0 | 1>(0);
    /** 渐隐分界线可见（Issue #87 验收 1/2）：**只有「下方还有内容」才显示**，
     *  滚到底即消（判定 `MaterialScroll.fadeVisible`）。 */
    let fading = $state(false);
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

    /** 量算材料区滚动能力（挂载后一次 + resize/折叠展开 + 每次滚动）：
     *  cap 只在「溢出」时置 1，fading 只在「还能往下滚」时置真。 */
    const syncMatScroll = (): void => {
        if (!matEl) return;
        cap = materialScrollCap(matEl);
        fading = fadeVisible(matEl);
        setGroupScroll(mid, matEl.scrollTop); // 滚动记忆（挂载期恢复后不再回写）
    };

    /** 材料区滚动：渐隐随「还能往下滚」实时翻牌 + 记忆滚动位置。 */
    const onMatScroll = (e: Event & { currentTarget: HTMLElement }): void => {
        fading = fadeVisible(e.currentTarget);
        setGroupScroll(mid, e.currentTarget.scrollTop);
    };

    /** 折叠切换：收起时 `.wengu-gmat` 被 `display:none`（量算全 0），展开
     *  后必须**重量一次**——否则收起再展开会残留「不限高/无渐隐」，长材料
     *  又回到「题目被挤出视口」（验收 3 的展开腿）。 */
    const toggleCollapsed = (): void => {
        collapsed = !collapsed;
        if (!collapsed) void tick().then(syncMatScroll);
    };

    onMount(() => {
        registerGroup(mid, { focusIdx, unitEl: () => rootEl });
        // 材料静态填充（旧 mountStatic 的 [data-mprotyle] 单节点语义）
        if (matEl && material?.bodyMd) {
            // Issue #53 三期：材料装饰走**唯一出口**，且**一次走完**——
            // 基础渲染 → 权威节点表 → 词形联动 → 轮间重算映射 → 线索 mark
            // 坐标施工（原「材料填充 + 紧随其后的线索后处理」两段调用已
            // 合一段；词表与线索的施工顺序由出口内部固定，不再靠调用顺序
            // 约定）。线索输入=本组当前题的会话锚点（组内共享材料面板）。
            decorate(matEl, { md: material.bodyMd, clues: host.clueAnchorsOf?.(qs[qi].q) ?? [] });
            const top = getGroupScroll(mid);
            if (top !== undefined) matEl.scrollTop = top;
            if (rootEl) renderMathWhenVisible(rootEl);
            // 限高内滚的首次量算：属性落定 → 布局 → 量算（装饰链已铺完，
            // scrollHeight 此时才是最终值）。`await tick()` 让首帧先见内容。
            void tick().then(syncMatScroll);
        }
        // Issue #28：材料填充后过统一高亮后处理——装饰出口那次施工已把高亮
        // 与线索一并铺好，本调用在这里是**幂等**的 chips 行兜底（材料缺失/
        // 无正文时不走上面的出口，chips 仍需刷）。
        host.refreshClueMarks?.(qs[qi].q);
        onActive(qs[qi].idx); // 首帧同步当前题（旧 bindOneGroupUnit 首调）
        // 窗口/字体变化会改行数（=改 scrollHeight）但不触发滚动事件，
        // 不重量算就会留下「该滚的没滚、读完的还挂着渐隐」。
        window.addEventListener("resize", syncMatScroll);
        return () => {
            window.removeEventListener("resize", syncMatScroll);
            unregisterGroup(mid);
        };
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

<div class="wengu-gunit wengu-reading" data-mid={mid} data-collapsed={collapsed ? "" : undefined} bind:this={rootEl}>
    <div class="wengu-ghead">
        <Button class="wengu-gmat-fold" data-act="gmat-fold" title={t("materialToggle")} onclick={toggleCollapsed}>
            {@html svgIcon("iconRight")}<span>{t("materialTitle")}</span>
        </Button>
        <span class="wengu-gnav">
            <Button class="wengu-gnav-btn" data-act="gq-prev" title={t("groupPrev")} onclick={() => step(-1)}>
                {@html svgIcon("iconLeft")}
            </Button>
            <span class="wengu-gq-label" data-gq-label>{qi + 1}/{qs.length}</span>
            <Button class="wengu-gnav-btn" data-act="gq-next" title={t("groupNext")} onclick={() => step(1)}>
                {@html svgIcon("iconRight")}
            </Button>
        </span>
    </div>
    <div class="wengu-gmat-host" data-scroll-cap={cap || undefined} data-scroll-fade={fading ? "" : undefined}>
        <div class="wengu-gmat" data-mprotyle bind:this={matEl} onscroll={onMatScroll}>
            <span class="wengu-muted">…</span>
        </div>
    </div>
    <div class="wengu-gqs">
        {#each qs as gq, i (gq.q.id)}
            <QuizCardApp q={gq.q} idx={gq.idx} {m} {ctx} {host} hidden={i !== qi} badMarked={badMarks.has(gq.q.id)} />
        {/each}
    </div>
    <div class="wengu-gclues" data-clues hidden></div>
</div>
