<script lang="ts">
    import { companionCtl } from "../index";
    import { EXPR_FACES } from "../rules/Expressions";
    import { initialCompanionUi, type CompanionUi } from "../core/CompanionUi";
    import ChatPanel from "./ChatPanel.svelte";

    const ctl = companionCtl()!;
    // $state 只能在 Svelte 编译单元顶层创建：全局悬浮层唯一实例，
    // acquireUi 采纳这份代理挂到单例控制器
    const localUi = $state(initialCompanionUi());
    const ui: CompanionUi = ctl.acquireUi(() => localUi);

    let bubbleOn = $state(false);
    let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
        ui.lineTs;
        if (!ui.line) return;
        bubbleOn = true;
        clearTimeout(bubbleTimer);
        bubbleTimer = setTimeout(() => (bubbleOn = false), 7000);
        return () => clearTimeout(bubbleTimer);
    });

    /* ── 悬浮位置：存团子右/下边到视口右/下缘的距离（拖动挂件移动，
       松手落盘；位移 <4px 视为点击（开聊天））。团子是锚：内联锚随
       朝向换轴（贴右/下→right/bottom，贴左/上→left/top），展开物
       （气泡/聊天）向屏内生长，永不推挤团子。 ── */
    type Pos = { r: number; b: number };
    const FW = 64; // 团子边长（= .wengu-comp-figure 尺寸）
    const saved = ctl.figurePos();
    let pos = $state<Pos | undefined>(
        saved
            ? { r: Math.max(0, window.innerWidth - saved.x - FW), b: Math.max(0, window.innerHeight - saved.y - FW) }
            : undefined
    );
    let wrap = $state<HTMLElement | undefined>(undefined);
    let fig = $state<HTMLElement | undefined>(undefined);
    let vw = $state(window.innerWidth);
    let vh = $state(window.innerHeight);
    let drag: { sx: number; sy: number; ox: number; oy: number; moved: boolean } | undefined;

    /** 落点朝向=贴边侧：r/b 小贴右/下，大贴左/上。 */
    const orient = (r: number, b: number): { v: "top" | "bottom"; h: "left" | "right" } => ({
        v: b >= vh / 2 ? "top" : "bottom",
        h: r <= vw / 2 ? "right" : "left",
    });
    const side = $derived(pos ? orient(pos.r, pos.b) : { v: "bottom" as const, h: "right" as const });

    /** 动态钳位：容器实测内容尺寸把团子+展开物整体钳在视口内（四角
     *  留 8px），尺寸 0 退化团子。轴向按朝向算——朝左/上展开钳容器
     *  右/下缘距离 [8, 视口-容器-8]；朝右/下展开钳团子让位给展开物。 */
    const clampPos = (r: number, b: number): Pos => {
        const w = wrap?.offsetWidth || FW;
        const h = wrap?.offsetHeight || FW;
        const o = orient(r, b);
        return {
            r: o.h === "right" ? Math.max(8, Math.min(r, vw - w - 8)) : Math.max(w - FW + 8, Math.min(r, vw - FW - 8)),
            b: o.v === "bottom" ? Math.max(8, Math.min(b, vh - h - 8)) : Math.max(h - FW + 8, Math.min(b, vh - FW - 8)),
        };
    };
    const reclamp = (): void => {
        if (!pos || !wrap) return;
        const next = clampPos(pos.r, pos.b);
        if (next.r !== pos.r || next.b !== pos.b) pos = next;
    };
    $effect(() => {
        if (!wrap) return;
        const ro = new ResizeObserver(() => requestAnimationFrame(reclamp));
        ro.observe(wrap);
        return () => ro.disconnect();
    });

    /** 内联锚随朝向换轴：团子恒落在 (视口-r-64, 视口-b-64)，展开物朝
     *  屏内生长。未拖动（pos=undefined）走 scss 默认右下锚。 */
    const anchorStyle = $derived.by(() => {
        if (!pos) return "";
        const o = orient(pos.r, pos.b);
        return [
            o.h === "right" ? `right:${pos.r}px` : `left:${vw - pos.r - FW}px`,
            o.v === "bottom" ? `bottom:${pos.b}px` : `top:${vh - pos.b - FW}px`,
        ].join(";");
    });

    const onDown = (ev: PointerEvent): void => {
        if (ev.button !== 0) return;
        const el = ev.currentTarget as HTMLElement;
        el.setPointerCapture(ev.pointerId);
        // 首拖（无保存位置）从当前实际渲染位置起算，不跳变——未拖动
        // 朝向恒为右下默认，团子必在容器右下角，容器 rect 即团子位
        const rect = el.closest(".wengu-companion")!.getBoundingClientRect();
        const base = pos ?? { r: window.innerWidth - rect.right, b: window.innerHeight - rect.bottom };
        pos = base;
        drag = { sx: ev.clientX, sy: ev.clientY, ox: base.r, oy: base.b, moved: false };
    };
    const onMove = (ev: PointerEvent): void => {
        if (!drag) return;
        const dx = ev.clientX - drag.sx;
        const dy = ev.clientY - drag.sy;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        // 指针右移 → right 减小；指针下移 → bottom 减小
        pos = clampPos(drag.ox - dx, drag.oy - dy);
    };
    const onUp = (): void => {
        if (!drag || !pos) return;
        const moved = drag.moved;
        drag = undefined;
        if (moved) {
            // 落盘团子左上（设置契约未变）——读团子实际 rect，不随
            // 展开物开合与朝向换轴漂移
            const fr = fig?.getBoundingClientRect();
            ctl.setFigurePos(fr ? fr.left : vw - pos.r - FW, fr ? fr.top : vh - pos.b - FW);
        } else ui.chatOpen = !ui.chatOpen;
    };
    const onMenu = (ev: MouseEvent): void => {
        ev.preventDefault();
        ctl.openFigureMenu(ev.clientX, ev.clientY);
    };
    const onResize = (): void => reclamp();
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} onresize={onResize} />

{#if ui.enabled}
    <!-- 全局悬浮层：组件根即 fixed 容器（mount 到 body，样式在 companion.scss；
         位置未拖动过用 scss 默认右下角，拖动后内联锚按朝向换轴钉住团子角；
         wengu-comp-top/left 朝向类由贴边侧派生） -->
    <div
        class="wengu-companion{side.v === 'top' ? ' wengu-comp-top' : ''}{side.h === 'left' ? ' wengu-comp-left' : ''}"
        bind:this={wrap}
        style={anchorStyle}
    >
        <div class="wengu-companion-inner">
            {#if ui.chatOpen}
                <ChatPanel {ctl} {ui} />
            {/if}
            {#if bubbleOn && ui.line}
                <div class="wengu-comp-bubble">{ui.line}</div>
            {/if}
            <button
                type="button"
                class="wengu-comp-figure"
                title={ctl.t("companionHint")}
                draggable="false"
                bind:this={fig}
                onpointerdown={onDown}
                onpointermove={onMove}
                onpointerup={onUp}
                oncontextmenu={onMenu}
            >
                {#if ui.imgExpr[ui.expr]}
                    <img class="wengu-comp-img" src={ui.imgExpr[ui.expr]} alt="" draggable="false" />
                {:else}
                    <svg viewBox="0 0 64 64" aria-hidden="true">
                        <circle class="wengu-comp-body" cx="32" cy="34" r="21" />
                        {#key ui.expr}
                            <g class="wengu-comp-face">
                                {@html EXPR_FACES[ui.expr].eyes}
                                {@html EXPR_FACES[ui.expr].mouth}
                                {@html EXPR_FACES[ui.expr].extra ?? ""}
                            </g>
                        {/key}
                    </svg>
                {/if}
            </button>
        </div>
    </div>
{/if}
