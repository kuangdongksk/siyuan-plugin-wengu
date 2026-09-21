import { describe, expect, it } from "vitest";
import { buildAnalysisPrompt, byBaseQid, TIME_UNKNOWN_TEXT } from "./prompts/judge";
import type { WenguQuestion } from "../types";
import type { WenguSession, WenguSessionResult } from "../quiz/service/HistoryStore";
import type { WenguTimingMode } from "../types";

/**
 * 「AI 报告下游」独立验收（3/5）：**prompt 结构与反编造**。
 *
 * 补 PR 自带 `prompts/judge.test.ts` 的盲区：
 *  1. 五段结构**逐段正则**断言（原来只断言「含『分五段』『知识点归组』两个词」）；
 *  2. 反编造指令**在场性**（钉住该整句不被后续重构悄悄删掉/改弱）；
 *  3. 归组只用输入给的组名——用一个**没在任何数据里出现过的知识点名**做
 *     反向哨兵（指令要求只照抄现有组名，出现即违背）；
 *  4. 入参形态无关性：同一数据换 chapter/题号回落、换 sessions 形状，
 *     结构不塌、组名不凭空长出来。
 */

const q = (id: string, knowledge?: string, chapter?: string): WenguQuestion =>
    ({ id, knowledge, chapter, stemMd: `题干 ${id}` }) as WenguQuestion;

const res = (qid: string, ok: boolean, sec?: number): WenguSessionResult => ({
    qid,
    submitted: "A",
    ok,
    ...(sec === undefined ? {} : { sec }),
});

const session = (results: WenguSessionResult[], mode: WenguTimingMode = "perQuestion"): WenguSession => ({
    id: "s1",
    docId: "doc1",
    startedAt: 0,
    mode,
    elapsedSec: 0,
    answered: results.length,
    correct: results.filter((r) => r.ok).length,
    results,
});

const build = (results: WenguSessionResult[], list: WenguQuestion[], rounds?: WenguSession[]): string =>
    buildAnalysisPrompt({
        session: session(results),
        list,
        rounds: rounds ?? [session(results)],
        totalSec: 605,
        overtimeSec: 0,
    });

const LIST: WenguQuestion[] = [q("q1", "极限"), q("q2", "极限"), q("q3", "导数"), q("q4", undefined, "线代")];
const RESULTS = [res("q1", true, 10), res("q2", false, 5), res("q3", true, 7), res("q4", false, 0)];

describe("prompt 结构：五段与各小节的位置（正则逐段）", () => {
    const p = build(RESULTS, LIST);

    it("首段格式行点名五段，且「知识点归组」是**末段**（顺序不许改）", () => {
        const head = p.split("\n")[0];
        expect(head).toMatch(/分五段/);
        // 五段的点名顺序：总体评价 → 薄弱… → 思路点评 → 下一轮建议 → 知识点归组
        expect(head).toMatch(/总体评价[；;].*薄弱.*[；;].*思路点评[；;].*下一轮建议[；;].*知识点归组/);
        expect(head.indexOf("知识点归组")).toBeGreaterThan(head.indexOf("下一轮建议"));
    });

    it("末段写完法（markdown 列表 + 只照抄不新造），紧跟硬指令与数据区", () => {
        expect(p).toMatch(/末段「知识点」用 markdown 列表逐点给出\*\*归组清单\*\*/);
        expect(p).toMatch(/每点几对几错、合计用时/);
    });

    it("数据区小节齐备且**顺序固定**：本轮 → 每题 → 知识点归组 → 历史轮次", () => {
        const idx = (k: string): number => p.indexOf(k);
        expect(idx("本轮：")).toBeGreaterThan(0);
        expect(idx("每题：")).toBeGreaterThan(idx("本轮："));
        expect(idx("知识点归组：")).toBeGreaterThan(idx("每题："));
        expect(idx("历史轮次：")).toBeGreaterThan(idx("知识点归组："));
        expect(p.trimEnd().endsWith("只输出报告正文，不要客套。")).toBe(true);
    });

    it("summary 行四要素齐（作答/答对/计时方式/总用时），用时走 mmss", () => {
        expect(p).toMatch(/本轮：作答 4\/4，答对 2；计时方式 perQuestion；总用时 10:05/);
    });

    it("计时方式随 session.mode 变（倒计时/整卷模式不写死 perQuestion）", () => {
        const whole = buildAnalysisPrompt({
            session: session(RESULTS, "countdown"),
            list: LIST,
            rounds: [],
            totalSec: 60,
            overtimeSec: 0,
        });
        expect(whole).toContain("计时方式 countdown");
    });

    it("超时段的出现与否只由 overtimeSec 决定", () => {
        expect(p).not.toContain("超时 ");
        const over = buildAnalysisPrompt({
            session: session(RESULTS),
            list: LIST,
            rounds: [],
            totalSec: 60,
            overtimeSec: 90,
        });
        expect(over).toContain("超时 1:30");
    });

    it("「思路判卷」段只在有 thoughts 时出现（无思路时不留空段）", () => {
        expect(p).not.toContain("【思路判卷】");
        const withThoughts = buildAnalysisPrompt({
            session: { ...session(RESULTS), thoughts: { q1: "先洛必达再等价无穷小" } },
            list: LIST,
            rounds: [],
            totalSec: 60,
            overtimeSec: 0,
        });
        expect(withThoughts).toContain("【思路判卷】");
        expect(withThoughts).toContain("1. 极限 对 10s｜思路：先洛必达再等价无穷小");
        expect(withThoughts).toMatch(/思路与答案对错不一致的要点出来/);
    });
});

describe("prompt 反编造：指令在场性（防回归删掉）", () => {
    const p = build(RESULTS, LIST);

    it("「只照抄/不新造知识点」整句在场", () => {
        expect(p).toContain("直接照抄与合并，不要编造新的知识点名");
    });

    it("「不要推测、编造任何数值」整句在场", () => {
        expect(p).toContain("不要推测、编造任何数值");
        expect(p).toContain("不要输出 NaN、undefined 或类似字样的占位");
    });

    it("把「未记录用时」的语义讲清楚（三态口径，不许把缺数据读成 0 秒）", () => {
        expect(p).toContain(`标记为「${TIME_UNKNOWN_TEXT}」的题是**没有记录到用时**`);
        expect(p).toContain("不是 0 秒也不是缺失错误");
        expect(p).toContain("用时数据以「每题」行给出的为准");
    });

    it("两条反编造指令都在**数据区之前**（先立规矩再喂数据，顺序不许倒）", () => {
        const rule = p.indexOf("不要推测、编造任何数值");
        const copies = p.indexOf("不要编造新的知识点名");
        expect(rule).toBeLessThan(p.indexOf("本轮："));
        expect(copies).toBeLessThan(p.indexOf("知识点归组："));
    });
});

describe("prompt 反编造：归组只用输入给的组名", () => {
    const p = build(RESULTS, LIST);

    it("归组清单的每个 key 都能在输入题目里找到（不凭空长知识点）", () => {
        const keys = p
            .split("知识点归组：")[1]
            .split("\n历史轮次：")[0]
            .split("\n")
            .filter((l) => l.startsWith("- "))
            .map((l) => l.slice(2).split("：")[0]);
        const allowed = new Set(["极限", "导数", "线代"]);
        expect(keys.length).toBe(3);
        for (const k of keys) expect(allowed.has(k), `凭空长出的组名：${k}`).toBe(true);
    });

    it("反向哨兵：一个不在任何数据里的组名绝不出现在清单里", () => {
        const SENTINEL = "泰勒展开发散级数（本卷没有）";
        expect(p).not.toContain(SENTINEL);
        // 输入真加进去才出现 ⇒ 证明「清单确实来自输入」而非模板硬编码
        const withIt = build(RESULTS, [...LIST, q("q5", SENTINEL)]);
        expect(withIt).toContain(`- ${SENTINEL}：`);
        expect([...withIt.matchAll(/^- (.+?)：/gm)].map((m) => m[1])).toContain(SENTINEL);
    });

    it("重名知识点被**合并**成一行（不是同名两行）", () => {
        const rows = p
            .split("知识点归组：")[1]
            .split("\n")
            .filter((l) => l.startsWith("- 极限"));
        expect(rows.length).toBe(1);
        expect(rows[0]).toContain("1 对 / 1 错");
    });

    it("knowledge / chapter / 题号 三种回落键都合法且互不串台", () => {
        expect(p).toContain("- 极限：1 对 / 1 错");
        expect(p).toContain("- 导数：1 对 / 0 错");
        expect(p).toContain("- 线代：0 对 / 1 错"); // q4 只有 chapter
        // 全部缺两者时用题号：单列一卷验证
        const bare = build([res("z1", true, 2)], [q("z1")]);
        expect(bare).toContain("- 1：1 对 / 0 错");
    });

    it("同一知识点跨「有 knowledge / 只有 chapter」形态不裂成两组（键口径唯一）", () => {
        const rows = build([res("q1", true, 1), res("q2", true, 1)], [q("q1", "极限"), q("q2", undefined, "极限")]);
        const limitRows = rows
            .split("知识点归组：")[1]
            .split("\n")
            .filter((l) => l.startsWith("- 极限"));
        expect(limitRows.length).toBe(1);
        expect(limitRows[0]).toContain("2 对 / 0 错");
    });
});

describe("prompt 与 byBaseQid 同源（图表与 prompt 用时口径不分叉）", () => {
    it("prompt 逐题行的秒数与 byBaseQid 的 sec 逐题一致", () => {
        const merged = byBaseQid(session(RESULTS));
        const perQ = build(RESULTS, LIST).split("每题：")[1].split("\n知识点归组：")[0];
        for (const [i, x] of LIST.entries()) {
            const sec = merged.get(x.id)?.sec ?? 0;
            const want = sec > 0 ? `${sec}s` : TIME_UNKNOWN_TEXT;
            const state = merged.get(x.id)?.ok ? "对" : "错";
            expect(perQ, `第 ${i + 1} 题`).toContain(`${i + 1}. ${x.knowledge ?? x.chapter} ${state} ${want}`);
        }
    });

    it("多步题：prompt 行用合并后的总秒数，不是各步分别列行", () => {
        const p = build([res("q1#0", true, 4), res("q1#1", true, 6)], [q("q1", "极限")]);
        const perQ = p.split("每题：")[1].split("\n知识点归组：")[0];
        expect(perQ).toBe("1. 极限 对 10s");
        expect(perQ).not.toContain("q1#0");
    });
});
