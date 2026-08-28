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

    /* ── 悬浮位置：拖动挂件移动，松手落盘；位移 <4px 视为点击（开聊天） ── */
    let pos = $state(ctl.figurePos());
    let wrap = $state<HTMLElement | undefined>(undefined);
    let drag: { sx: number; sy: number; ox: number; oy: number; moved: boolean } | undefined;

    /** 动态钳位：按容器**实际内容尺寸**（气泡/聊天打开时容器被撑宽，
     *  静态余量猜不准——20260828 用户要求动态检测）把团子+展开物整体
     *  留在视口内，四角各留 8px。容器尺寸 0（未渲染）退化为团子 64。 */
    const clampPos = (x: number, y: number): { x: number; y: number } => {
        const w = wrap?.offsetWidth || 64;
        const h = wrap?.offsetHeight || 64;
        return {
            x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
            y: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
        };
    };

    /** 内容尺寸变化后回钳（开聊天/出气泡/窗口缩放都可能把展开物顶出界）。 */
    const reclamp = (): void => {
        if (!pos || !wrap) return;
        const next = clampPos(pos.x, pos.y);
        if (next.x !== pos.x || next.y !== pos.y) pos = next;
    };
    $effect(() => {
        ui.chatOpen;
        ui.line;
        pos;
        if (!wrap) return;
        // 内容重排后（面板开合/气泡进出）下一帧回钳
        const raf = requestAnimationFrame(reclamp);
        return () => cancelAnimationFrame(raf);
    });

    const onDown = (ev: PointerEvent): void => {
        if (ev.button !== 0) return;
        const el = ev.currentTarget as HTMLElement;
        el.setPointerCapture(ev.pointerId);
        // 首拖（无保存位置）从当前实际渲染位置起算，不跳变
        const r = el.closest(".wengu-companion")!.getBoundingClientRect();
        const base = pos ?? { x: r.x, y: r.y };
        pos = base;
        drag = { sx: ev.clientX, sy: ev.clientY, ox: base.x, oy: base.y, moved: false };
    };
    const onMove = (ev: PointerEvent): void => {
        if (!drag) return;
        const dx = ev.clientX - drag.sx;
        const dy = ev.clientY - drag.sy;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        pos = clampPos(drag.ox + dx, drag.oy + dy);
    };
    const onUp = (): void => {
        if (!drag) return;
        const moved = drag.moved;
        drag = undefined;
        if (moved) ctl.setFigurePos(pos.x, pos.y);
        else ui.chatOpen = !ui.chatOpen;
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
         位置未拖动过用 scss 默认右下角，拖动后 left/top 覆盖） -->
    <div class="wengu-companion" bind:this={wrap} style={pos ? `left:${pos.x}px;top:${pos.y}px` : ""}>
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
