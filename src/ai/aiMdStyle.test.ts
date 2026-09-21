import { describe, expect, it } from "vitest";
import * as sass from "sass";

/**
 * AI 输出区 markdown 基线（Issue #177，**sass 真编译断言**）。
 *
 * 背景：`runAgentTextOrPanel` 的输出自本单起经 `ui/MdRender` 渲染成块级
 * HTML（列表/粗体/段落），基线样式落在共享片 `src/scss/ai-md.scss`。
 * 为什么是共享片而不是组件 `<style>`：两个消费方（轮次报告
 * `RoundReportApp.svelte`、统计面板 `StatsDoc.svelte`）**共用同一类名**
 * `.wengu-report-ai` ⇒ design-spec §13.1② 判给共享片并要求登记（§13.3）。
 *
 * ⚠️ scss 必须走 `sass.compile(路径)` 真编译：`?raw` 导入 scss 在本仓
 * vitest 下恒为空串（同 `ui/ButtonVariants.test.ts` / `ui/SpecListings.test.ts`
 * 注释），读源码文本这条路对本仓的 scss 是死路。
 */
const css = (): string =>
    sass
        .compile("src/scss/ai-md.scss")
        .css.replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/@charset[^;]+;/g, "");

/** 取一条规则体（按选择器行精确匹配，跳过 hover/focus 段）。 */
const ruleOf = (sel: string): string => {
    const segs = css().split("}");
    const seg = segs.find((r) => r.split("{")[0].trim() === sel && !r.includes(":hover") && !r.includes(":focus"));
    expect(seg, `未找到 ${sel} 规则`).toBeTruthy();
    return `${seg}}`;
};

describe("ai-md.scss · AI 输出区 markdown 基线（Issue #177）", () => {
    it("四项必需基线：段距 / 列表缩进 / 列表项间距 / 粗体字重", () => {
        expect(ruleOf(".wengu-report-ai :where(.p)")).toMatch(/margin:\s*4px 0/);
        expect(ruleOf(".wengu-report-ai :where(ul, ol)")).toMatch(/padding-left:\s*1\.6em/);
        expect(ruleOf(".wengu-report-ai :where(li)")).toMatch(/margin:\s*2px 0/);
        expect(ruleOf(".wengu-report-ai :where(strong)")).toMatch(/font-weight:\s*600/);
    });

    it("规则全部挂在容器类下，且一律 `:where()` 降权（不靠特异性压别的域）", () => {
        const rules = css()
            .split("}")
            .filter((r) => r.includes("{"));
        expect(rules.length).toBeGreaterThan(8);
        for (const r of rules) {
            const sel = r.split("{")[0].trim();
            expect(sel.startsWith(".wengu-report-ai :where(")).toBe(true);
        }
        // 裸标签选择器一个都不许有（防越域污染）
        expect(css()).not.toMatch(/^\s*(ul|ol|li|p|strong|table|pre|code)\s*\{/m);
    });

    it("颜色只走 b3 官方令牌（零字面色值，design-spec §1）", () => {
        const out = css();
        expect(out.match(/#[0-9a-fA-F]{3,8}\b/g)).toBe(null);
        expect(out.match(/\brgba?\(/g)).toBe(null);
        expect(out.match(/\bhsla?\(/g)).toBe(null);
        expect(out).toContain("var(--b3-border-color)");
        expect(out).toContain("var(--b3-font-family-code)");
        expect(out).toContain("var(--b3-theme-surface)");
    });

    it("分片已注册进 index.scss（不注册＝整片静默不落 dist/index.css）", () => {
        // index.scss 是 @use 清单，被 sass 编译进来即可证：以 index 为根编译，
        // 产物里出现本片的选择器即说明注册链通
        const root = sass.compile("src/index.scss").css;
        expect(root).toContain(".wengu-report-ai :where(.p)");
        expect(root).toContain(".wengu-report-ai :where(ul, ol)");
    });

    it("容器不再 pre-wrap：渲染产物的换行不会被双倍撑开", () => {
        // 容器本体规则在兄弟片 report.scss
        const report = sass.compile("src/scss/report.scss").css.replace(/\/\*[\s\S]*?\*\//g, "");
        const seg = report.split("}").find((r) => r.split("{")[0].trim() === ".wengu-report-ai") ?? "";
        expect(seg, "未找到 .wengu-report-ai 容器规则").toBeTruthy();
        expect(seg).not.toContain("pre-wrap");
        expect(seg).toContain("border-left");
        // 本片里同样不许冒出 pre-wrap
        expect(css()).not.toContain("pre-wrap");
    });
});
