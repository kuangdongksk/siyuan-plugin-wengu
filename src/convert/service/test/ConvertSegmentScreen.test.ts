import { describe, expect, it } from "vitest";
import { runSegment } from "../run/ConvertSegment";
import type { SegmentDeps } from "../run/ConvertSegment";
import { buildNormIndex } from "../source/CursorWindow";
import type { Shard } from "../source/ShardPlan";

/**
 * 整卷链的切片预筛钩子（Issue #186 A2）：片执行器在**每窗口生成之前**问一句
 * 「这段有可出题的内容吗」（`deps.screen`），判「没料」就推游标走人。
 *
 * 三条口径：
 * ① 缺省（未接线）恒不跳 —— 未接线调用方与既有单测零行为变化；
 * ② 判跳的窗口**一次生成调用都不烧**（`makeCall` 不被调）；
 * ③ 跳过的窗口照旧**推进游标**（不卡循环、不重复问同一段）。
 */

const REPLY = [
    "@@Q type=single",
    "@@P stem",
    "题目一。",
    "@@P opt",
    "A",
    "@@P opt",
    "B",
    "@@P ans",
    "A",
    "@@TO: END",
].join("\n");

/** 跑一片的最小依赖（`screen` 由用例给；`calls` 记生成调用次数）。 */
function deps(kramdown: string, screen?: (text: string) => Promise<boolean>): { d: SegmentDeps; gen: () => number } {
    let gen = 0;
    const d: SegmentDeps = {
        kramdown,
        normIndex: buildNormIndex(kramdown),
        signal: new AbortController().signal,
        single: true,
        t: (k) => k,
        reportTypes: () => undefined,
        reportSubject: () => undefined,
        makeCall: () => async () => {
            gen++;
            return { reply: REPLY };
        },
        submit: async () => 0,
        ...(screen ? { screen } : {}),
    };
    return { d, gen: () => gen };
}

const shard = (end: number): Shard => ({ start: 0, end, title: "", kind: "start" });

describe("整卷链切片预筛（Issue #186 A2）", () => {
    it("未接线（无 screen 依赖）：照旧发生成调用（现状行为）", async () => {
        const md = "正文".repeat(30);
        const { d, gen } = deps(md);
        const res = await runSegment(shard(md.length), d);
        expect(gen()).toBe(1);
        expect(res.batches).toBe(1);
    });

    it("判「没料」：一次生成调用都不烧，游标照旧推到片尾", async () => {
        const md = "目录页。\n\n" + "正文".repeat(30);
        const { d, gen } = deps(md, async () => true);
        const res = await runSegment(shard(md.length), d);
        expect(gen()).toBe(0); // 关键：省下的就是这一笔
        expect(res.batches).toBe(0);
        expect(res.cursor).toBe(md.length);
        expect(res.error).toBe("");
    });

    it("判「有料」：照常进生成（不跳）", async () => {
        const md = "正文".repeat(30);
        const { d, gen } = deps(md, async () => false);
        const res = await runSegment(shard(md.length), d);
        expect(gen()).toBe(1);
        expect(res.batches).toBe(1);
    });

    it("预筛只看得到窗口原文（判定原料就是它）", async () => {
        const md = "# 第一章\n\n" + "正文".repeat(30);
        const seen: string[] = [];
        const { d } = deps(md, async (t) => {
            seen.push(t);
            return false;
        });
        await runSegment(shard(md.length), d);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen[0]).toContain("正文");
    });
});
