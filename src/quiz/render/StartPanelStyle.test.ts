import { beforeAll, describe, expect, it } from "vitest";
import * as sass from "sass";

/**
 * 开刷面板的样式硬口径（Issue #100，**编译产物断言**）：照设计稿
 * `design/wengu-desktop-drill.html` 屏① 的规格不得漂移——卡片/卡头/行/
 * 动作行的关键尺寸与稿一致，且**颜色零硬编码**（全部走 b3 令牌，
 * 明暗主题自适应）。样式单测不进浏览器（真机布局仍是人工抽查），
 * 故只锁可静态核对的部分：写死在 scss 里的数值与字面色值。
 * 走 sass 真编译而非读源码文本——`?raw` 导入 scss 在本仓 vitest 下
 * 拿到空串（vitest 默认 css:false，CSS 类文件被替成空模块），且编译
 * 产物才是真落进页面的东西。编译走**项目根相对路径**（vitest 的 cwd
 * 即仓库根）——不引 node:url / import.meta.url：本仓无 @types/node，
 * 路径还得是 string（sass 的 compile 签名不吃 URL）。
 */
describe("startpanel.scss · 开刷面板规格（Issue #100）", () => {
    /** 该片整篇都是开刷面板（拆片后无外域规则），仍按选择器过滤一次
     *  作保险：断言只针对 .wengu-start 族，别片混入也不影响。 */
    let rules: string[] = [];

    beforeAll(() => {
        const css = sass.compile("src/scss/startpanel.scss").css;
        rules = css
            .split("}")
            .map((r) => `${r}}`)
            .filter((r) => r.includes(".wengu-start"));
        expect(rules.length).toBeGreaterThan(3);
    });

    const joined = (): string => rules.join("\n");
    /** 取某选择器的规则体（第一条命中）。 */
    const bodyOf = (sel: string): string => {
        const hit = rules.find((r) => r.includes(sel));
        expect(hit, `未找到规则 ${sel}`).toBeTruthy();
        return hit;
    };

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
