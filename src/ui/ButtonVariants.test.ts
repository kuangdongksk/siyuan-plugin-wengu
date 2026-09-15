import { describe, expect, it } from "vitest";
import * as sass from "sass";

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
