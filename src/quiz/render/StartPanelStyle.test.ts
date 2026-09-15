import { beforeAll, describe, expect, it } from "vitest";
import * as sass from "sass";
import { compile } from "svelte/compiler";

/**
 * 开刷面板的样式硬口径（Issue #100，**编译产物断言**）：照设计稿
 * `design/wengu-desktop-drill.html` 屏① 的规格不得漂移——卡片/卡头/行/
 * 动作行的关键尺寸与稿一致，且**颜色零硬编码**（全部走 b3 令牌，
 * 明暗主题自适应）。
 *
 * ⚠️ **整改 F1 #127 改造**：样式已按新规（design-spec §〇4）从独立分片
 * `src/scss/startpanel.scss` 迁入组件 `StartPanelApp.svelte` 的 `<style>`。
 * 本测试同步改为「**组件内 `<style>` 真编译**」口径，规格断言一条未减：
 *   1. 取组件源码里的 `<style>` 体，走 `sass.compileString`（sass 把
 *      `:global(...)` 原样透传，故归一化剥壳后可与原断言逐字对齐）；
 *   2. 另走 **Svelte 真编译**（`svelte/compiler`，仓库锁 5.56.10）拿 scoped
 *      产物的 `css_unused_selector` 警告面：迁入组件后 `.wengu-start*` 若被
 *      scoped 静默删条（子组件产物 / `{@html}` 注入的类名踩坑），这里必红
 *      ——这是「迁入即失配」类事故的静态闸门。
 * 走 sass/svelte 真编译而非读源码文本：`?raw` 导入 scss 在本仓 vitest 下
 * 拿到空串（vitest 默认 css:false，CSS 类文件被替成空模块），且编译产物
 * 才是真落进页面的东西。
 */

/** 组件源码（`?raw`，本仓无 @types/node，不引 node:fs）。 */
const SVELTE_SRC =
    (
        import.meta.glob("../components/StartPanelApp.svelte", {
            query: "?raw",
            import: "default",
            eager: true,
        }) as Record<string, string>
    )["../components/StartPanelApp.svelte"] ?? "";

/** 取出组件 `<style>` 体。 */
function styleBody(src: string): string {
    const m = /<style>([\s\S]*?)<\/style>/.exec(src);
    expect(m, "组件内未找到 <style> 块").not.toBeNull();
    return m![1];
}

/** 归一化：剥掉 `:global(` / 配对右括号，使断言可按原选择器形态书写。
 *  sass 透传 `:global(...)`，故只在已 sass 编译的产物上做这一步。 */
function deGlobal(css: string): string {
    let out = css;
    // 反复剥壳，兼容 `:global(a) > :global(b)` 与 `:global(a b)` 两种写法
    for (let i = 0; i < 4; i++) {
        const next = out.replace(/:global\(([^()]*)\)/g, "$1");
        if (next === out) break;
        out = next;
    }
    return out;
}

describe("StartPanelApp.svelte <style> · 开刷面板规格（Issue #100 / #127）", () => {
    /** 该组件 `<style>` 整篇都是开刷面板规则，仍按选择器过滤一次作保险。 */
    let rules: string[] = [];
    /** Svelte 真编译产出的 unused 选择器警告（迁入即失配的闸门）。 */
    let unused: string[] = [];

    beforeAll(() => {
        const css = sass.compileString(styleBody(SVELTE_SRC)).css;
        rules = deGlobal(css)
            .split("}")
            .map((r) => `${r}}`)
            .filter((r) => r.includes(".wengu-start"));
        expect(rules.length).toBeGreaterThan(3);

        const out = compile(SVELTE_SRC, { css: "injected", dev: false, filename: "StartPanelApp.svelte" });
        unused = out.warnings.filter((w) => w.code === "css_unused_selector").map((w) => String(w.message));
    });

    const joined = (): string => rules.join("\n");
    /** 取某选择器的规则体（第一条命中）。 */
    const bodyOf = (sel: string): string => {
        const hit = rules.find((r) => r.includes(sel));
        expect(hit, `未找到规则 ${sel}`).toBeTruthy();
        return hit;
    };

    it("迁入组件后 scoped 未静默删条（零 unused 选择器）", () => {
        // `.wengu-start*` 的每一条规则都必须命中——子组件产物/`{@html}` 注入的
        // 类名若忘了 `:global()`，scoped 会把整条规则删掉并在此报警。
        expect(unused.filter((m) => m.includes("wengu-start"))).toEqual([]);
    });

    it("样式已迁入组件：scss 分片不再注册（下划线新规：组件独占样式进组件）", () => {
        expect(SVELTE_SRC).toContain("<style>");
        // 迁入后 scoped 生效：至少一条规则带 svelte 哈希类（证明确实走了组件通道）
        const scoped = sass.compileString(styleBody(SVELTE_SRC)).css;
        const out = compile(SVELTE_SRC, { css: "external", dev: false, filename: "StartPanelApp.svelte" });
        expect(scoped.length).toBeGreaterThan(0);
        expect(out.css?.code ?? "").toMatch(/\.svelte-[a-z0-9]+/);
    });

    it("颜色零硬编码：不用字面色值，只走 b3 令牌与 color-mix", () => {
        const decls = joined()
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .split(";")
            .map((d) => d.slice(d.indexOf(":") + 1))
            .join(";");
        expect(decls.match(/#[0-9a-fA-F]{3,8}\b/g)).toBe(null);
        expect(decls.match(/\brgba?\(/g)).toBe(null);
        expect(decls.match(/\bhsla?\(/g)).toBe(null);
        // 关键令牌在场（卡片面/边框/大圆角/主色）
        expect(joined()).toContain("var(--b3-theme-surface)");
        expect(joined()).toContain("var(--b3-border-color)");
        expect(joined()).toContain("var(--b3-border-radius-b)");
        expect(joined()).toContain("var(--b3-theme-primary)");
    });

    it("容器照稿：760px 上限 + 居中 + 30px 顶留白 + 18px 卡间距", () => {
        const b = bodyOf(".wengu-start {");
        expect(b).toContain("max-width: 760px");
        expect(b).toContain("margin: 30px auto 0");
        expect(b).toContain("gap: 18px");
        expect(b).toContain("align-items: center");
    });

    it("卡片照稿：22px 26px 内衬 + 大圆角 + 轻阴影", () => {
        const b = bodyOf(".wengu-start-card {");
        expect(b).toContain("padding: 22px 26px");
        expect(b).toContain("var(--b3-border-radius-b)");
        expect(b).toContain("box-shadow");
    });

    it("卡头在卡内：15px / 600，图标主色着色", () => {
        const b = bodyOf(".wengu-start-cardhead");
        expect(b).toContain("font-size: 15px");
        expect(b).toContain("font-weight: 600");
        const icon = bodyOf(".wengu-start-cardicon");
        expect(icon).toContain("var(--b3-theme-primary)");
    });

    it("行排版照稿 .sr-t / .sr-d：13.5px 600 标题 + 12px 次要色描述", () => {
        expect(joined()).toContain("font-size: 13.5px");
        const desc = bodyOf(".b3-label__text");
        expect(desc).toContain("font-size: 12px");
        expect(desc).toContain("var(--b3-theme-on-surface-light)");
    });

    it("行分隔线：行带底边线、末行去掉", () => {
        expect(bodyOf(".wengu-formrow {")).toContain("border-bottom: 1px solid var(--b3-border-color)");
        expect(bodyOf(":last-of-type")).toContain("border-bottom: 0");
    });

    it("控件最小宽 300px（替换 fn__size200 的 200px）", () => {
        expect(bodyOf(".wengu-start-ctl")).toContain("min-width: 300px");
    });

    it("动作行照稿：居中 + gap 14px（§〇6 的显式例外）+ 钮 132px", () => {
        const b = bodyOf(".wengu-start-actions");
        expect(b).toContain("justify-content: center");
        expect(b).toContain("gap: 14px");
        expect(bodyOf(".wengu-start-act {")).toContain("min-width: 132px");
    });
});
