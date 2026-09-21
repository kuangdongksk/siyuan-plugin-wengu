import { describe, expect, it } from "vitest";

/**
 * 计时落点接线红测试（Issue #182 R1/R6/R8）：源码级断言「谁在什么时机
 * 切焦点 / 结算」。
 *
 * 为什么源级：这类接线跨视图、组件与移动端三处，node 环境起不了 DOM；
 * 与既有 `SubheadHtml.test.ts`（primary 唯一）/ `RailMount.test.ts` 同款口径。
 */

/** 源码原文经 vitest 的 `?raw` 导入（本仓无 `@types/node`，不用 `node:fs`；
 * 口径同 `SubheadHtml.test.ts` / `RailMount.test.ts`）。
 *
 * 路径表用 glob **相对本文件的 key**（如 `../render/NumRail.ts`）：测试里传的
 * `render/NumRail.ts` 已是「相对 `src/quiz/`」，而 `import.meta.url` 在
 * `src/quiz/render/` 下 —— 直接用 `new URL(p, import.meta.url)` 会多降一级、
 * 指到不存在的 `src/quiz/render/render/NumRail.ts`（#189 首轮即踩此坑）。
 * 故以**文件名**为键查表，与文件所在目录无关 —— 代价见下方 `read` 头注：
 * 跨层同名文件会撞车，故 glob 按目录层级拆开、各层只收本层文件。 */
const RAW = Object.assign(
    {},
    import.meta.glob("./**/*.{ts,svelte}", { query: "?raw", import: "default", eager: true }),
    import.meta.glob("../*.{ts,svelte}", { query: "?raw", import: "default", eager: true }),
    import.meta.glob("../*/*.{ts,svelte}", { query: "?raw", import: "default", eager: true }),
    import.meta.glob("../../*/*/*.{ts,svelte}", { query: "?raw", import: "default", eager: true })
) as Record<string, unknown>;

/** 取源码原文。⚠️ 两层坑（#189 实测）：
 *   ① glob key 是**相对本文件**解析后的路径，glob 模式「两级通配」会同时命中
 *      `src/quiz/index.ts` 与 `src/quiz/render/NumRail.ts` —— 两个不同文件、
 *      同一个 basename，按 basename 查表会**撞车取错文件**（首轮实测
 *      `read("index.ts")` 取到了 `render` 目录外的那个文件）。故上方按
 *      目录层级分开 glob，各层只收本层文件，避免跨层撞名。
 * 取不到一律回落空串（不是 throw）：正向断言自然红，反向断言不静默绿。 */
const read = (p: string): string => {
    const name = p.slice(p.lastIndexOf("/") + 1);
    const hit = Object.entries(RAW).find(([k]) => k.endsWith(`/${name}`));
    return hit ? String(hit[1]) : "";
};

describe("R1 点击即切：滚动不切焦点、切题只有点击路（源级）", () => {
    it("NumRail 的滚动跟踪不再回写计时焦点（onActive 只在点击/组导航/初始上报）", () => {
        const src = read("render/NumRail.ts");
        // 滚动帧里只刷高亮（setActiveOnly），不动 opts.onActive
        expect(src).toContain("setActiveOnly");
        const scrollBlock = src.slice(
            src.indexOf('addEventListener(\n        "scroll"'),
            src.indexOf("{ passive: true }")
        );
        expect(scrollBlock).not.toContain("opts.onActive");
    });

    it("挂载首帧不给视图上报当前题（R6：避免误记第 1 题）；增量重绘也不上报", () => {
        const src = read("render/NumRail.ts");
        expect(src).not.toMatch(/onActive\(1\)/);
        expect(src).not.toContain("opts.onActive?.(n - 1)");
    });

    it("视图切焦点只从题号/组导航的点击路进入 newQuestionFor", () => {
        const src = read("index.ts");
        expect(src).toContain("newQuestionFor");
        expect(src).toContain("newQuestionFor(");
    });
});

describe("R6 恢复轮从落点题起算（源级）", () => {
    it("恢复路径在整壳重建后显式切到落点题（不再吃 NumRail 的 setActive(1)）", () => {
        const src = read("render/QuizShell.ts");
        expect(src).toContain("focusQuestion");
    });
});

describe("R8 移动端：当前显示题即计时题（源级）", () => {
    it("goto 切题即切计时焦点（R8）", () => {
        const src = read("../mobile/core/MobileDrill.ts");
        const goto = src.slice(src.indexOf("goto(idx: number)"), src.indexOf("prev(): void"));
        expect(goto).toContain("qTimer.focus(");
    });

    it("开轮/停轮同步单题计时的可见性闸（R5/R8）", () => {
        const src = read("../mobile/core/MobileDrill.ts");
        expect(src).toMatch(/startTicker\(\)[\s\S]{0,400}qTimer\.setRun\(true\)/);
        expect(src).toMatch(/stopTicker\(\)[\s\S]{0,400}qTimer\.setRun\(false\)/);
    });

    it("作答记账不再硬编码 sec=0", () => {
        const src = read("../mobile/core/MobileAnswering.ts");
        expect(src).not.toMatch(/pushSessionAnswer\([^)]*0\s*,/);
    });
});
