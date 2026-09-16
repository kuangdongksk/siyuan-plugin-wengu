import { beforeAll, describe, expect, it } from "vitest";
import * as sass from "sass";
import { compile } from "svelte/compiler";

/**
 * 背单词双端界面美化的样式硬口径（Issue #153，**编译产物断言**）：
 * 照设计稿 `design/wengu-word-redesign.html` 双端逐屏规格不得漂移。
 *
 * 覆盖两条口径：
 *   1. **色值零硬编码**——稿内 Neo+ hex 只是静态兜底，落地全走 `var(--b3-*)`
 *      运行时令牌（明暗自适应），新规则不许出现裸 hex / rgba / hsl 字面色值
 *      （阴影的纯黑低透明复用请走组件内既有写法与 `color-mix`）；
 *   2. **关键尺寸与令牌**——卡片大圆角、选项行/序号徽标、四点梯、三档自评、
 *      移动端触控尺寸逐值锁死。
 *
 * ⚠️ 双通道读取（design-spec §13.2.4）：组件独占样式在组件 `<style>`（走
 * 运行时注入，不落 `dist/index.css`），跨组件共享样式在 scss 分片 —— 两侧
 * 都走**真编译**（sass / svelte/compiler），编译产物才是真落进页面的东西。
 */

const raw = import.meta.glob("./**/*.svelte", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
>;

/** 取组件源码（本仓无 @types/node，不引 node:fs）。 */
function srcOf(key: string): string {
    const hit = raw[`./${key}`];
    expect(hit, `未读到组件源码 ${key}`).toBeTruthy();
    return hit!;
}

/** 取出组件 `<style>` 体。 */
function styleBody(src: string): string {
    const m = /<style(?: lang="scss")?>([\s\S]*?)<\/style>/.exec(src);
    expect(m, "组件内未找到 <style> 块").not.toBeNull();
    return m![1];
}

/** 归一化：剥掉 `:global(` / 配对右括号，使断言可按原选择器形态书写。 */
function deGlobal(css: string): string {
    let out = css;
    for (let i = 0; i < 4; i++) {
        const next = out.replace(/:global\(([^()]*)\)/g, "$1");
        if (next === out) break;
        out = next;
    }
    return out;
}

/** 规则体：把编译产物切成「选择器 { 声明 }」并按选择器过滤。 */
function rulesOf(css: string, must: string): string[] {
    return deGlobal(css)
        .replace(/@charset[^;]+;/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("}")
        .map((r) => `${r}}`)
        .filter((r) => r.includes(must));
}

/** scss 分片编译产物（分片路径相对本文件：`../scss/<name>.scss`）。 */
function compileScss(name: string, must = ".wengu-word"): { css: string; rules: string[] } {
    const css = sass.compile(`src/scss/${name}.scss`).css;
    return { css, rules: rulesOf(css, must) };
}

/** 断「整篇无裸字面色值」。 */
function expectNoLiteralColor(css: string): void {
    const decls = css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(";")
        .filter((d) => d.includes(":"))
        .map((d) => d.slice(d.indexOf(":") + 1))
        .join(";");
    expect(decls.match(/#[0-9a-fA-F]{3,8}\b/g)).toBe(null);
    expect(decls.match(/\bhsla?\(/g)).toBe(null);
    // 阴影的低透明黑是规范许可的既有形态，不得被用来做语义色
    expect((decls.match(/\brgba\(([^)]*)\)/g) ?? []).filter((c) => !/rgba\(\s*0\s*,\s*0\s*,\s*0/.test(c))).toEqual([]);
}

const FRAGMENTS = ["words", "words-detail", "words-home", "words-mobile"];

describe("Issue #153 · 双端界面美化规格", () => {
    let shell = "";
    let detail = "";
    let home = "";
    let mobile = "";
    let mobileRules: string[] = [];

    beforeAll(() => {
        const s = compileScss("words");
        shell = s.css;
        detail = compileScss("words-detail").css;
        home = compileScss("words-home").css;
        mobile = compileScss("words-mobile").css;
        mobileRules = compileScss("words-mobile", ".wengu-mobile").rules;
        expect(FRAGMENTS.map((f) => compileScss(f).css.length).every((n) => n > 100)).toBe(true);
    });

    it("色值零硬编码：四个分片无裸 hex / hsl / 非透明黑 rgba", () => {
        for (const f of FRAGMENTS) expectNoLiteralColor(compileScss(f).css);
    });

    it("色值零硬编码：三个组件内 <style> 同样无字面色值", () => {
        for (const k of ["components/HomeScreen.svelte", "components/DoneScreen.svelte"]) {
            const src = srcOf(k);
            const css = sass.compileString(styleBody(src)).css;
            expectNoLiteralColor(css);
            expect(css.length).toBeGreaterThan(200);
        }
        expect(srcOf("components/QuizCard.svelte")).toBeTruthy();
    });

    it("迁入组件的样式被 scoped 真编译：零 unused 选择器（防静默删条）", () => {
        for (const k of ["components/HomeScreen.svelte", "components/DoneScreen.svelte"]) {
            const out = compile(srcOf(k), { css: "injected", dev: false, filename: k });
            const unused = out.warnings.filter((w) => w.code === "css_unused_selector").map((w) => String(w.message));
            expect(unused.filter((m) => m.includes("wengu-word"))).toEqual([]);
            expect(styleBody(srcOf(k)).length).toBeGreaterThan(200);
        }
    });

    it("卡面与入口卡走大圆角令牌 + 阴影（稿①③ 的 12px 卡）", () => {
        expect(shell).toContain("var(--b3-border-radius-b)");
        const card = rulesOf(shell, ".wengu-word-card").find((r) => r.trim().startsWith(".wengu-word-card"));
        expect(card).toBeTruthy();
        expect(card!).toContain("var(--b3-border-radius-b)");
        expect(card!).toContain("box-shadow");
    });

    it("选项行：整行 ≥44px、序号圆徽标 22px、三态走 theme 系语义色", () => {
        const opt = rulesOf(shell, ".wengu-word-opt").find((r) => /\.wengu-word-opt \{/.test(r)) ?? "";
        expect(opt).toContain("min-height: 44px");
        expect(shell).toContain(".wengu-word-optkey");
        const key = rulesOf(shell, ".wengu-word-optkey").find((r) => /(^|\})\s*\.wengu-word-optkey \{/.test(r)) ?? "";
        expect(key, "未找到 .wengu-word-optkey 基础规则").not.toBe("");
        expect(key).toMatch(/width: 22px/);
        expect(key).toMatch(/border-radius: 50%/);
        for (const state of ["is-correct", "is-wrong"]) expect(detail).toContain(`.wengu-word-opt.${state}`);
        expect(detail).toContain("var(--b3-theme-success)");
        expect(detail).toContain("var(--b3-theme-error)");
        expect(detail).toContain("color-mix(in srgb");
    });

    it("四点梯：等圆 + 当前步拉长成主色胶囊（稿③⑤⑥）", () => {
        const cur = rulesOf(detail, ".wengu-word-ladder i.is-cur").find((r) => r.includes("is-cur")) ?? "";
        expect(cur).toMatch(/width: 16px/);
        expect(cur).toContain("var(--b3-theme-primary)");
        const dot = rulesOf(detail, ".wengu-word-ladder i ").find((r) => /ladder i \{/.test(r)) ?? "";
        expect(dot).toMatch(/border-radius: 999px/);
        expect(dot).toContain("background: transparent");
        expect(detail).toMatch(/\.wengu-word-ladder i\.is-done \{[^}]*var\(--b3-theme-success\)/);
    });

    it("自评三档：绿 / 黄（卡片警示族）/ 红 三色描边 + 同色软底", () => {
        expect(shell).toContain(".wengu-word-grades .b3-button:nth-child(1)");
        expect(shell).toContain(".wengu-word-grades .b3-button:nth-child(3)");
        const grade = rulesOf(shell, ".wengu-word-grades .b3-button:nth-child(2)")[0] ?? "";
        // warning 档只有卡片族、没有 theme 族（规范 §1.2 的悬空令牌反面教材）
        expect(grade).toContain("var(--b3-card-warning-color)");
        expect(shell).not.toContain("--b3-theme-warning");
    });

    it("听音大喇叭与卡底进度条：主色软底大圆 + 细胶囊进度条", () => {
        expect(detail).toMatch(/\.wengu-word-say \{[^}]*width: 84px/);
        expect(detail).toContain("var(--b3-theme-primary-lightest)");
        expect(detail).toContain("border-radius: 999px");
    });

    it("移动端：入口卡 ≥88px / 选项行 ≥52px / 序号 32px / 进度条 8px / 大喇叭 96px", () => {
        const entry = mobileRules.find((r) => /\.wengu-word-entry \{/.test(r)) ?? "";
        expect(entry).toContain("min-height: 88px");
        const opt = mobileRules.find((r) => /\.wengu-word-opt \{/.test(r)) ?? "";
        expect(opt).toContain("min-height: 52px");
        const key = mobileRules.find((r) => /\.wengu-word-optkey \{/.test(r)) ?? "";
        expect(key).toMatch(/width: 32px/);
        const bar = mobileRules.find((r) => /b3-progress__bar \{/.test(r)) ?? "";
        expect(bar).toMatch(/height: 8px/);
        const speaker = mobileRules.find((r) => /wengu-word-say \{/.test(r)) ?? "";
        expect(speaker).toMatch(/width: 96px/);
    });

    it("移动端零 media query + 全部规则挂 .wengu-mobile 后代（无标记即不生效）", () => {
        expect(mobile).not.toMatch(/@media/);
        const selectors = deGlobal(mobile)
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .match(/[^{}]+\{/g)!
            .map((r) => r.slice(0, -1).trim())
            .filter((r) => r.startsWith(".") || r.startsWith(":"));
        expect(selectors.length).toBeGreaterThan(20);
        expect(selectors.filter((s) => !s.includes(".wengu-mobile"))).toEqual([]);
    });

    it("查词结果行：状态标签四态（未学灰 / 复习中主色 / 熟绿 / 太简单删除线）", () => {
        expect(home).toContain(".wengu-tag");
        expect(home).toContain(".wengu-tag.is-review");
        expect(home).toContain(".wengu-tag.is-known");
        expect(home).toMatch(/\.wengu-tag\.is-easy \{[^}]*line-through/);
    });

    it("统计页：六格网格 + tabular-nums + 今天柱主色高亮", () => {
        expect(home).toMatch(/\.wengu-stats-row \{[^}]*grid-template-columns: repeat\(3, 1fr\)/);
        expect(home).toMatch(/\.wengu-stats-num \{[^}]*font-variant-numeric: tabular-nums/);
        expect(home).toMatch(/\.wengu-stats-bar-today \.wengu-stats-bar-col \{[^}]*var\(--b3-theme-primary\)/);
    });
});
