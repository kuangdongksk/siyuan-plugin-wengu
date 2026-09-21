import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile } from "sass";

/**
 * 单题计时视觉规格红测试（Issue #182 R2/R4，设计稿 v6 `14c6f55`）。
 *
 * 口径同 `MaterialSplitterDesign.test.ts` / `StartPanelStyle.test.ts`：
 * scss 走 **sass 真编译**（`?raw` 读 scss 在 node 侧恒空串），断言
 * **规则在场与取值**，不钉分片内部排版；组件侧读 `?raw` 源级断言接线。
 *
 * 设计稿取值（`design/UI/单题计时/wengu-focus-timer-redesign.html`）：
 *   `--focus-dim: 0.22` / `--focus-ms: 150ms` / `--done-delay: 260ms` /
 *   `--done-ms: 320ms` / `--stream-w: 2px` / `--stream-halo: 5.5px` /
 *   一圈 `LAP = 60000`；流光几何 inset 0.5px + r 11.5px（卡圆角 12px 中心线）。
 */

const scss = (): string => {
    const raw = readFileSync(new URL("../../scss/focus-timer.scss", import.meta.url), "utf8");
    return compile(raw.replace(/@use\s+"[^"]+"[^;]*;/g, ""), { style: "expanded" }).css;
};

describe("R2 亮度分级（scss 真编译）", () => {
    it("非焦点卡 opacity 0.22、过渡 150ms linear（只有 opacity 一条）", () => {
        const css = scss();
        expect(css).toMatch(/opacity:\s*0?\.22\b/);
        expect(css).toMatch(/transition:\s*opacity\s+150ms\s+linear/);
    });

    it("焦点卡 opacity 1，且不写 hover 规则（悬停零视觉变化是硬口径）", () => {
        const css = scss();
        expect(css).toMatch(/\.wengu-card\.wengu-focus[\s\S]{0,120}opacity:\s*1\b/);
        expect(css).not.toMatch(/\.wengu-card:hover/);
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
        expect(css).toMatch(/\.wengu-gtx--done[\s\S]{0,160}transition:\s*opacity\s+320ms\s+linear\s+260ms/);
    });

    it("`prefers-reduced-motion` 三档归零（切换即时到位）", () => {
        const css = scss();
        expect(css).toContain("prefers-reduced-motion");
        expect(css).toMatch(/--wengu-focus-ms:\s*0ms/);
        expect(css).toMatch(/--wengu-done-delay:\s*0ms/);
        expect(css).toMatch(/--wengu-done-ms:\s*0ms/);
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
    it("QuizCard 标焦点态、出流光层与圈数/用时两处读数", () => {
        const src = readFileSync(new URL("../components/QuizCard/index.svelte", import.meta.url), "utf8");
        expect(src).toContain("wengu-focus");
        expect(src).toContain("wengu-gtx");
        expect(src).toContain("wengu-card-lap");
        expect(src).toContain("wengu-card-qtime");
    });

    it("流光驱动岛文件在场（FocusStream，含 dispose）", () => {
        const src = readFileSync(new URL("./FocusStream.ts", import.meta.url), "utf8");
        expect(src).toContain("dispose");
        expect(src).toContain("ResizeObserver");
        expect(src).toContain("60000");
    });
});
