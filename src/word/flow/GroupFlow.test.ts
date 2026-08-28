import { describe, expect, it } from "vitest";
import { groupBoundaryDue } from "./GroupFlow";

/** 组边界触发口径（20260829 修复回归锁）：fresh 轨 finishCount 只在
 *  毕业递增——旧裸取模判定（count % size === 0）在开局 0 与两次毕业
 *  之间的整数倍上每张卡都命中，把单卡画像逐张交 AI。 */
describe("groupBoundaryDue", () => {
    it("未计入的卡永不触发（fresh 非毕业卡）", () => {
        expect(groupBoundaryDue(false, 0, 10)).toBe(false);
        expect(groupBoundaryDue(false, 10, 10)).toBe(false);
    });

    it("计入且恰在组大小整数倍上触发", () => {
        expect(groupBoundaryDue(true, 10, 10)).toBe(true);
        expect(groupBoundaryDue(true, 20, 10)).toBe(true);
        expect(groupBoundaryDue(true, 30, 5)).toBe(true);
    });

    it("计入但不在整数倍上不触发", () => {
        expect(groupBoundaryDue(true, 1, 10)).toBe(false);
        expect(groupBoundaryDue(true, 9, 10)).toBe(false);
        expect(groupBoundaryDue(true, 11, 10)).toBe(false);
    });

    it("组大小中途改小：下一个整数倍照常补触发", () => {
        // 上次冲账在 10（size=10），改为 size=5 后毕业到 15 → 触发
        expect(groupBoundaryDue(true, 15, 5)).toBe(true);
        expect(groupBoundaryDue(true, 12, 5)).toBe(false);
    });
});
