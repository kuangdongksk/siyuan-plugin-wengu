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
    import { MAT_MIN_PX, clampMatCap, nextMatCap, normalizeMatRatio, ratioOf } from "../flow/MaterialSplitter";
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

    /* ── 可拖分隔条（Issue #138 §6.1/§7.c，交互语义按 antd Splitter）──
       材料区高度从「固定 52vh」改为可由用户拖动决定。约束/比例折算全在
       纯函数 `flow/MaterialSplitter`（带单测），本组件只做三件事：读事件
       → 调纯函数 → 写内联 `--wengu-mat-cap`（px，优先级盖 52vh）。

       ⚠️ 内联值只在**用户拖过**时存在：`m.matCapRatio === undefined` 且未
       拖过 ⇒ 不写内联，CSS 的 52vh 默认生效（短材料/独立题零 DOM 变化）。 */
    /** 用户当前拖出的高度（px；null=未拖过 ⇒ 走 CSS 默认比例）。 */
    let capPx = $state<number | null>(null);
    let dragging = $state(false);
    let splitEl = $state<HTMLElement | undefined>(undefined);
    /** 材料区所在列（主区滚动窗 `.wengu-main`）：上限 `min(75vh, host 可用高)`
     *  的**分母/基准**都在它身上。绝不能取 `.wengu-gmat-host`（材料区自己）
     *  ——拿被调对象自身当上限，放大必被 clamp 压回原值（棘轮：只能缩不能
     *  放），比值还恒 ≈1 被判脏、持久化静默失效（#138 复核实测）。 */
    let colEl = $state<HTMLElement | undefined>(undefined);
    /** 拖拽起点：指针 y、当时的材料区高、当时的列高（antd Splitter 同款）。
     *  列高在 pointerdown 缓存：拖动中逐帧读 clientHeight 会强推布局。 */
    let dragFrom = { y: 0, h: 0, col: 0 };

    /** 材料区所在列的可用高（上限与比值的共同基准；量不到回视口高——
     *  `matMaxPx` 退化为 75vh 一条，不会写出 0 高）。 */
    const colHeight = (): number => colEl?.clientHeight || window.innerHeight;

    /** 把高度意图写成内联变量（拖动/键盘/复位三路唯一出口）。
     *  `colPx` 缺省现场量算；拖动路径传 pointerdown 缓存的列高。 */
    const applyCap = (px: number, colPx = colHeight()): void => {
        const next = clampMatCap(px, colPx, window.innerHeight);
        capPx = next;
        matEl?.style.setProperty("--wengu-mat-cap", `${next}px`);
    };

    /** 复位（双击）：清内联 ⇒ 回 CSS 的 52vh 默认（§7.c）。
     *  ⚠️ 内联与**存储**必须一起清：只清内联的话，下次装载按旧比例折算回来
     *  ——「复位」是假的（#138 复核实测）。`write(undefined)` = 显式清库。 */
    const resetCap = (): void => {
        capPx = null;
        matEl?.style.removeProperty("--wengu-mat-cap");
        host.setMatCapRatio?.(undefined);
        syncMatScroll();
    };

    /** 拖到/键到某个高度后落库（存比例不存像素，§7.c 持久化口径）。
     *  分母＝**视口高**：0.16–0.75 这对界与上限 75vh 同源，换成列高做分母
     *  时拖到上限得 ≈0.9、越界被判脏（写盘静默丢失，复核实测）。 */
    const persistCap = (): void => {
        if (capPx === null) return;
        const ratio = ratioOf(capPx, window.innerHeight);
        if (ratio === undefined) return;
        host.setMatCapRatio?.(ratio);
    };

    const onSplitDown = (e: PointerEvent): void => {
        if (!matEl) return;
        dragFrom = { y: e.clientY, h: matEl.getBoundingClientRect().height, col: colHeight() };
        dragging = true;
        splitEl?.setPointerCapture(e.pointerId);
        document.body.classList.add("wengu-splitting");
        e.preventDefault();
    };

    const onSplitMove = (e: PointerEvent): void => {
        if (!dragging) return;
        applyCap(dragFrom.h + (e.clientY - dragFrom.y), dragFrom.col);
    };

    /** pointerup/pointercancel 共同收尾：释放 capture、摘全局拖动态、
     *  落库，并**手动补一次滚动重算**——拖动不触发 resize 事件，
     *  渐隐与 cap 判定会滞留在拖动前的高度（§7.c 明写）。 */
    const onSplitUp = (e: PointerEvent): void => {
        if (!dragging) return;
        dragging = false;
        if (splitEl?.hasPointerCapture(e.pointerId)) splitEl.releasePointerCapture(e.pointerId);
        document.body.classList.remove("wengu-splitting");
        persistCap();
        syncMatScroll();
    };

    const onSplitDbl = (): void => resetCap();

    /** 键盘可达（§7.c）：Arrow ±24px、Home/End 到 min/max。
     *  End 走 max（顶格上限），Home 到 min 而不是「复位默认」——两个键
     *  各自对应约束的两端，复位另有双击（antd Splitter 亦只给方向键）。 */
    const onSplitKey = (e: KeyboardEvent): void => {
        // 起点是**当前材料区高（量算实值）**：未拖过时没有持久化比值，
        // 折算起步会算成 0，第一次按方向键就把材料区拍到下限（复核实测）。
        const from = capPx ?? matEl?.clientHeight ?? MAT_MIN_PX;
        const next = nextMatCap(e.key, from, colHeight(), window.innerHeight);
        if (next === undefined) return;
        e.preventDefault(); // 别让方向键把面板滚起来
        applyCap(next);
        persistCap();
        syncMatScroll();
    };
    /** resize 处理：先按新视口重夹取（可能改内联 px），再重量滚动能力。 */
    const onViewportResize = (): void => {
        reclampCap();
        syncMatScroll();
    };

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

    /** 装载时恢复持久化比例（§7.c）：`ratio × 视口高` 折算 px 写内联。
     *  未拖过（`undefined`）/越界 ⇒ 一个内联变量都不写，CSS 的 52vh 默认
     *  生效（短材料/独立题 DOM 逐字节不变）。 */
    const restoreCap = (): void => {
        const ratio = normalizeMatRatio(m.matCapRatio);
        if (ratio === undefined || !matEl) return;
        // 折算基准与落库同源（视口高）；上限仍取列高（题目区要留出空间）
        capPx = clampMatCap(ratio * window.innerHeight, colHeight(), window.innerHeight);
        matEl.style.setProperty("--wengu-mat-cap", `${capPx}px`);
    };

    /** 视口变化后的重夹取：窗口变矮时内联 px 可能越出 `min(75vh, 列高)`
     *  上限（持久化只在装载折算一次）。只对「用户拖过」者生效——未拖过
     *  仍走 CSS 比例，零内联。 */
    const reclampCap = (): void => {
        if (capPx !== null) applyCap(capPx);
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
        // 列元素一次定位（上限/比值的基准；量不到时 colHeight 退视口高）
        colEl = rootEl?.closest<HTMLElement>(".wengu-main") ?? undefined;
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
            // 同一 tick 里恢复持久化比例（§7.c：ratio × host 高 折算 px）——
            // 必须在首帧量算前写好内联值，否则先按 52vh 量一遍再改，
            // `cap`/`fading` 会留下一次闪烁级的错判。
            void tick().then(() => {
                restoreCap();
                syncMatScroll();
            });
        }
        // Issue #28：材料填充后过统一高亮后处理——装饰出口那次施工已把高亮
        // 与线索一并铺好，本调用在这里是**幂等**的 chips 行兜底（材料缺失/
        // 无正文时不走上面的出口，chips 仍需刷）。
        host.refreshClueMarks?.(qs[qi].q);
        onActive(qs[qi].idx); // 首帧同步当前题（旧 bindOneGroupUnit 首调）
        // 窗口/字体变化会改行数（=改 scrollHeight）但不触发滚动事件，
        // 不重量算就会留下「该滚的没滚、读完的还挂着渐隐」。
        window.addEventListener("resize", onViewportResize);
        return () => {
            window.removeEventListener("resize", onViewportResize);
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
    <div
        class="wengu-gmat-host"
        data-scroll-cap={cap || capPx !== null || undefined}
        data-scroll-fade={fading ? "" : undefined}
    >
        <div class="wengu-gmat" data-mprotyle bind:this={matEl} onscroll={onMatScroll}>
            <span class="wengu-muted">…</span>
        </div>
    </div>
    {#if !collapsed && (cap || capPx !== null)}
        <!-- 可拖分隔条（Issue #138 §7.c）：**材料区真的溢出（`cap`）或用户
             已拖过时**才出现——短材料没有可调的高度，出手柄就是骗人（§0
             「短材料不出手柄」；纯独立题卷结构上没有这一层 ⇒ 零 DOM 变化）。
             ⚠️ 「或已拖过」这条不能省：把材料拖大后内容不再溢出 ⇒ `cap` 翻
             0，若只认 `cap`，手柄当场卸载、用户再也缩不回来（棘轮死锁，
             复核实测）。折叠态（`.wengu-gmat` 被 `display:none`）一并收起：材料
             区都不可见了，留一条孤立手柄没有意义。`role="separator"` +
             `tabindex=0` = 键盘可达。 -->
        <div
            class="wengu-splitter"
            data-act="mat-split"
            role="separator"
            aria-orientation="horizontal"
            tabindex="0"
            title={t("matSplitTitle")}
            aria-label={t("matSplitTitle")}
            bind:this={splitEl}
            class:wengu-splitting={dragging}
            onpointerdown={onSplitDown}
            onpointermove={onSplitMove}
            onpointerup={onSplitUp}
            onpointercancel={onSplitUp}
            ondblclick={onSplitDbl}
            onkeydown={onSplitKey}
        >
            <i></i>
        </div>
    {/if}
    <div class="wengu-gqs">
        {#each qs as gq, i (gq.q.id)}
            <QuizCardApp q={gq.q} idx={gq.idx} {m} {ctx} {host} hidden={i !== qi} badMarked={badMarks.has(gq.q.id)} />
        {/each}
    </div>
    <div class="wengu-gclues" data-clues hidden></div>
</div>
