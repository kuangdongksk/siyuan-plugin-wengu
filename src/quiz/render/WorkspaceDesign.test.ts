import { describe, expect, it } from "vitest";
import * as sass from "sass";
import { compile } from "svelte/compiler";

/**
 * 刷题工作区对稿规格（Issue #135，`design/sidebar-gap-list.md` §0–§4/§7）
 * 的**编译产物断言**：与 `StartPanelStyle.test.ts` 同口径——样式取自
 * **源码文本**（scss 走 `sass.compile` 真编译、组件走 `?raw` + Svelte
 * 真编译），断言尺寸/令牌而不是通读源码。
 *
 * 为什么必须落成断言（规范 §〇5）：本轮是「照稿施工」的量化还原，稿里
 * 每个数值都是一条验收标准；只靠「PR 描述里写了」下一轮必漂移。
 *
 * ⚠️ 「现有 DOM 类名逐字不动」（§ 两条铁律 1）：名录断言只保证**新类名
 * 在场** + 旧类名**仍在**，不钉死整份名录（本单改的是几何/颜色而非
 * 选择器形态，且跨片拆分是后续批次的事）。
 */

/** scss 分片（`?raw` 对 scss 恒空串，故只借 glob key 当路径表，内容交给 sass）。 */
const SCSS = Object.keys(
    import.meta.glob("../../scss/*.scss", { query: "?raw", import: "default", eager: true }) as Record<string, string>
).map((k) => `src/scss/${k.replace(/^\.\.\/\.\.\/scss\//, "")}`);

/** flow 侧源码（`?raw`）：胶囊渲染闸等「谁在渲染」的断言读它。 */
const FLOW = import.meta.glob("../flow/SideMount.ts", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;
const SIDEMOUNT = FLOW["../flow/SideMount.ts"] ?? "";

/** 组件源码（`?raw`）。 */
const RAW = import.meta.glob("../components/**/*.svelte", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;
const CARD = RAW["../components/QuizCard/index.svelte"] ?? "";
const NUMS = RAW["../components/NumRailApp.svelte"] ?? "";
const SIDE = RAW["../components/SidePanelApp.svelte"] ?? "";
const HEAD = RAW["../components/QuizHeadApp.svelte"] ?? "";

/** 某分片的编译产物（剥离注释，避免注释里的示例值被当规则命中）。 */
function cssOf(file: string): string {
    return sass.compile(file).css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 各域编译产物**合并**成一个语料：本单按 §11.1 红线把题号栏/题卡新增行/
 *  侧栏拆成了 nums.scss / card-extra.scss / side.scss，按分片名断言会把
 *  「规则搬到哪一片」也钉死（拆片是后续批次随时会做的事）——改成整仓
 *  scss 编译产物的并集，断言只认「规则在不在、值对不对」。 */
const ALL_SCSS = SCSS.map(cssOf).join("\n");
const BASE = ALL_SCSS;
const CARDS = ALL_SCSS;
const CARD_RENDER = ALL_SCSS;
const PANELS = ALL_SCSS;

/** 取某选择器的规则体（第一条命中；找不到抛错，防「选择器被删还全绿」）。 */
function bodyOf(css: string, sel: string): string {
    const i = css.indexOf(sel);
    expect(i, `未找到选择器 ${sel}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf("{", i);
    const close = css.indexOf("}", open);
    return css.slice(open + 1, close);
}

describe("§0 令牌派生态（base.scss 顶部）", () => {
    it("--wengu-faint / --wengu-border-strong 已定义，且为 color-mix 派生（零字面色值）", () => {
        const root = bodyOf(BASE, ":root");
        expect(root).toContain("--wengu-faint:");
        expect(root).toContain("--wengu-border-strong:");
        expect(root.match(/color-mix\(in srgb, var\(--b3-[a-z-]+\)/g)?.length).toBeGreaterThanOrEqual(2);
        expect(root.match(/#[0-9a-fA-F]{3,8}\b/g)).toBe(null);
    });
});

describe("§2 题号栏（NumRailApp + cards.scss）", () => {
    it("栏体 64px / 12px 10px 内衬 / gap 8px，且内滚不显滚动条", () => {
        const body = bodyOf(CARDS, ".wengu-nums {");
        expect(body).toContain("width: 64px");
        expect(body).toContain("padding: 12px 10px");
        expect(body).toContain("gap: 8px");
        expect(body).toContain("scrollbar-width: none");
        expect(CARDS).toContain(".wengu-nums::-webkit-scrollbar");
        // 滚动职责下放网格层（帽/图例常驻不滚）
        const grid = bodyOf(CARDS, ".wengu-nums-grid {");
        expect(grid).toContain("overflow-y: auto");
        expect(grid).toContain("grid-template-columns: 1fr");
        expect(grid).toContain("gap: 5px");
    });

    it("按钮 28px / 透明底 / 常规边 / tabular", () => {
        const body = bodyOf(CARDS, ".wengu-num {");
        expect(body).toContain("height: 28px");
        expect(body).toContain("background: transparent");
        expect(body).toContain("border: 1px solid var(--b3-border-color)");
        expect(body).toContain("font-variant-numeric: tabular-nums");
    });

    it("当前题=内描边语言（与侧栏选中同款，用户已拍板不登记例外）", () => {
        const body = bodyOf(CARDS, ".wengu-num-active,");
        expect(body).toContain("background: var(--b3-theme-primary-lightest)");
        expect(body).toContain("box-shadow: inset 0 0 0 1.5px var(--b3-theme-primary)");
    });

    it("答对/答错补语义边；已答中性化（不再用 primary 系，避免与答对混淆）", () => {
        const ok = bodyOf(CARDS, ".wengu-num-right,");
        const bad = bodyOf(CARDS, ".wengu-num-wrong,");
        const done = bodyOf(CARDS, ".wengu-num-answered,");
        expect(ok).toContain("color-mix(in srgb, var(--b3-theme-success) 42%, transparent)");
        expect(bad).toContain("color-mix(in srgb, var(--b3-theme-error) 42%, transparent)");
        expect(done).toContain("color-mix(in srgb, var(--b3-theme-on-background) 14%, transparent)");
        expect(done).toContain("var(--wengu-border-strong)");
        expect(done).not.toContain("--b3-theme-primary-lightest");
    });

    it("组件三层结构齐备（帽 / 网格 / 图例）且图例分「揭示」两档", () => {
        expect(NUMS).toContain('class="wengu-nums-cap"');
        expect(NUMS).toContain('class="wengu-nums-grid"');
        expect(NUMS).toContain('class="wengu-nums-legend"');
        // 作答中只留「当前/已答」两项，揭示后补对错（图例的 revealed 闸）
        expect(NUMS).toMatch(/\{#if revealed\}[\s\S]*k-ok[\s\S]*k-bad[\s\S]*\{\/if\}/);
        // 类名契约逐字不动（旧类名仍在）
        for (const cls of ["wengu-num", "wengu-num-gap", "wengu-num-gap-line"]) expect(NUMS).toContain(cls);
        expect(NUMS).toContain("data-nums");
        expect(NUMS).toContain("data-num={i + 1}");
    });

    it("题号超 60 才出「…至 N」（§2.8）", () => {
        expect(NUMS).toMatch(/MORE_AT = 60/);
        expect(NUMS).toContain("wengu-nums-more");
    });
});

describe("§1 侧栏（SidePanelApp + base.scss）", () => {
    it("280px / 常规边 / 微沉底（color-mix 混黑，明暗两态同式）", () => {
        const body = bodyOf(BASE, ".wengu-side {");
        expect(body).toContain("width: 280px");
        expect(body).toContain("border-right: 1px solid var(--b3-border-color)");
        expect(body).toContain("color-mix(in srgb, var(--b3-theme-background) 94%, black)");
    });

    it("头部去底边线、13px/600、图标钮 26×26", () => {
        const head = bodyOf(BASE, ".wengu-side-head {");
        expect(head).toContain("font-size: 13px");
        expect(head).toContain("letter-spacing: 0.04em");
        expect(head).not.toContain("border-bottom");
        const btn = bodyOf(BASE, ".wengu-side-head .wengu-side-iconbtn");
        expect(btn).toContain("width: 26px");
        expect(btn).toContain("height: 26px");
    });

    it("工具钮升等宽文字钮 + AI 入口钮（新类名，挂既有 AI 面板）", () => {
        const tool = bodyOf(BASE, ".wengu-side-tool {");
        expect(tool).toContain("flex: 1");
        expect(tool).toContain("height: 30px");
        expect(tool).toContain("gap: 6px");
        const ai = bodyOf(BASE, ".wengu-side-ai {");
        expect(ai).toContain("height: 32px");
        expect(ai).toContain("var(--b3-theme-primary-lightest)");
        expect(ai).toContain("color-mix(in srgb, var(--b3-theme-primary) 45%, transparent)");
        // 组件侧：两钮同处 .wengu-side-toolrow，AI 钮 act=side-ai（SideMount 分派到 AI 工作区）
        expect(SIDE).toContain("wengu-side-toolrow");
        expect(SIDE).toContain('data-act="side-ai"');
        expect(SIDE).toContain('class="wengu-side-tool"');
    });

    it("选中态统一内描边语言（左条退役），且树行同式", () => {
        const active = bodyOf(BASE, ".wengu-side-active,");
        expect(active).toContain("background: var(--b3-theme-primary-lightest)");
        expect(active).toContain("box-shadow: inset 0 0 0 1.5px var(--b3-theme-primary)");
        expect(active).not.toContain("border-left");
        const tree = bodyOf(BASE, ".wengu-side-body .wengu-kp-doc.b3-list-item--focus,");
        expect(tree).toContain("box-shadow: inset 0 0 0 1.5px var(--b3-theme-primary)");
    });

    it("旧类名逐字不动（DOM 零变化）", () => {
        for (const cls of [
            "wengu-side-head",
            "wengu-side-tools",
            "wengu-side-search",
            "wengu-side-actions",
            "wengu-side-convert",
            "wengu-side-body",
            "wengu-side-item",
            "wengu-side-title",
            "wengu-side-meta",
            "wengu-side-iconbtn",
        ])
            expect(SIDE).toContain(cls);
    });
});

describe("§3 头部统计条（QuizHeadApp + panels.scss）", () => {
    it("吸顶态 46px 单行 nowrap / 段距 14px / 内衬 0 22px", () => {
        const body = bodyOf(
            PANELS,
            ".wengu-main:not(.wengu-review-main):not(.wengu-ws-main) > .wengu-head:first-child {"
        );
        expect(body).toContain("min-height: 46px");
        expect(body).toContain("padding: 0 22px");
        expect(body).toContain("gap: 14px");
        expect(body).toContain("flex-wrap: nowrap");
    });

    it("窄窗 ≤900px 回退 wrap（桌面面板自适应用 media query 的合法例外）", () => {
        expect(PANELS).toContain("@media (max-width: 900px)");
        const i = PANELS.indexOf("@media (max-width: 900px)");
        const seg = PANELS.slice(i, PANELS.indexOf("}", PANELS.indexOf("{", i)) + 1);
        expect(seg).toContain("flex-wrap: wrap");
    });

    it("分段 13px；竖线定高 16 居中；计时升正文色 + 600", () => {
        expect(bodyOf(PANELS, ".wengu-head .wengu-head-seg {")).toContain("font-size: 13px");
        const sep = bodyOf(PANELS, ".wengu-head .wengu-head-sep {");
        expect(sep).toContain("align-self: center");
        expect(sep).toContain("height: 16px");
        expect(sep).toContain("var(--wengu-border-strong)");
        const timer = bodyOf(PANELS, ".wengu-timer {");
        expect(timer).toContain("gap: 6px");
        expect(timer).toContain("color: var(--b3-theme-on-surface)");
        expect(timer).toContain("font-weight: 600");
    });

    it("「第 N 轮 · 进行中」胶囊（§3.5 C 类；模式切换器不复活）", () => {
        const mode = bodyOf(PANELS, ".wengu-head-mode {");
        expect(mode).toContain("border-radius: 999px");
        expect(mode).toContain("var(--wengu-well)");
        expect(HEAD).toContain('class="wengu-head-mode"');
        // 无进行中轮次（roundIndex=0）不出胶囊
        expect(SIDEMOUNT).toMatch(/roundIndex\(v\) > 0 \?/);
    });

    it("交卷钮升 primary（本面板唯一主操作）", () => {
        expect(HEAD).toMatch(/variant="primary"[\s\S]{0,600}wengu-end-round/);
        const body = bodyOf(PANELS, ".wengu-end-round {");
        expect(body).toContain("height: 28px");
        expect(body).toContain("padding: 0 14px");
        expect(body).toContain("font-size: 12.5px");
    });
});

describe("§4 题卡（QuizCard + cards.scss / card-render.scss）", () => {
    it("卡壳改浮起语言（surface 底 + 常规边 + 大圆角），性能属性保留", () => {
        const body = bodyOf(CARDS, ".wengu-card {");
        expect(body).toContain("background: var(--b3-theme-surface)");
        expect(body).toContain("border: 1px solid var(--b3-border-color)");
        expect(body).toContain("border-radius: var(--b3-border-radius-b)");
        expect(body).toContain("content-visibility: auto");
        expect(body).toContain("scroll-margin: 8px");
    });

    it("题号胶囊化 + 题型徽标中性化（旧类名不动）", () => {
        const num = bodyOf(CARDS, ".wengu-card-num {");
        expect(num).toContain("border-radius: 999px");
        expect(num).toContain("padding: 2px 10px");
        expect(num).toContain("font-size: 11px");
        const badge = bodyOf(CARDS, ".wengu-badge {");
        expect(badge).toContain("border-radius: 999px");
        expect(badge).toContain("var(--wengu-well)");
        expect(badge).not.toContain("--b3-theme-primary-lightest");
    });

    it("考点 chips 行样式逐值（§4.3）", () => {
        const caps = bodyOf(CARD_RENDER, ".wengu-kcaps {");
        expect(caps).toContain("gap: 8px");
        expect(caps).toContain("margin-top: 12px");
        expect(bodyOf(CARD_RENDER, ".wengu-kcaps-label {")).toContain("font-size: 12px");
        const chip = bodyOf(CARD_RENDER, ".wengu-kchip {");
        expect(chip).toContain("border-radius: 999px");
        expect(chip).toContain("padding: 2px 10px");
        expect(chip).toContain("color: var(--b3-theme-primary)");
        expect(chip).toContain("background: var(--b3-theme-primary-lightest)");
    });

    it("考点 chips **仅揭示后渲染**（防剧透：整行不出而非留白）", () => {
        // 组件侧闸：kcapsRow 的根 if 双条件（有考点 && revealed）
        expect(CARD).toMatch(/\{#if kcaps\.length > 0 && ui\.revealed\}/);
        // 关键词：考点名可暗示解法方向，揭示前不渲染不占位
        expect(CARD).toContain("kcapsRow");
    });

    it("自评五星样式逐值（§4.4）：26×26 星钮 / warning 点亮 / hint 11px", () => {
        const self = bodyOf(CARD_RENDER, ".wengu-self {");
        expect(self).toContain("gap: 12px");
        expect(self).toContain("margin-top: 12px");
        const btn = bodyOf(CARD_RENDER, ".wengu-star-btn {");
        expect(btn).toContain("width: 26px");
        expect(btn).toContain("height: 26px");
        expect(btn).toContain("color: var(--wengu-faint)");
        expect(CARD_RENDER).toContain(".wengu-star-btn svg");
        const on = bodyOf(CARD_RENDER, ".wengu-star-btn.on {");
        expect(on).toContain("color: var(--b3-card-warning-color)");
        expect(bodyOf(CARD_RENDER, ".wengu-self-hint {")).toContain("font-size: 11px");
    });

    it("五星 radiogroup 语义 + 再点同值取消 + 键盘左右（§7.b）", () => {
        expect(CARD).toContain('role="radiogroup"');
        expect(CARD).toContain('role="radio"');
        // 再点同值取消：rate() 的 stars === n ? 0 : n
        expect(CARD).toMatch(/stars === n \? 0 : n/);
        // 显示闸沿用 selfOn（容器与 data-self 契约不动）
        expect(CARD).toContain('class="wengu-self" data-self hidden={!ui.selfOn}');
        // 键盘左右
        expect(CARD).toContain("ArrowLeft");
        expect(CARD).toContain("ArrowRight");
    });
});

describe("§13.2 组件样式：Svelte 真编译零 unused 选择器", () => {
    it("本轮改动的组件均无 css_unused_selector 警告", () => {
        for (const [name, src] of [
            ["NumRailApp", NUMS],
            ["SidePanelApp", SIDE],
            ["QuizHeadApp", HEAD],
            ["QuizCard", CARD],
        ] as const) {
            expect(src.length, name).toBeGreaterThan(0);
            const out = compile(src, { css: "injected", dev: false, filename: `${name}.svelte` });
            const unused = out.warnings
                .filter((w) => w.code === "css_unused_selector")
                .map((w) => `${name}: ${String(w.message)}`);
            expect(unused).toEqual([]);
        }
    });
});
