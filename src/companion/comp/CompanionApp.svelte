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

    /* ── 悬浮位置：存 right/bottom 锚（可辨贴边方向）；拖动挂件移动，
       松手落盘；位移 <4px 视为点击（开聊天） ── */
    type Pos = { r: number; b: number }; // 团子右/下边到视口右/下缘的距离
    const saved = ctl.figurePos();
    let pos = $state<Pos | undefined>(
        saved
            ? { r: Math.max(0, window.innerWidth - saved.x - 64), b: Math.max(0, window.innerHeight - saved.y - 64) }
            : undefined
    );
    let wrap = $state<HTMLElement | undefined>(undefined);
    let drag: { sx: number; sy: number; ox: number; oy: number; moved: boolean } | undefined;

    /** 动态钳位（right/bottom 空间）：容器实测内容尺寸把团子+展开物钳在
     *  视口内，四角留 8px；尺寸 0 退化团子 64。 */
    const clampPos = (r: number, b: number): Pos => {
        const w = wrap?.offsetWidth || 64;
        const h = wrap?.offsetHeight || 64;
        return {
            r: Math.max(8, Math.min(r, window.innerWidth - w - 8)),
            b: Math.max(8, Math.min(b, window.innerHeight - h - 8)),
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

    /** 朝向：贴下半屏→面板向上展开（在团子上方），上半屏→向下；
     *  贴右半屏→向左（内容右对齐团子），左半屏→向右。 */
    const side = $derived({
        v: (pos?.b ?? 0) >= window.innerHeight / 2 ? "up" : "down",
        h: (pos?.r ?? 8) <= window.innerWidth / 2 ? "left" : "right",
    });

    const onDown = (ev: PointerEvent): void => {
        if (ev.button !== 0) return;
        const el = ev.currentTarget as HTMLElement;
        el.setPointerCapture(ev.pointerId);
        // 首拖（无保存位置）从当前实际渲染位置起算，不跳变
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
        if (!drag || !wrap) return;
        const moved = drag.moved;
        drag = undefined;
        if (moved) {
            // 落盘 left/top（设置契约未变），由 right/bottom 反算
            const rect = wrap.getBoundingClientRect();
            ctl.setFigurePos(window.innerWidth - pos.r - rect.width, window.innerHeight - pos.b - rect.height);
        } else ui.chatOpen = !ui.chatOpen;
    };
    const onMenu = (ev: MouseEvent): void => {
        ev.preventDefault();
        ctl.openFigureMenu(ev.clientX, ev.clientY);
    };
    const onResize = (): void => reclamp();
</script>

<svelte:window onresize={onResize} />

{#if ui.enabled}
    <!-- 全局悬浮层：组件根即 fixed 容器（mount 到 body，样式在 companion.scss；
         位置未拖动过用 scss 默认右下角，拖动后 right/bottom 覆盖；
         wengu-comp-up/left 朝向类由贴边方向派生） -->
    <div
        class="wengu-companion{side.v === 'up' ? ' wengu-comp-up' : ''}{side.h === 'left' ? ' wengu-comp-left' : ''}"
        bind:this={wrap}
        style={pos ? `right:${pos.r}px;bottom:${pos.b}px` : ""}
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
