import { describe, expect, it } from "vitest";
import * as sass from "sass";

/**
 * 错题本单列可展开行的视觉规格断言（Issue #136 §5，设计稿
 * `design/wengu-sidebar-redesign.html` ⑦ 区块 / 差距清单 §5 + §7.e）。
 *
 * 为什么落成断言：§5 的价值全在**逐值**（44px 日期列 / 190px 题集名 /
 * 13.5px 单行题干 / 11px 胶囊 / 展开区微沉底），改样式时不看设计稿就会
 * 悄悄漂移；规范 §〇5 要求「关键视觉规格必须落到断言」。scss 走
 * **sass 真编译**再断言（同本文件上文的口径），并逐条核「零字面色值」。
 */
const reviewCss = (): string => sass.compile("src/scss/review.scss").css.replace(/\/\*[\s\S]*?\*\//g, "");

/** 取一条规则体：`} `切段后按「选择器行」精确匹配（避免前缀撞车，如
 *  `.wengu-review-fchip` 命中 `.wengu-review-fchip:hover` / `.on`），
 *  并跳过 hover/focus 段取基态。 */
const ruleOf = (sel: string): string => {
    const segs = reviewCss().split("}");
    const seg = segs.find((r) => r.split("{")[0].trim() === sel && !r.includes(":hover") && !r.includes(":focus"));
    expect(seg, `未找到 ${sel} 规则`).toBeTruthy();
    return `${seg}}`;
};

describe("错题本单列可展开行（Issue #136 §5）", () => {
    it("两栏 grid 退役：.wengu-review-cols 与右侧常驻详情不再出现", () => {
        const css = reviewCss();
        expect(css).not.toContain(".wengu-review-cols");
        expect(css).not.toContain("grid-template-columns");
        // 清单改单列满宽内滚窗，且隐藏原生滚动条（§5.6，能力保留）
        const list = ruleOf(".wengu-review-list");
        expect(list).toMatch(/overflow-y:\s*auto/);
        expect(list).toMatch(/scrollbar-width:\s*none/);
        expect(css).toMatch(/\.wengu-review-list::-webkit-scrollbar/);
    });

    it("条目升卡片壳：border/radius-b/surface 底/overflow hidden", () => {
        const item = ruleOf(".wengu-review-item");
        expect(item).toMatch(/border:\s*1px solid var\(--b3-border-color\)/);
        expect(item).toMatch(/border-radius:\s*var\(--b3-border-radius-b\)/);
        expect(item).toMatch(/background:\s*var\(--b3-theme-surface\)/);
        expect(item).toMatch(/overflow:\s*hidden/);
        // 展开/选中态走主色 45% 描边（浅底+描边语言，禁 primary 实底）
        expect(ruleOf(".wengu-review-item.open,\n.wengu-review-item-cur")).toMatch(
            /border-color:\s*color-mix\(in srgb,\s*var\(--b3-theme-primary\) 45%,\s*transparent\)/
        );
    });

    it("行头五件套逐值：日期 44 / 题集名 190 / 题干 13.5·600·单行 / 错次胶囊", () => {
        const head = ruleOf(".wengu-review-rowhead");
        expect(head).toMatch(/display:\s*flex/);
        expect(head).toMatch(/gap:\s*14px/);
        expect(head).toMatch(/padding:\s*12px 18px/);
        expect(head).toMatch(/cursor:\s*pointer/);

        const date = ruleOf(".wengu-review-date");
        // 44px 是同年 MM-DD 的列宽；跨年 YYYY-MM-DD 略宽 ⇒ min-width 垫底
        // 宽容纳（不换行、不吃掉题集名）
        expect(date).toMatch(/min-width:\s*44px/);
        expect(date).toMatch(/white-space:\s*nowrap/);
        expect(date).toMatch(/font-size:\s*11px/);
        expect(date).toMatch(/font-variant-numeric:\s*tabular-nums/);

        const set = ruleOf(".wengu-review-set");
        expect(set).toMatch(/max-width:\s*190px/);
        expect(set).toMatch(/text-overflow:\s*ellipsis/);
        expect(set).toMatch(/white-space:\s*nowrap/);

        const stem = ruleOf(".wengu-review-item-stem");
        expect(stem).toMatch(/font-size:\s*13\.5px/);
        expect(stem).toMatch(/font-weight:\s*600/);
        expect(stem).toMatch(/white-space:\s*nowrap/);
        expect(stem).not.toMatch(/-webkit-line-clamp/); // 2 行 clamp 已退役

        const count = ruleOf(".wengu-review-count");
        expect(count).toMatch(/color:\s*var\(--b3-theme-error\)/);
        expect(count).toMatch(/border-radius:\s*999px/);
        expect(count).toMatch(/padding:\s*1px 9px/);
        expect(count).toMatch(/font-weight:\s*600/);
    });

    it("展开区：border-top + 14/22/18 + 微沉底；操作行右对齐 gap 10", () => {
        const open = ruleOf(".wengu-review-item-open");
        expect(open).toMatch(/border-top:\s*1px solid var\(--b3-border-color\)/);
        expect(open).toMatch(/padding:\s*14px 22px 18px/);
        expect(open).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--b3-theme-background\) 94%,\s*black\)/);
        const acts = ruleOf(".wengu-review-detail-actions");
        expect(acts).toMatch(/justify-content:\s*flex-end/);
        expect(acts).toMatch(/gap:\s*10px/);
        expect(acts).toMatch(/margin-top:\s*14px/);
    });

    it("筛选行：状态胶囊 on 态=浅底+主色 50% 描边+600；概况右移行尾", () => {
        const chip = ruleOf(".wengu-review-fchip");
        expect(chip).toMatch(/height:\s*28px/);
        expect(chip).toMatch(/padding:\s*0 14px/);
        expect(chip).toMatch(/border-radius:\s*999px/);
        expect(chip).toMatch(/font-size:\s*12\.5px/);
        const on = ruleOf(".wengu-review-fchip.on");
        expect(on).toMatch(/background:\s*var\(--b3-theme-primary-lightest\)/);
        expect(on).toMatch(/color:\s*var\(--b3-theme-primary\)/);
        expect(on).toMatch(/border-color:\s*color-mix\(in srgb,\s*var\(--b3-theme-primary\) 50%,\s*transparent\)/);
        expect(on).toMatch(/font-weight:\s*600/);
        expect(ruleOf(".wengu-review-summary")).toMatch(/margin-left:\s*auto/);
    });

    it("零字面色值（颜色只走令牌，唯一豁免是 94% 微沉底的 black 混合项）", () => {
        for (const body of [
            ruleOf(".wengu-review-item"),
            ruleOf(".wengu-review-date"),
            ruleOf(".wengu-review-set"),
            ruleOf(".wengu-review-item-stem"),
            ruleOf(".wengu-review-count"),
            ruleOf(".wengu-review-fchip.on"),
            ruleOf(".wengu-review-mini-star.on"),
        ]) {
            expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
        }
    });
});

/**
 * 按钮变体词表与「唯一主操作」的源级断言（Issue #120，规范
 * `docs/design-spec.md` §2.1 / §2.3）。
 *
 * 为什么是**源级**断言：`b3-button--main` 在思源样式表里**不存在**
 * （官方 `_button.scss` 无 `--main`），`variant="main"` 会静默产出零命中的
 * 死类——这类「写错也不报错、只是观感落空」的形态，只有扫源码拦得住
 * （同 `SubheadHtml.test.ts` 的 primary 唯一断言）。
 *
 * ⚠️ 源码经 vitest 的 `?raw` 导入（本仓无 `@types/node`，不用 `node:fs`）。
 */

const SRC = import.meta.glob("../**/*.{ts,svelte,scss}", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

/** glob key 相对**本测试文件**（`./Button.svelte` / `../ai/...`）——
 *  统一成「相对 src/」的展示名，便于断言里比对与报错可读。 */
const relOf = (k: string): string => k.replace(/^\.\.\//, "").replace(/^\.\//, "ui/");

const button = SRC["./Button.svelte"];

describe("按钮变体词表（规范 §2.1）", () => {
    it("ButtonVariant 统一为 primary，不再有自造的 main", () => {
        const m = /export type ButtonVariant = ([^;]+);/.exec(button);
        expect(m).not.toBeNull();
        const variants = m![1].match(/"[a-z]+"/g)?.map((v) => v.replace(/"/g, "")) ?? [];
        expect(variants).toContain("primary");
        expect(variants).not.toContain("main");
    });

    it("默认变体是最不可能违规的 outline（primary 必须显式声明）", () => {
        expect(button).toMatch(/variant = "outline",/);
    });

    it('源码里不再出现 variant="main"（死类 b3-button--main）', () => {
        const hits: string[] = [];
        for (const [k, src] of Object.entries(SRC)) {
            const rel = relOf(k);
            if (/\.test\.ts$/.test(rel)) continue;
            src.split("\n").forEach((line, i) => {
                // 注释里复述这个坑是允许的（Button.svelte 的头注），只扫代码
                if (/^\s*(\*|\/\*|\/\/)/.test(line)) return;
                if (/variant="main"/.test(line)) hits.push(`${rel}:${i + 1}`);
            });
        }
        expect(hits).toEqual([]);
    });
});

describe("AI 面板 kinds 过滤条：选中态不是主操作（规范 §2.3）", () => {
    it("选中态走 wengu-chip-on，不用 primary 实底", () => {
        const src = SRC["../ai/components/SessionPanelApp.svelte"];
        expect(src).toMatch(/wengu-chip-on/);
        // 不允许 `variant={…}` 这类**表达式**变体（它正是「按选中态切主操作」
        // 的形态）——剥注释后再查，头注复述这个坑是允许的。
        const code = src.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
        expect(code).not.toMatch(/variant=\{[^}]*\}/);
    });

    it("wengu-chip-on 样式在 rail.scss：浅底 + 主色字 + 主色描边，零字面色值", () => {
        // ⚠️ scss 走 sass **真编译**而非 `?raw` 导入：`?raw` 拿 scss 在本仓
        // vitest 下是空串（vitest 默认 css:false，CSS 类文件被替成空模块），
        // 且编译产物才是真落进页面的东西（同 StartPanelStyle.test.ts 口径）。
        // sass 的 compile 吃「项目根相对路径」（vitest 的 cwd 即仓库根），
        // 不引 node:url —— 本仓无 @types/node。
        // ⚠️ sass 的 compile 默认**保留 `/* */` 注释**，剥掉后再断言
        // （否则「⚠️ 类名带 wengu- 前缀」那段注释会把中文/字号带进来）。
        const css = sass.compile("src/scss/rail.scss").css.replace(/\/\*[\s\S]*?\*\//g, "");
        const block = css.split("}").find((r) => r.includes(".wengu-ai-kinds .wengu-chip-on") && !r.includes(":hover"));
        expect(block, "未找到 .wengu-ai-kinds .wengu-chip-on 规则").toBeTruthy();
        const body = `${block}}`;
        expect(body).toMatch(/background:\s*var\(--b3-theme-primary-lightest\)/);
        expect(body).toMatch(/color:\s*var\(--b3-theme-primary\)/);
        expect(body).toMatch(/border-color:\s*var\(--b3-theme-primary\)/);
        // 零字面色值（颜色只走令牌）
        expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    });
});
