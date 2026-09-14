import { describe, expect, it } from "vitest";
import { flowOwnershipOf, ownershipTextOf } from "./FlowOwnership";
import type { AiSessionRecord } from "../data/AiSessions";

/** 造一条记录（只填判定用到的字段）。 */
function rec(kind: string, status: AiSessionRecord["status"] = "running"): AiSessionRecord {
    return { id: "s1", kind, title: "t", model: "m", createdAt: 0, status, turns: [] };
}

const t = (k: string): string => k; // 取词替身：断言键而非译文

/**
 * 记录级停止钮退役的口径锁定（Issue #77 回归测试 2）：**kind × 状态矩阵**
 * ——多调用流（转换族 + 六批流）在 running 下出归属说明；单调用流一律
 * 无停止 UI；done/error 无说明（没有在跑的东西可停）。
 */
describe("记录详情的流归属说明（停止钮白名单）", () => {
    it("转换族 running：出通用归属说明（指向上方横幅）", () => {
        for (const k of ["convert", "detect"]) {
            const own = flowOwnershipOf(rec(k));
            expect(own.kind).toBe("convert");
            expect(ownershipTextOf(t, own)).toBe("convertStoppedHint");
        }
    });

    it("六批流 running：出带流名的归属说明", () => {
        expect(flowOwnershipOf(rec("route"))).toEqual({ kind: "batch", flowKey: "aiFlowTitleMatch" });
        expect(flowOwnershipOf(rec("tag"))).toEqual({ kind: "batch", flowKey: "aiFlowTitleTag" });
        expect(flowOwnershipOf(rec("regen"))).toEqual({ kind: "batch", flowKey: "aiFlowTitleRegen" });
        expect(flowOwnershipOf(rec("outline"))).toEqual({ kind: "batch", flowKey: "aiFlowTitleOutline" });
        expect(ownershipTextOf(t, flowOwnershipOf(rec("tag")))).toBe("aiFlowOwningBatch");
    });

    it("单调用流 running：**不出任何停止 UI**（无说明行）", () => {
        for (const k of ["judge", "word", "ask", "analyze", ""]) {
            expect(flowOwnershipOf(rec(k))).toEqual({ kind: "none" });
            expect(ownershipTextOf(t, flowOwnershipOf(rec(k)))).toBe("");
        }
    });

    it("done/error：无说明（没在跑的东西可停）", () => {
        expect(flowOwnershipOf(rec("convert", "done"))).toEqual({ kind: "none" });
        expect(flowOwnershipOf(rec("route", "error"))).toEqual({ kind: "none" });
        expect(flowOwnershipOf(undefined)).toEqual({ kind: "none" });
    });
});
