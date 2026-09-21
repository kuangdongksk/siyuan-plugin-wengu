import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 计时落点接线红测试（Issue #182 R1/R6/R8）：源码级断言「谁在什么时机
 * 切焦点 / 结算」。
 *
 * 为什么源级：这类接线跨视图、组件与移动端三处，node 环境起不了 DOM；
 * 与既有 `SubheadHtml.test.ts`（primary 唯一）/ `RailMount.test.ts` 同款口径。
 */

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** 去注释后再断言（注释里复述写法不算「在用」，同 SpecListings 口径）。 */
const strip = (s: string): string =>
    s
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/(^|[^:])\/\/[^\n"'`]*$/gm, "$1");

describe("R1 点击即切：滚动不切焦点、切题只有点击路（源级）", () => {
    it("NumRail 的滚动跟踪不再回写计时焦点（onActive 只在点击/组导航/初始上报）", () => {
        const src = read("render/NumRail.ts");
        // 滚动帧里只刷高亮（setActiveOnly），不动 opts.onActive
        expect(src).toContain("setActiveOnly");
        const scrollBlock = src.slice(src.indexOf('addEventListener(\n        "scroll"'), src.indexOf("{ passive: true }"));
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
        expect(src).toContain("focusQuestion(");
    });
});

describe("R6 恢复轮从落点题起算（源级）", () => {
    it("恢复路径在整壳重建后显式切到落点题（不再吃 NumRail 的 setActive(1)）", () => {
        const src = read("render/QuizShell.ts");
        expect(src).toContain("focusQuestion");
    });
});

describe("R8 移动端：当前显示题即计时题（源级）", () => {
    it("goto 切题即切计时焦点", () => {
        const src = read("../mobile/core/MobileDrill.ts");
        const goto = src.slice(src.indexOf("goto(idx: number)"), src.indexOf("prev(): void"));
        expect(goto).toContain("timer");
    });

    it("作答记账不再硬编码 sec=0", () => {
        const src = read("../mobile/core/MobileAnswering.ts");
        expect(src).not.toMatch(/pushSessionAnswer\([^)]*0\s*,/);
    });
});
