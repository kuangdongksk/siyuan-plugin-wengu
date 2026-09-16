import { describe, expect, it } from "vitest";
import * as sass from "sass";
import { compile } from "svelte/compiler";

/**
 * 阅读组可拖分隔条的**对稿规格**（Issue #138，`design/sidebar-gap-list.md`
 * §6.1 / §7.c）：与 `WorkspaceDesign.test.ts` / `StartPanelStyle.test.ts`
 * 同口径——scss 走 `sass.compile` 真编译、组件走 `?raw` + Svelte 真编译，
 * 断言尺寸/令牌/结构而不是通读源码。
 *
 * 本轮是「按规格施工」的量化落地：§7.c 表里每个数值都是一条验收标准，
 * 只靠 PR 描述下一轮必漂移。故本文件锁四件事：
 *   ① 验收 1 结构与三态（6px 手柄 / 出血 4px / 内芯 56×2 999px / 三档颜色）；
 *   ② 验收 2 交互接线（pointer 三路 + capture + dblclick + 键盘 + 拖后重算）；
 *   ③ 验收 3 约束（纯函数在 MaterialSplitter.test.ts，此处只锁「接线到了」）；
 *   ④ 验收 5 短材料不出手柄 / 材料内滚不显滚动条。
 *
 * ⚠️ 手柄样式的**规则在场与值**在编译产物上断言，不钉分片落点
 * （`reading.scss` 是否再拆片是后续批次自由）。
 */

/** scss 分片（`?raw` 对 scss 恒空串，故只借 glob key 当路径表，内容交给 sass）。 */
const SCSS = Object.keys(
    import.meta.glob("../../scss/*.scss", { query: "?raw", import: "default", eager: true }) as Record<string, string>
).map((k) => `src/scss/${k.replace(/^\.\.\/\.\.\/scss\//, "")}`);

/** 各组件的 `?raw` 源码（结构/交互接线的断言读它）。 */
const RAW = import.meta.glob("../components/**/*.svelte", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;
const GROUP = RAW["../components/GroupUnitApp.svelte"] ?? "";

/** 整仓 scss 编译产物的并集（不钉分片落点）。 */
const ALL = SCSS.map((f) => sass.compile(f).css.replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");

/** 取某选择器的规则体（第一条命中；找不到抛错，防「选择器被删还全绿」）。 */
function bodyOf(css: string, sel: string): string {
    const i = css.indexOf(sel);
    expect(i, `未找到选择器 ${sel}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf("{", i);
    const close = css.indexOf("}", open);
    return css.slice(open + 1, close);
}

describe("§7.c 手柄结构与三态（验收 1）", () => {
    it("6px 高 + 出血 4px（命中 14px）+ row-resize + touch-action:none", () => {
        const body = bodyOf(ALL, ".wengu-reading .wengu-splitter {");
        expect(body).toContain("height: 6px");
        expect(body).toContain("margin: 0 -4px");
        expect(body).toContain("cursor: row-resize");
        // 触屏不写 touch-action:none ⇒ 手势被判成滚动、拖动中途 cancel
        expect(body).toContain("touch-action: none");
        expect(body).toContain("flex: none");
    });

    it("内芯 56×2、圆角 999px，常态为 on-surface-light 30% 派生（零字面色值）", () => {
        const bar = bodyOf(ALL, ".wengu-reading .wengu-splitter > i {");
        expect(bar).toContain("width: 56px");
        expect(bar).toContain("height: 2px");
        expect(bar).toContain("border-radius: 999px");
        expect(bar).toContain("color-mix(in srgb, var(--b3-theme-on-surface-light) 30%, transparent)");
        expect(bar.match(/#[0-9a-fA-F]{3,8}\b/g)).toBe(null);
    });

    it("hover / focus-visible ⇒ primary 50%（键盘可达的可见反馈）", () => {
        const hover = bodyOf(ALL, ".wengu-reading .wengu-splitter:hover > i,");
        expect(hover).toContain("color-mix(in srgb, var(--b3-theme-primary) 50%, transparent)");
        expect(ALL).toContain(".wengu-splitter:focus-visible");
    });

    it("拖动中（body.wengu-splitting）⇒ primary 实色 + 全局 row-resize + 禁选", () => {
        const drag = bodyOf(ALL, ".wengu-reading .wengu-splitter.wengu-splitting > i {");
        expect(drag).toContain("background: var(--b3-theme-primary)");
        expect(drag).not.toContain("color-mix");
        const global = bodyOf(ALL, "body.wengu-splitting {");
        expect(global.length).toBeGreaterThan(0);
        expect(global).toContain("cursor: row-resize");
        expect(global).toContain("user-select: none");
    });
});

describe("§7.c 交互接线（验收 2）", () => {
    it("DOM 契约：separator + tabindex=0 + 内芯 <i>", () => {
        expect(GROUP).toContain('class="wengu-splitter"');
        expect(GROUP).toMatch(/role="separator"/);
        expect(GROUP).toMatch(/aria-orientation="horizontal"/);
        expect(GROUP).toMatch(/tabindex="0"/);
        expect(GROUP).toMatch(/<div[\s\S]*class="wengu-splitter"[\s\S]*?>\s*<i><\/i>/);
    });

    it("pointer 三路 + setPointerCapture + 拖中全局类", () => {
        expect(GROUP).toContain("onpointerdown={onSplitDown}");
        expect(GROUP).toContain("onpointermove={onSplitMove}");
        expect(GROUP).toContain("onpointerup={onSplitUp}");
        // pointercancel 必须接（触屏手势被系统抢走时靠它收尾）
        expect(GROUP).toContain("onpointercancel={onSplitUp}");
        expect(GROUP).toContain("setPointerCapture");
        expect(GROUP).toContain("releasePointerCapture");
        expect(GROUP).toContain('document.body.classList.add("wengu-splitting")');
        expect(GROUP).toContain('document.body.classList.remove("wengu-splitting")');
    });

    it("up 时**手动补一次 syncMatScroll**（拖动不触发 resize，渐隐会滞留）", () => {
        // 摘掉全局类之后紧跟落库与重算，三件在同一个收尾函数里
        const fn = GROUP.slice(GROUP.indexOf("const onSplitUp"));
        const tail = fn.slice(0, fn.indexOf("};"));
        expect(tail).toContain('classList.remove("wengu-splitting")');
        expect(tail).toContain("persistCap()");
        expect(tail).toContain("syncMatScroll()");
    });

    /** 独立文件中「双击复位」的正文（复位必须同时清内联与存储）。 */
    const resetBody = (): string => {
        const fn = GROUP.slice(GROUP.indexOf("const resetCap"));
        return fn.slice(0, fn.indexOf("};"));
    };

    it("双击复位 = 清内联变量 + **清库**（只清内联的话装载会把旧比例折算回来）", () => {
        expect(GROUP).toContain("ondblclick={onSplitDbl}");
        expect(resetBody()).toContain('matEl?.style.removeProperty("--wengu-mat-cap")');
        expect(resetBody()).toContain("host.setMatCapRatio?.(undefined)");
    });

    it("键盘映射走纯函数 nextMatCap（±24px / min / max 在 MaterialSplitter.test.ts 锁）", () => {
        expect(GROUP).toContain("onkeydown={onSplitKey}");
        expect(GROUP).toContain("nextMatCap(e.key, from, colHeight(), window.innerHeight)");
        // 起点是量算实值：未拖过时不能按持久化比值折算起步（折算得 0 ⇒ 首键拍到下限）
        expect(GROUP).toContain("capPx ?? matEl?.clientHeight ?? MAT_MIN_PX");
        // 键盘要拦默认行为（否则方向键把面板滚走）
        expect(GROUP).toContain("e.preventDefault()");
    });

    it("上限与比值的基准是**列**（.wengu-main），不是材料区自身高（自指=只能缩不能放）", () => {
        expect(GROUP).toContain('closest<HTMLElement>(".wengu-main")');
        expect(GROUP).toContain("const colHeight = (): number => colEl?.clientHeight || window.innerHeight");
        // 三路都过 colHeight（applyCap 的量算 / 落库分母）
        expect(GROUP).toContain("ratioOf(capPx, window.innerHeight)");
        expect(GROUP).toMatch(/applyCap\(dragFrom\.h \+ \(e\.clientY - dragFrom\.y\), dragFrom\.col\)/);
        expect(GROUP).toContain("col: colHeight()");
    });

    it("内联变量写在**材料区自身**（.wengu-gmat）：自身声明压过 host 继承的 52vh", () => {
        // host 上是 `--wengu-mat-cap:52vh`（reading.scss），gmat 用 var() 消费。
        // 内联必须落在**消费者自己**身上，否则（若写在别处）压不过 52vh。
        expect(GROUP).toContain('matEl?.style.setProperty("--wengu-mat-cap"');
        expect(GROUP).toContain('matEl.style.setProperty("--wengu-mat-cap"');
    });

    it("写值唯一出口 = clamp → 内联 --wengu-mat-cap（px 盖 52vh 默认）", () => {
        const fn = GROUP.slice(GROUP.indexOf("const applyCap"));
        const body = fn.slice(0, fn.indexOf("};"));
        expect(body).toContain("clampMatCap(");
        expect(body).toContain('style.setProperty("--wengu-mat-cap"');
        // 拖动/键盘/装载恢复三路都过 applyCap 或同款折算
        expect(GROUP.match(/clampMatCap\(/g)?.length).toBeGreaterThanOrEqual(2);
    });
});

describe("§7.c 显示闸与持久化（验收 4/5）", () => {
    it("手柄闸：溢出或有用户高度才渲染（短材料/独立题默认零 DOM 变化）", () => {
        expect(GROUP).toMatch(/\{#if !collapsed && \(cap \|\| capPx !== null\)\}[\s\S]*wengu-splitter[\s\S]*\{\/if\}/);
        // 折叠态材料区 display:none ⇒ 手柄一并收起（不留孤立手柄）
        expect(GROUP).toContain("{#if !collapsed &&");
        // 限高属性同闸：拖大后 cap 翻 0 也必须留着（否则内联 px 没处生效 +
        // 手柄卸载 ⇒ 棘轮死锁，用户缩不回来）
        // 表达式以 prettier 稳定形态为准（它会去掉冗余括号）
        expect(GROUP).toContain("data-scroll-cap={cap || capPx !== null || undefined}");
    });

    it("装载期恢复比例：undefined（从未拖过）⇒ 一个内联变量都不写", () => {
        const fn = GROUP.slice(GROUP.indexOf("const restoreCap"));
        const body = fn.slice(0, fn.indexOf("};"));
        expect(body).toContain("normalizeMatRatio(m.matCapRatio)");
        expect(body).toContain("if (ratio === undefined");
        // 折算乘数与落库分母同源（视口高），越界回默认（不写内联）
        expect(body).toContain("ratio * window.innerHeight");
    });

    it("落库走 host.setMatCapRatio（存比例不存像素）", () => {
        expect(GROUP).toContain("host.setMatCapRatio?.(ratio)");
        expect(GROUP).toContain("ratioOf(capPx, window.innerHeight)");
    });

    it("resize 先重夹取再重量（窗口变矮后内联 px 不越 75vh 上限）", () => {
        expect(GROUP).toContain("reclampCap");
        expect(GROUP).toContain('addEventListener("resize", onViewportResize)');
        expect(GROUP).toContain('removeEventListener("resize", onViewportResize)');
    });

    it("文案走 i18n（禁字面中文）", () => {
        expect(GROUP).toContain('t("matSplitTitle")');
        expect(GROUP).not.toMatch(/title="拖动/);
    });

    it("材料区内滚不显滚动条（两条写法都要在场）", () => {
        const body = bodyOf(ALL, ".wengu-reading .wengu-gmat-host[data-scroll-cap] .wengu-gmat {");
        expect(body).toContain("scrollbar-width: none");
        expect(ALL).toContain(".wengu-gmat-host[data-scroll-cap] .wengu-gmat::-webkit-scrollbar");
    });
});

describe("Svelte 真编译闸（样式/结构失配的唯一静态网）", () => {
    it("组件编译零 css_unused_selector", () => {
        const out = compile(GROUP, { css: "injected", dev: false, filename: "GroupUnitApp.svelte" });
        const unused = out.warnings.filter((w) => w.code === "css_unused_selector").map((w) => String(w.message));
        expect(unused).toEqual([]);
    });
});
