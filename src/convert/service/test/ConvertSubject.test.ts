import { describe, expect, it } from "vitest";
import { runSegment } from "../run/ConvertSegment";
import type { SegmentDeps } from "../run/ConvertSegment";
import { buildNormIndex } from "../source/CursorWindow";
import type { Shard } from "../source/ShardPlan";

/**
 * 转换首批判定行的**学科**接线（Issue #83）：`SUBJECT:` 行随首批的
 * CAN_CONVERT/REASON/TYPES 一起报出，片执行器解析后经 `deps.reportSubject`
 * 交给编排层落库（题集 `subject` 字段）。
 *
 * 这里锁三条口径（都是实现期最易写错的）：
 * ① 首批报出即上报（归一取首个学科名）；
 * ② **只有首批**报（非首批 prompt 明确免报，即便回复里带了 SUBJECT 行也
 *    不采信——批边界由 AI 决定，多批各报各的会让题集学科随「最后一批」
 *    漂移）；
 * ③ 未报/占位「无」不上报（宁缺勿错：题集不落假学科，判别回退题型并集）。
 */

/** 单批回复：判定行 + 一道题 + @@TO: END（游标直接推到片尾）。 */
const reply = (extra: string): string =>
    [
        "CAN_CONVERT: yes",
        "REASON: 英语阅读理解训练卷",
        "TYPES: 单选",
        ...(extra ? [extra] : []),
        "@@Q type=single knowledge=主旨",
        "@@P stem",
        "What is the main idea?",
        "@@P opt",
        "A",
        "@@P opt",
        "B",
        "@@P ans",
        "A",
        "@@TO: END",
    ].join("\n");

/** 跑一片的最小依赖（AI 逐批回放 replies；submit 只记账不落库）。 */
function deps(kramdown: string, replies: string[], onSubject: (s?: string) => void): SegmentDeps {
    let i = 0;
    return {
        kramdown,
        normIndex: buildNormIndex(kramdown),
        signal: new AbortController().signal,
        single: true,
        t: (k) => k,
        reportTypes: () => undefined,
        reportSubject: onSubject,
        makeCall: () => async () => ({ reply: replies[i++] ?? "" }),
        submit: async () => 0,
    };
}

const shard = (end: number): Shard => ({ start: 0, end, title: "", kind: "start" });

describe("转换首批 SUBJECT 学科上报（Issue #83）", () => {
    it("首批报出：解析并上报（括号说明取首个学科名）", async () => {
        const md = "英语阅读理解。\n\n" + "正文".repeat(20);
        const got: (string | undefined)[] = [];
        await runSegment(
            shard(md.length),
            deps(md, [reply("SUBJECT: 英语（阅读理解）")], (s) => got.push(s))
        );
        expect(got).toEqual(["英语"]);
    });

    it("首批未报/占位「无」⇒ 不上报（不落假学科）", async () => {
        const md = "正文".repeat(30);
        for (const extra of ["", "SUBJECT: 无", "SUBJECT:   "]) {
            const got: (string | undefined)[] = [];
            await runSegment(
                shard(md.length),
                deps(md, [reply(extra)], (s) => got.push(s))
            );
            expect(got, extra).toEqual([]);
        }
    });

    it("**只有首批**报：后续批次回复里带 SUBJECT 行也不采信", async () => {
        // 两批：首批无 SUBJECT（判不出），第二批带 SUBJECT=数学 —— 不上报
        const md = "题一。\n\n" + "题二。\n\n".repeat(20);
        const got: (string | undefined)[] = [];
        const first = reply("");
        // 首批把游标推进到中段（@@TO 指向中段原文片段），第二批才有得跑
        const mid = md.slice(md.length >> 1, (md.length >> 1) + 12).replace(/\n/g, "");
        const firstWithTo = first.replace("@@TO: END", `@@TO: ${mid}`);
        const second = reply("SUBJECT: 数学");
        const d = deps(md, [firstWithTo, second], (s) => got.push(s));
        await runSegment(shard(md.length), { ...d, single: false });
        expect(got).toEqual([]);
    });

    it("首批报出即上报一次（多批场景不重复上报）", async () => {
        const md = "题一。\n\n" + "题二。\n\n".repeat(20);
        const got: (string | undefined)[] = [];
        const mid = md.slice(md.length >> 1, (md.length >> 1) + 12).replace(/\n/g, "");
        const first = reply("SUBJECT: 语文").replace("@@TO: END", `@@TO: ${mid}`);
        const d = deps(md, [first, reply("SUBJECT: 数学")], (s) => got.push(s));
        await runSegment(shard(md.length), { ...d, single: false });
        expect(got).toEqual(["语文"]);
    });
});
