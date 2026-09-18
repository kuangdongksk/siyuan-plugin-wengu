import { describe, expect, it } from "vitest";
import { byBaseQid, buildAnalysisPrompt, TIME_UNKNOWN_TEXT } from "./judge";
import type { WenguQuestion } from "../../types";
import type { WenguSession, WenguSessionResult } from "../../quiz/service/HistoryStore";

/**
 * 轮次报告分析 prompt（Issue #177）：逐题用时三态 + 知识点归组节。
 *
 * 三态的由来：`HistoryStore.recordResult` 的 `sec > 0` 闸把「快速作答
 * （<1s）」与「没记到用时」压成同一形态（`sec` 缺失）；旧 prompt 用
 * `r.sec ?? 0` 把它渲染成字面 `0s`，AI 由此幻觉出「计时为 NaN」
 * —— 三态显式化就是这条幻觉的根治。
 */

const q = (id: string, knowledge?: string, chapter?: string): WenguQuestion =>
    ({ id, knowledge, chapter, stemMd: `题干 ${id}` }) as WenguQuestion;

const res = (qid: string, ok: boolean, sec?: number): WenguSessionResult => ({
    qid,
    submitted: "A",
    ok,
    ...(sec === undefined ? {} : { sec }),
});

const session = (results: WenguSessionResult[]): WenguSession => ({
    id: "s1",
    docId: "doc1",
    startedAt: 0,
    mode: "perQuestion",
    elapsedSec: 0,
    answered: results.length,
    correct: results.filter((r) => r.ok).length,
    results,
});

const build = (results: WenguSessionResult[], list: WenguQuestion[]): string =>
    buildAnalysisPrompt({ session: session(results), list, rounds: [session(results)], totalSec: 120, overtimeSec: 0 });

describe("buildAnalysisPrompt：逐题用时三态", () => {
    it("有秒数：原样写 N s", () => {
        const p = build([res("q1", true, 29)], [q("q1", "极限")]);
        expect(p).toContain("1. 极限 对 29s");
    });

    it("sec 缺失：写「用时未记录（快速作答 <1s）」，绝不出现 0s", () => {
        const p = build([res("q1", true)], [q("q1", "极限")]);
        expect(p).toContain(`1. 极限 对 ${TIME_UNKNOWN_TEXT}`);
        expect(p).not.toContain("0s");
    });

    it("sec=0 与缺失同路（数据层 `sec > 0` 闸不记 0 秒）", () => {
        const p = build([res("q1", false, 0)], [q("q1", "极限")]);
        expect(p).toContain(`1. 极限 错 ${TIME_UNKNOWN_TEXT}`);
    });

    it("未答不注用时", () => {
        const p = build([], [q("q1", "极限")]);
        expect(p.split("每题：")[1].split("\n")[0]).toBe("1. 极限 未答");
        expect(p.split("每题：")[1]).not.toContain("s\n");
    });

    it("含「不要输出 NaN」硬指令与用时口径说明", () => {
        const p = build([res("q1", true)], [q("q1", "极限")]);
        expect(p).toContain("不要输出 NaN");
        expect(p).toContain("不要推测、编造任何数值");
        expect(p).toContain("没有记录到用时");
    });
});

describe("buildAnalysisPrompt：知识点归组节", () => {
    it("按 knowledge 归组，给出几对几错与合计用时", () => {
        const p = build(
            [res("q1", true, 10), res("q2", false, 5), res("q3", true, 7)],
            [q("q1", "极限"), q("q2", "极限"), q("q3", "导数")]
        );
        expect(p).toContain("知识点归组：");
        expect(p).toContain("- 极限：1 对 / 1 错，合计用时 15s");
        expect(p).toContain("- 导数：1 对 / 0 错，合计用时 7s");
    });

    it("knowledge 缺省回落 chapter，两者都缺用题号", () => {
        const p = build([res("q1", true, 3)], [q("q1", undefined, "线代"), q("q2")]);
        expect(p).toContain("- 线代：1 对 / 0 错");
        expect(p).toContain("- 2：0 对 / 1 错");
    });

    it("同组用时全缺：不出「合计用时」（不诱导出 0 秒/NaN）", () => {
        const p = build([res("q1", true), res("q2", true)], [q("q1", "极限"), q("q2", "极限")]);
        expect(p).toContain("- 极限：2 对 / 0 错\n");
        expect(p).not.toContain("合计用时 0s");
    });

    it("归组清单渲染成 markdown 列表（`- ` 行）", () => {
        const p = build([res("q1", true, 1)], [q("q1", "极限")]);
        const section = p.split("知识点归组：")[1];
        expect(section.split("\n")[1].startsWith("- 极限：")).toBe(true);
    });
});

describe("byBaseQid：组题多步合并（prompt 与报告图表同源）", () => {
    it("多步题 qid#k 合并成一条：ok 全对、sec 求和、用时缺失不算 0", () => {
        const s = session([res("q1#0", true, 4), res("q1#1", true), res("q2#0", false)]);
        const merged = byBaseQid(s);
        // 用时缺失的步在合并里就是「没记到」（消费侧一律只认数值形态，
        // 见 timeStateOf；本断言的用法是「不是有效数值」而不是「等于 0」）
        expect(Number.isFinite(merged.get("q1")?.sec)).toBe(false);
        expect(Number.isFinite(merged.get("q2")?.sec)).toBe(false);
        expect(merged.get("q1")?.ok).toBe(true);
        expect(merged.get("q2")?.ok).toBe(false);
    });
});
