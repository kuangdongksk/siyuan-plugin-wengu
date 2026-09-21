import { describe, expect, it } from "vitest";
import { QcAcc, qcOf, terminalOf, type TerminalFacts } from "../run/ConvertQc";
import type { ConvertQc } from "../run/ConvertBatchModel";

/**
 * 收口载荷的条件展开（Issue #184 验收 1 的机械口径）：**无存疑 / 未启用
 * 时 `qc` 键必须不存在**——`ConvertBatch` 的三条终态与 `ConvertRun` 的
 * 收尾事件都靠它保持既有结果形状逐字节不变。
 */

const t = (k: string): string => k;

describe("终态收口（terminalOf）：三条分支形状与质检载荷", () => {
    it("无存疑时三条分支都不给 `qc` 键；有存疑时都带上", () => {
        const facts = (over: Partial<TerminalFacts> = {}): TerminalFacts => ({
            aborted: false,
            firstError: "",
            noProducts: false,
            count: 2,
            setId: "set-1",
            title: "题集",
            cursor: 50,
            srcLen: 100,
            message: "msg",
            refusedMessage: "noq",
            ...over,
        });
        const empty = new QcAcc();
        const withHit = new QcAcc();
        withHit.checked = 3;
        withHit.suspects.push({ reason: "derive", clear: true, items: [] });

        // done
        expect("qc" in terminalOf(t, empty, facts(), 1, ["q1"])).toBe(false);
        expect(terminalOf(t, withHit, facts(), 1, ["q1"]).qc?.suspects.length).toBe(1);
        // terminated（aborted / failed 同一分支）
        expect("qc" in terminalOf(t, empty, facts({ aborted: true }), 1, ["q1"])).toBe(false);
        expect(terminalOf(t, empty, facts({ aborted: true }), 1, ["q1"]).status).toBe("aborted");
        expect(terminalOf(t, empty, facts({ firstError: "boom" }), 1, ["q1"]).status).toBe("failed");
        // 零产物：有题集=按完成收口、无题集=按失败
        expect(terminalOf(t, empty, facts({ noProducts: true }), 1, []).status).toBe("done");
        expect(terminalOf(t, empty, facts({ noProducts: true, setId: undefined }), 1, []).message).toBe("noq");
    });

    it("完成消息带质检尾巴（与 qcSummary 同源）", () => {
        const acc = new QcAcc();
        acc.checked = 2;
        acc.suspects.push({ reason: "quality", clear: false, items: [] });
        const r = terminalOf(
            t,
            acc,
            {
                aborted: false,
                firstError: "",
                noProducts: false,
                count: 2,
                setId: "s",
                title: "t",
                cursor: 1,
                srcLen: 9,
                message: "done",
                refusedMessage: "",
            },
            1,
            ["q1"]
        );
        expect(r.message).toContain("jevQcSuspect");
        expect(r.message.startsWith("done ｜ ")).toBe(true);
    });
});

describe("收尾载荷条件展开（qcOf）", () => {
    it("无存疑 → 空对象（展开后 `qc` 键不出现）", () => {
        expect(qcOf({})).toEqual({});
        expect("qc" in qcOf({})).toBe(false);
        expect("qc" in qcOf({ qc: undefined })).toBe(false);
    });

    it("有存疑 → 原样带出", () => {
        const qc: ConvertQc = { checked: 1, suspectBatches: 1, suspects: [] };
        expect(qcOf({ qc })).toEqual({ qc });
    });
});
