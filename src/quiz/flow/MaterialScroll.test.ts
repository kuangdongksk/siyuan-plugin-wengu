import { describe, expect, it } from "vitest";
import { fadeVisible, materialScrollCap } from "./MaterialScroll";

/**
 * 材料区限高内滚判定（Issue #87）：限高与渐隐的**唯一纯判定**，DOM 层
 * 只接结论。两条验收锁在这里：
 * - 验收 1/2：长材料限高、短材料**零改动**（不限高 ⇒ 无滚动条无渐隐）；
 * - 验收 2：渐隐**只有下方还有内容时才可见**（滚到底即消）。
 */

/** 造一个量算对象（JS 侧只读这三个/四个数）。 */
const box = (clientHeight: number, scrollHeight: number, scrollTop = 0) => ({
    clientHeight,
    scrollHeight,
    scrollTop,
});

describe("materialScrollCap：限高判据 = 内容是否真的溢出", () => {
    it("长材料溢出 ⇒ 限高（1）", () => {
        expect(materialScrollCap(box(360, 1200))).toBe(1);
    });

    it("短材料不溢出 ⇒ 不限高（0，逐字节同现状：无滚动条、自然展开）", () => {
        expect(materialScrollCap(box(600, 180))).toBe(0);
        expect(materialScrollCap(box(600, 600))).toBe(0);
    });

    it("亚像素差（1px 内）不漏判：正好等于限高时不挂滚动条", () => {
        expect(materialScrollCap(box(360, 360.6))).toBe(0);
        expect(materialScrollCap(box(360, 361.4))).toBe(1);
    });

    it("未量算（折叠态/未挂载：全 0）按不限高收口", () => {
        expect(materialScrollCap(box(0, 0))).toBe(0);
    });
});

describe("fadeVisible：渐隐只在「还能往下滚」时出现", () => {
    it("顶部溢出 ⇒ 可见", () => {
        expect(fadeVisible(box(360, 1200, 0))).toBe(true);
    });

    it("滚到中途 ⇒ 仍可见", () => {
        expect(fadeVisible(box(360, 1200, 400))).toBe(true);
    });

    it("滚到底 ⇒ 隐藏（内容已尽，提示不该再留着）", () => {
        expect(fadeVisible(box(360, 1200, 840))).toBe(false);
    });

    it("内容不足一屏（未限高/短材料）⇒ 隐藏", () => {
        expect(fadeVisible(box(600, 180, 0))).toBe(false);
    });

    it("亚像素差（1px 内）算到底", () => {
        expect(fadeVisible(box(360, 720.4, 360))).toBe(false);
    });
});
