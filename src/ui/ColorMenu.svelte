<script lang="ts">
    /**
     * 竖排色板浮层（Issue #57，**独立可复用 UI 积木**，零业务依赖）：
     * 每行 = 色块 + 色名，点行回调 `onPick(key)`；点外部 / Esc 关闭。
     *
     * 组件**只管展示与回调**——色板数据（`colors`）由调用侧喂进来，
     * 「选完做什么」也由调用侧决定，故后续任何选色场景（不只线索标注）
     * 都能直接复用它。样式走全局 scss（`.wengu-colormenu*`），组件零
     * `<style>`（Svelte 迁移约定）。
     *
     * 色块渲染：调用侧给的 `cssVar` 直接进 `background-color:var(...)`
     * ——明暗主题与第三方主题（Neo）实时适配，组件不内置任何色值。
     */
    import { onMount } from "svelte";

    /** 一格色板：`key` 回传值、`cssVar` 主题变量名、`label` 显示名。 */
    export interface ColorMenuColor {
        key: number;
        /** 主题 CSS 变量名（如 `--b3-card-info`）；前景取 `${cssVar}-color`。 */
        cssVar: string;
        /** 色名（调用侧已取词）。 */
        label: string;
    }

    let {
        colors,
        current = undefined,
        onPick,
        onClose,
    }: {
        colors: readonly ColorMenuColor[];
        /** 当前色号（该格打勾；缺省=未选）。 */
        current?: number;
        onPick: (key: number) => void;
        /** 关闭请求（点外部/Esc——宿主据此卸载浮层）。 */
        onClose?: () => void;
    } = $props();

    let root: HTMLElement | undefined = $state();
    /** 外部点击监听的**就绪闸**：打开色板的那次 pointerdown 可能仍在派发
     *  （浮层在同一拍挂载、监听同一拍注册），若当场把该事件当成「点了外部」
     *  就会开了又关（肉眼是「点了没反应」）。故监听延到下一个宏任务——
     *  那时当次事件早已结束，之后的每一次 pointerdown 才是真外部点击。 */
    let armed = false;

    /** 外部点击关闭：`pointerdown` 比 click 早（在宿主清/改选择前就判定完），
     *  且判据收在「是否命中本组件根」——**只判根外即关**，不关心点到了什么。 */
    const onDocDown = (ev: PointerEvent): void => {
        if (!armed) return;
        const t = ev.target as Node | null;
        if (root && t && root.contains(t)) return;
        onClose?.();
    };
    const onKey = (ev: KeyboardEvent): void => {
        if (ev.key === "Escape") {
            ev.preventDefault();
            onClose?.();
        }
    };

    onMount(() => {
        // 捕获阶段监听：宿主若在冒泡层 stopPropagation 也照样收到（浮条
        // 自己就吞 mousedown，若走冒泡会被我们自己的隔离拦掉）
        const timer = setTimeout(() => (armed = true), 0);
        document.addEventListener("pointerdown", onDocDown, true);
        document.addEventListener("keydown", onKey, true);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("pointerdown", onDocDown, true);
            document.removeEventListener("keydown", onKey, true);
        };
    });
</script>

<div class="wengu-colormenu" bind:this={root} role="menu">
    {#each colors as c (c.key)}
        <button
            type="button"
            class="wengu-colormenu-item{c.key === current ? ' wengu-colormenu-item-on' : ''}"
            role="menuitem"
            title={c.label}
            data-color={c.key}
            onclick={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                onPick(c.key);
            }}
        >
            <i class="wengu-colormenu-swatch" style={`background-color:var(${c.cssVar})`}></i>
            <span class="wengu-colormenu-label">{c.label}</span>
        </button>
    {/each}
</div>
