import { describe, expect, it } from "vitest";
import { byBaseQid, buildAnalysisPrompt, TIME_UNKNOWN_TEXT } from "./prompts/judge";
import { mmss } from "../ui/shared";
import { buildTimeBars, type TimeBarInput } from "../quiz/render/TimeBars";
import type { WenguQuestion } from "../types";
import type { WenguSession, WenguSessionResult } from "../quiz/service/HistoryStore";

/**
 * 「AI 报告下游」独立验收（1/5）：**NaN 全传播矩阵**（TestRail
 * `report-markdown-knowledge` 的 1~3 节，含 `TimeBars` 出口）。
 *
 * 本文件不重复 PR 自带 `prompts/judge.test.ts` / `render/TimeBars.test.ts`
 * 的既有断言，专补三处盲区：
 *  1. **混合 session 的矩阵**（缺 sec / sec=0 / sec>0 / 多步部分缺 同卷共存）；
 *  2. **buildAnalysisPrompt 全文**（不只「每题行」）无 `"NaN"` 字样；
 *  3. **`TimeBars` 柱高跨模块链**（`byBaseQid → barInputs → buildTimeBars`
 *     逐题档/聚合档 双档 + `mmss` tooltip）。
 *
 * ⚠️ 带 `probe` 前缀的用例是把**当前实现的实际行为**钉下来的探针，多为会
 * 变红的归因线索（一律「期望 / 实际 / 归因」写在用例注释里），**不是**要求
 * 实现迎合期望值；判红属归因评审。
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

const prompt = (results: WenguSessionResult[], list: WenguQuestion[]): string =>
    buildAnalysisPrompt({
        session: session(results),
        list,
        rounds: [session(results)],
        totalSec: 120,
        overtimeSec: 0,
    });

/** 混合卷：把四种用时形态塞进**同一份 session**（这才撞得到旧实现的
 *  `(cur?.sec ?? 0) + (r.sec ?? 0)`——单形态用例各自孤立时看不见交互）。 */
const MIXED: WenguSessionResult[] = [
    res("q1", true), // 缺 sec：快速作答 <1s（数据层 `sec > 0` 闸不记）
    res("q2", false, 0), // sec=0：与缺失同形态
    res("q3", true, 29), // sec>0：真用时
    res("q4#0", true, 4), // 多步题：一步有、一步缺
    res("q4#1", true),
    res("q5#0", false, 6), // 多步题：全有
    res("q5#1", false, 8),
];
const MIXED_LIST: WenguQuestion[] = [
    q("q1", "极限"),
    q("q2", "极限"),
    q("q3", "导数"),
    q("q4", "线代"),
    q("q5", "线代"),
];

/** 报告图表消费方（RoundReportApp）的取样：`sec: byQid.get(id)?.sec ?? 0`。 */
const barsOf = (merged: Map<string, { sec: number }>, list: WenguQuestion[]): TimeBarInput[] =>
    list.map((x, i) => ({
        label: i + 1,
        sec: merged.get(x.id)?.sec ?? 0,
        unanswered: !merged.has(x.id),
        wrong: false,
        partial: false,
    }));

/** 报告图表的文案格式化器（本文件只验数据链，取**最朴素**口径即可；
 *  ⚠️ 但 `sec` 必须按生产侧一样过有限数归一——`mmss(NaN)` 会算出「NaN:NaN」，
 *  这是**文案层**的事，与本文件要验的「数据层不出非有限值」是两条线。生产侧
 *  的正式口径见 RoundReportApp 的 `timeText`（三态）与 TimeBars.test）。 */
const fin = (sec: number): number => (Number.isFinite(sec) ? sec : 0);
const fmt = {
    fmtTitle: (x: TimeBarInput) => `第${x.label}题 · ${mmss(fin(x.sec))}`,
    fmtGroup: (g: { from: number; to: number; sec: number }) => `第${g.from}-${g.to}题 · ${mmss(fin(g.sec))}`,
};

/** 全卷扩展（聚合档需要 >60 题）。 */
const bigList = (n: number): WenguQuestion[] => Array.from({ length: n }, (_, i) => q(`b${i}`, `K${i % 3}`));

describe("NaN 矩阵：混合 session → byBaseQid 无 NaN（缺 / 0 / >0 / 多步部分缺 同卷）", () => {
    it("四种形态同卷：逐题三态正确，且**每个** sec 都是有限数", () => {
        const m = byBaseQid(session(MIXED));
        expect(m.get("q1")?.sec).toBe(0); // 缺 → 0
        expect(m.get("q2")?.sec).toBe(0); // 0 → 0
        expect(m.get("q3")?.sec).toBe(29); // >0 → 原样
        expect(m.get("q4")?.sec).toBe(0); // 多步部分缺 → 整题 0
        expect(m.get("q5")?.sec).toBe(14); // 多步全有 → 求和
        for (const [b, v] of m) {
            expect(Number.isFinite(v.sec), `${b} 的 sec 应为有限数，实际 ${v.sec}`).toBe(true);
            expect(Number.isNaN(v.sec), `${b} 的 sec 不应是 NaN`).toBe(false);
        }
    });

    it("混合卷的多步题 ok 合并照旧（全步对才 ok，不受用时三态牵连）", () => {
        const m = byBaseQid(session(MIXED));
        expect(m.get("q4")?.ok).toBe(true);
        expect(m.get("q5")?.ok).toBe(false);
    });

    it("整卷无用时（全缺）→ 全 0，且一个 NaN 都不漏", () => {
        const m = byBaseQid(session([res("q1", true), res("q2", false), res("q3#0", true), res("q3#1", true)]));
        expect([...m.values()].map((v) => v.sec)).toEqual([0, 0, 0]);
    });
});

describe('NaN 矩阵：buildAnalysisPrompt 全文无 "NaN" 字样', () => {
    it("混合卷：**全文**（不限「每题」行）不含字面 NaN", () => {
        const p = prompt(MIXED, MIXED_LIST);
        // 反向自证扫描面非空：数据行确实在
        expect(p).toContain("每题：");
        expect(p).toContain("知识点归组：");
        // ⚠️ 指令段自带的「不要输出 NaN」字样会被这条一次性放行——
        // 下面第二条用例用「模板占位符形态」把它区分开
        const stripped = p.replace(/不要输出 NaN、undefined 或类似字样的占位/g, "");
        expect(stripped).not.toContain("NaN");
    });

    it("指令段只在自己的原句中提 NaN，数据区一个都没有（逐行扫）", () => {
        const p = prompt(MIXED, MIXED_LIST);
        const lines = p.split("\n").filter((l) => l.includes("NaN"));
        // 允许出现的只有那条硬指令/口径说明，且必须带「不要输出」语境
        for (const l of lines) expect(l).toContain("不要输出 NaN");
        // 数据区（每题行 / 归组行 / 本轮行）零命中
        const data = lines.filter((l) => /^(每题：|- |知识点归组：|本轮：|历史轮次：)/.test(l));
        expect(data).toEqual([]);
    });

    it("缺用时的题写 TIME_UNKNOWN_TEXT，且绝无 `0s`/`undefined` 混入逐题行", () => {
        const p = prompt(MIXED, MIXED_LIST);
        const perQ = p.split("每题：")[1].split("\n知识点归组：")[0];
        expect(perQ).toContain(`1. 极限 对 ${TIME_UNKNOWN_TEXT}`);
        expect(perQ).toContain(`2. 极限 错 ${TIME_UNKNOWN_TEXT}`);
        expect(perQ).toContain("3. 导数 对 29s");
        expect(perQ).toContain(`4. 线代 对 ${TIME_UNKNOWN_TEXT}`);
        expect(perQ).toContain("5. 线代 错 14s");
        expect(perQ).not.toContain("0s");
        expect(perQ).not.toContain("undefined");
    });

    it("归组节：同组全缺不出「合计用时」，同组部分有用时只累计有用时的题", () => {
        const p = prompt(MIXED, MIXED_LIST);
        expect(p).toContain("- 极限：1 对 / 1 错\n"); // q1/q2 都缺用时 → 无合计
        expect(p).not.toContain("合计用时 0s");
        expect(p).toContain("- 导数：1 对 / 0 错，合计用时 29s");
        expect(p).toContain("- 线代：1 对 / 1 错，合计用时 14s"); // q4 归 0 不计入，q5=14
        expect(p.split("知识点归组：")[1]).not.toContain("NaN");
    });

    it("空卷（一题未答）：全文仍无数据侧 NaN", () => {
        const p = prompt([], MIXED_LIST);
        const stripped = p.replace(/不要输出 NaN、undefined 或类似字样的占位/g, "");
        expect(stripped).not.toContain("NaN");
        expect(p).toContain("本轮：作答 0/5，答对 0");
    });
});

describe("NaN 矩阵：TimeBars 柱高为有限值（跨模块链）", () => {
    it("逐题档：混合卷的每根柱 h 是有限整数、title 不含 NaN", () => {
        const m = byBaseQid(session(MIXED));
        const bars = buildTimeBars(barsOf(m, MIXED_LIST), fmt);
        expect(bars.length).toBe(MIXED_LIST.length);
        for (const c of bars) {
            expect(Number.isFinite(c.h), `列 ${c.label} h=${c.h}`).toBe(true);
            expect(Number.isInteger(c.h)).toBe(true);
            expect(c.h).toBeGreaterThanOrEqual(4); // 矮柱下限
            expect(c.h).toBeLessThanOrEqual(100);
            expect(c.title).not.toContain("NaN");
            for (const it of c.items) expect(Number.isFinite(it.h)).toBe(true);
        }
        // 真用时的 q3=29s 与 q5=14s 按比例出高（29 → 100、14 → 48），
        // 三题无用时全走矮柱下限（旧实现 NaN 会让高度集体失真成一片同高）
        expect(bars.map((c) => c.h)).toEqual([4, 4, 100, 4, 48]);
    });

    it("聚合档（>60 题）：组柱与组 title 的 mmss 全有限、无 NaN", () => {
        const results: WenguSessionResult[] = [];
        for (let i = 0; i < 243; i++) {
            if (i % 5 === 0)
                results.push(res(`b${i}`, true)); // 五分之一缺用时
            else results.push(res(`b${i}`, i % 2 === 0, (i % 30) + 1));
        }
        const list = bigList(243);
        const bars = buildTimeBars(barsOf(byBaseQid(session(results)), list), fmt);
        expect(bars.every((c) => c.grouped)).toBe(true);
        expect(bars.length).toBeLessThanOrEqual(60);
        for (const c of bars) {
            expect(Number.isFinite(c.h), `组 ${c.label} h=${c.h}`).toBe(true);
            expect(c.title).not.toContain("NaN");
        }
    });

    it("脏值直达 TimeBars 出口：NaN/Infinity 按 0 收拾，且 tooltip 不再是 NaN:NaN", () => {
        const dirty: TimeBarInput[] = [
            { label: 1, sec: NaN, unanswered: false, wrong: false, partial: false },
            { label: 2, sec: Infinity, unanswered: false, wrong: false, partial: false },
            { label: 3, sec: -Infinity, unanswered: false, wrong: false, partial: false },
            { label: 4, sec: 10, unanswered: false, wrong: false, partial: false },
        ];
        const bars = buildTimeBars(dirty, fmt);
        expect(bars.map((c) => c.h)).toEqual([4, 4, 4, 100]);
        // ⚠️ 柱高过了 secOf（出口归一）就一定出不了 NaN%；title 文案则**由
        //    调用方决定**——本夹具的 fmt 是朴素口径（直接 mmss(x.sec)），只
        //    验「不再有 NaN/Infinity 穿透」；生产侧的三态化见 RoundReportApp
        //    的 timeText 与 TimeBars.test 的「tooltip 不出 NaN:NaN」。
        expect(bars.map((c) => c.title).join(" ")).not.toContain("NaN");
        expect(bars.map((c) => c.title).join(" ")).not.toContain("Infinity");
        // 聚合档同口径（组内求和不得被脏值污染成 NaN）
        const long = [
            ...dirty,
            ...Array.from({ length: 60 }, (_, i) => dirty[i % 4]).map((x, i) => ({ ...x, label: i + 5 })),
        ];
        const grouped = buildTimeBars(long, fmt);
        expect(grouped.every((c) => Number.isFinite(c.h))).toBe(true);
    });
});

describe("NaN 矩阵：非有限值在 byBaseQid 出口一律归 0（Infinity 同罪）", () => {
    const probe = (qid: string, sec: number): number => byBaseQid(session([res(qid, true, sec)])).get(qid)?.sec ?? 0;

    it("byBaseQid 对 NaN / ±Infinity 入参一律归 0", () => {
        // 「绝不出非有限值」的兜底落在**出口**而不是「垃圾进不来」：
        // `history.json` 可手改 / 可跨版本同步，`sec: Infinity` 在落盘层没有闸
        // （`HistoryStore` 只挡 `sec > 0` 以下的），且 `Infinity > 0` 成立 ⇒
        // 单靠三态判据吃不掉它。故 `byBaseQid` 返回前对终值过 Number.isFinite。
        expect(probe("q1", NaN)).toBe(0);
        expect(probe("q1", Infinity)).toBe(0);
        expect(probe("q1", -Infinity)).toBe(0);
    });

    it("Infinity 穿透链已断：图表 tooltip 无 NaN、prompt 行无 Infinity", () => {
        const sec = probe("q1", Infinity);
        const bars = buildTimeBars([{ label: 1, sec, unanswered: false, wrong: false, partial: false }], fmt);
        expect(bars[0].title, "图表 title 不应出现 NaN").not.toContain("NaN");
        expect(prompt([res("q1", true, Infinity)], [q("q1", "极限")])).not.toContain("Infinity");
        // 多步题同口径（求和后再归一）
        const multi = byBaseQid(session([res("q1#0", true, Infinity), res("q1#1", true, 5)]));
        expect(Number.isFinite(multi.get("q1")?.sec ?? NaN)).toBe(true);
    });

    it("脏值直达 TimeBars 出口：NaN/Infinity 按 0 收拾，**且 tooltip 不再是 NaN:NaN**", () => {
        const dirty: TimeBarInput[] = [
            { label: 1, sec: NaN, unanswered: false, wrong: false, partial: false },
            { label: 2, sec: Infinity, unanswered: false, wrong: false, partial: false },
            { label: 3, sec: -Infinity, unanswered: false, wrong: false, partial: false },
            { label: 4, sec: 10, unanswered: false, wrong: false, partial: false },
        ];
        const bars = buildTimeBars(dirty, fmt);
        expect(bars.map((c) => c.h)).toEqual([4, 4, 4, 100]);
        // 出口归一已保证 sec 有限 ⇒ fmt.fmtTitle 里不会再算出「NaN:NaN」；
        // 本夹具的 `fmt` 是**测试自带**的朴素口径（直接 mmss(x.sec)），
        // 生产侧的三态化处置见 RoundReportApp 的 timeText 与 TimeBars.test。
        expect(bars.map((c) => c.title).join(" ")).not.toContain("NaN");
        expect(bars.map((c) => c.title).join(" ")).not.toContain("Infinity");
        // 聚合档同口径（组内求和不得被脏值污染成 NaN）
        const long = [
            ...dirty,
            ...Array.from({ length: 60 }, (_, i) => dirty[i % 4]).map((x, i) => ({ ...x, label: i + 5 })),
        ];
        const grouped = buildTimeBars(long, fmt);
        expect(grouped.every((c) => Number.isFinite(c.h))).toBe(true);
    });
});
