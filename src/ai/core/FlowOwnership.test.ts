import { describe, expect, it } from "vitest";
import { decideEntryOf, flowOwnershipOf, ownershipTextOf } from "./FlowOwnership";
import type { AiSessionRecord } from "../data/AiSessions";
import { AI_STOPPED } from "../data/AiSessions";

/** 造一条记录（只填判定用到的字段）。 */
function rec(kind: string, status: AiSessionRecord["status"] = "running", error?: string): AiSessionRecord {
    return { id: "s1", kind, title: "t", model: "m", createdAt: 0, status, turns: [], ...(error ? { error } : {}) };
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
        expect(flowOwnershipOf(rec("route", "error", "超时"))).toEqual({ kind: "none" });
        expect(flowOwnershipOf(undefined)).toEqual({ kind: "none" });
    });

    /**
     * 被停止的记录（Issue #88）：设计稿 ai-panel-stopped 屏的 own-note 不是
     * 「去哪停」而是「已随整批停下、抉择在哪」——两态文案必须分开，否则用户
     * 已经停了还在被指路「请去停止」。
     */
    it("被停止（error + AI_STOPPED 哨兵）：出停止后的归属说明，且与在途文案不同", () => {
        const conv = flowOwnershipOf(rec("convert", "error", AI_STOPPED));
        expect(conv).toEqual({ kind: "stoppedConvert" });
        expect(ownershipTextOf(t, conv)).toBe("aiOwnStoppedConvert");
        expect(ownershipTextOf(t, conv)).not.toBe(ownershipTextOf(t, flowOwnershipOf(rec("convert"))));
        const batch = flowOwnershipOf(rec("tag", "error", AI_STOPPED));
        expect(batch).toEqual({ kind: "stoppedBatch", flowKey: "aiFlowTitleTag" });
        expect(ownershipTextOf(t, batch)).toBe("aiOwnStoppedBatch");
    });

    it("抉择入口只属转换族（六批流停下即停下，没有保留/丢弃二选一）", () => {
        expect(decideEntryOf(flowOwnershipOf(rec("convert", "error", AI_STOPPED)))).toBe(true);
        expect(decideEntryOf(flowOwnershipOf(rec("detect", "error", AI_STOPPED)))).toBe(true);
        expect(decideEntryOf(flowOwnershipOf(rec("tag", "error", AI_STOPPED)))).toBe(false);
        expect(decideEntryOf({ kind: "none" })).toBe(false);
        // 在途态也不出（在途的归属备注是「去哪停」，不是「去哪抉择」）
        expect(decideEntryOf(flowOwnershipOf(rec("convert")))).toBe(false);
    });

    it("哨兵只对多调用流白名单出说明；单调用流被中止仍当作普通收口（无说明）", () => {
        expect(flowOwnershipOf(rec("judge", "error", AI_STOPPED))).toEqual({ kind: "none" });
        expect(flowOwnershipOf(rec("word", "error", AI_STOPPED))).toEqual({ kind: "none" });
    });
});
