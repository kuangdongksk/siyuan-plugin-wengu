import { describe, expect, it } from "vitest";
import { compile } from "sass";
import { mustHave, read } from "../../testkit/readSource";

/**
 * 单题计时视觉规格红测试（Issue #182 R2/R4，设计稿 v6 `14c6f55`）。
 *
 * 口径同 `MaterialSplitterDesign.test.ts` / `StartPanelStyle.test.ts`：
 * scss 走 **sass 真编译**（`?raw` 读 scss 在 node 侧恒空串），断言
 * **规则在场与取值**，不钉分片内部排版；组件侧读源码原文做源级断言。
 *
 * ⚠️ 读源码走 `src/testkit/readSource.ts`（**相对仓根**的路径口径）。
 * 别再用 `import.meta.glob` 自行拼表（#189 实测）：`eager` 形态的键相对本文件、
 * 跨层同名会撞车，按 basename 查表还会**静默取错文件**；懒加载形态的键虽
 * 相对仓根，但取值有「裸字符串 / 模块壳」两形。详见该文件头注。
 *
 * 设计稿取值（`design/UI/单题计时/wengu-focus-timer-redesign.html`）：
 *   `--focus-dim: 0.22` / `--focus-ms: 150ms` / `--done-delay: 260ms` /
 *   `--done-ms: 320ms` / `--stream-w: 2px` / `--stream-halo: 5.5px` /
 *   一圈 `LAP = 60000`；流光几何 inset 0.5px + r 11.5px（卡圆角 12px 中心线）。
 */

/** scss 分片的真编译产物。
 *  ⚠️ **`.scss` 不进 `readSource` 的 glob**（`?raw` 对 scss 恒空串，声明只收
 *  `.ts` / `.svelte`）；分片在不在**由 `sass.compile` 自己说了算**——缺文件即
 *  抛错，不会静默变绿，故这里不需要（也不该）调 `mustHave`。 */
const scss = (): string => compile("src/scss/focus-timer.scss", { style: "expanded" }).css;

/** 组件/脚本源码（`src/` 下的路径口径）。 */
const src = (path: string): Promise<string> => {
    mustHave(path);
    return read(path);
};

describe("R2 亮度分级（scss 真编译）", () => {
    it("非焦点卡 opacity 0.22、过渡 150ms linear（只有 opacity 一条）", () => {
        const css = scss();
        expect(css).toMatch(/--wengu-focus-dim:\s*0?\.22/);
        expect(css).toMatch(/--wengu-focus-ms:\s*150ms/);
        expect(css).toMatch(/opacity:\s*var\(--wengu-focus-dim\)/);
        expect(css).toMatch(/transition:\s*opacity\s+var\(--wengu-focus-ms\)\s+linear/);
    });

    it("焦点卡 opacity 1，且不写 hover 规则（悬停零视觉变化是硬口径）", () => {
        const css = scss();
        expect(css).toMatch(/\.wengu-card\.wengu-focus[\s\S]{0,120}opacity:\s*1\b/);
        expect(css).not.toMatch(/\.wengu-card:hover/);
        expect(css).not.toMatch(/transition-prototype/);
    });
});

describe("R2/R4 流光与停格淡出（scss 真编译）", () => {
    it("流光主线/外晕/轨迹三色在场，线宽取自设计稿两档", () => {
        const css = scss();
        expect(css).toMatch(/--wengu-stream-w:\s*2px/);
        expect(css).toMatch(/--wengu-stream-halo:\s*5\.5px/);
        expect(css).toContain(".wengu-gtx-track");
        expect(css).toContain(".wengu-gtx-halo");
        expect(css).toContain(".wengu-gtx-head");
    });

    it("判分停格 260ms 后 320ms 淡出（.wengu-gtx--done）", () => {
        const css = scss();
        expect(css).toMatch(/--wengu-done-delay:\s*260ms/);
        expect(css).toMatch(/--wengu-done-ms:\s*320ms/);
        expect(css).toMatch(
            /\.wengu-gtx--done[\s\S]{0,200}transition:\s*opacity\s+var\(--wengu-done-ms\)\s+linear\s+var\(--wengu-done-delay\)/
        );
    });

    it("`prefers-reduced-motion` 三档归零（切换即时到位）", () => {
        const css = scss();
        expect(css).toContain("prefers-reduced-motion");
        const rm = css.slice(css.indexOf("prefers-reduced-motion"));
        expect(rm).toMatch(/--wengu-focus-ms:\s*0ms/);
        expect(rm).toMatch(/--wengu-done-delay:\s*0ms/);
        expect(rm).toMatch(/--wengu-done-ms:\s*0ms/);
    });

    it("圈数 chip 与冻结注记两档在场（`.c-lap` / `.c-time` 同族）", () => {
        const css = scss();
        expect(css).toContain(".wengu-card-lap");
        expect(css).toContain(".wengu-card-qtime");
    });

    it("流光层不吃指针事件、被卡内 content 覆盖时仍可见（z-index 分层在场）", () => {
        const css = scss();
        expect(css).toMatch(/\.wengu-gtx[\s\S]{0,160}pointer-events:\s*none/);
        expect(css).toMatch(/\.wengu-gtx[\s\S]{0,160}z-index:\s*2/);
    });
});

describe("R4 卡内接线（组件源级）", () => {
    it("QuizCard 标焦点态、接流光层与圈数/用时两处读数", async () => {
        const code = await src("/src/quiz/components/QuizCard/index.svelte");
        expect(code, "QuizCard 应仍是卡渲染组件").toContain("wengu-card");
        expect(code).toContain("wengu-focus");
        expect(code).toContain("streamFor("); // 流光层由岛建立（DOM 归 FocusStream）
        expect(code).toContain("wengu-card-lap");
        expect(code).toContain("wengu-card-qtime");
    });

    it("流光驱动岛文件在场（FocusStream，含 dispose）", async () => {
        const code = await src("/src/quiz/render/FocusStream.ts");
        expect(code).toContain("dispose");
        expect(code).toContain("ResizeObserver");
        expect(code).toContain("60000");
    });
});
