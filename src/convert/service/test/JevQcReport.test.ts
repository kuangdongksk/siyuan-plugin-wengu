import { describe, expect, it } from "vitest";
import { jevQcLines } from "../../ui/JevQcReport";
import { qcSummary } from "../../../ai/jev/convertChecks";
import type { ConvertQc } from "../run/ConvertBatch";

/**
 * 报告标注（Issue #184 需求 3）：`qc` 缺键/无存疑时**一个字符都不给**
 * （转换条文案逐字不变），有存疑时给出「哪一项存疑 + 一句原因」。
 */

const t = (k: string): string => k;

const qc = (suspects: ConvertQc["suspects"]): ConvertQc => ({ checked: 3, suspectBatches: 1, suspects });

describe("Jev 质检报告行", () => {
    it("无 qc / 无存疑 → 空串（调用方零追加）", () => {
        expect(jevQcLines(t, undefined)).toBe("");
        expect(jevQcLines(t, qc([]))).toBe("");
    });

    it("有存疑 → 带「哪一项 + 一句原因」的逐行标注", () => {
        const s = jevQcLines(t, qc([{ reason: "derive", clear: true, items: [] }]));
        expect(s).toContain("jevQcSuspect");
        expect(s).toContain("jevQcClear"); // 明确踩雷的措辞
        expect(s).toContain("jevQcDerive"); // 具体是哪一项
        expect(s).toContain("3"); // 已判定题数
    });

    it("低置信用「拿不准」措辞（与明确踩雷分开）", () => {
        const s = jevQcLines(t, qc([{ reason: "quality", clear: false, items: [] }]));
        expect(s).toContain("jevQcUnsure");
        expect(s).not.toContain("jevQcClear");
    });

    it("与完成消息尾巴同源（qcSummary 的「有一项」与报告行说的是同一件事）", () => {
        const suspects: ConvertQc["suspects"] = [{ reason: "unique", clear: true, items: [] }];
        expect(qcSummary(t, { checked: 3, suspects })).toContain("jevQcSuspect");
        expect(jevQcLines(t, qc(suspects))).toContain("jevQcSuspect");
    });
});
