import { describe, expect, it } from "vitest";
import type { JevHttpResponse } from "./transport";
import { read } from "../../testkit/readSource";
import {
    buildCheckState,
    checkBatch,
    checkChunks,
    qcChunkTail,
    qcSummary,
    suspectLabel,
    type CheckDraft,
    type JevQcSuspect,
} from "./convertChecks";

/**
 * 转换质检（Issue #184）四路单测：五问正常 / 低置信走存疑 / 明确踩雷只标
 * 不删 / Jev 抛错走跳过。全程 mock `judgeJev` 的注入 transport，**不碰真网络**。
 */

/** 一道单选题草稿（与 convert 域 DraftUnit 结构等价，故意不 import）。 */
const Q: CheckDraft = {
    material: false,
    attrs: { type: "single" },
    parts: [
        { name: "stem", text: "求 $\\lim_{x\\to0}\\frac{\\sin x}{x}$。" },
        { name: "option-0", text: "$1$" },
        { name: "option-1", text: "$0$" },
        { name: "answer", text: "A" },
        { name: "solution", text: "等价无穷小。" },
    ],
};

const MATERIAL: CheckDraft = {
    material: true,
    attrs: {},
    parts: [{ name: "body", text: "当 $x\\to0$ 时 $\\sin x\\sim x$。" }],
};

/** 可注入 transport：回一个按名对象响应（五项答案由调用方给）。 */
function transportOf(answers: Record<string, unknown>, calls: { payload?: string } = {}) {
    return async (req: { payload: string }): Promise<JevHttpResponse> => {
        calls.payload = req.payload;
        return { status: 200, body: JSON.stringify({ answers }) };
    };
}

/** 五问的「全部合格」答案（noul 三否两是 + 质量 5）。 */
const OK = {
    q0: { noul: 0.95 },
    q1: { noul: 0.9 },
    q2: { noul: 0.92 },
    q3: { noul: 0.88 },
    q4: { score: 5, confidence: 0.9 },
};
const noOf = (k: string, p: number): Record<string, unknown> => ({ ...OK, [k]: { noul: p } });

describe("转换质检：五问正常（全过）", () => {
    it("一批一次请求、五项齐备、无存疑", async () => {
        const calls: { payload?: string } = {};
        const r = await checkBatch({
            drafts: [MATERIAL, Q],
            materialText: "",
            apiKey: "sk",
            transport: transportOf(OK, calls),
        });
        expect(r.checked).toBe(1);
        expect(r.suspects).toEqual([]);
        // 一次请求五项（不逐题发）
        const sent = JSON.parse(calls.payload ?? "{}") as { questions: Record<string, { type: string }> };
        expect(Object.keys(sent.questions)).toEqual(["q0", "q1", "q2", "q3", "q4"]);
        expect(sent.questions.q4.type).toBe("score"); // 线格式（按名对象 + type/instructions/criteria）
        // 状态文本含题干、选项与材料原文（两项判据的依据都在里面）
        const state = buildCheckState([MATERIAL, Q], "");
        expect(state).toContain("第 1 题（题型：single）");
        expect(state).toContain("A. $1$");
        expect(state).toContain("材料原文：");
        expect(state).toContain("\\sin x\\sim x");
    });

    it("只出材料、无题目的批：零请求（没东西可判）", async () => {
        let called = 0;
        await checkBatch({
            drafts: [MATERIAL],
            materialText: "",
            apiKey: "sk",
            transport: async () => {
                called++;
                return { status: 200, body: "{}" };
            },
        });
        expect(called).toBe(0);
    });

    it("无 key：零请求、空报告（回落现状）", async () => {
        let called = 0;
        const r = await checkBatch({
            drafts: [Q],
            materialText: "",
            apiKey: "  ",
            transport: async () => {
                called++;
                return { status: 200, body: "{}" };
            },
        });
        expect(called).toBe(0);
        expect(r).toEqual({ checked: 0, suspects: [] });
    });
});

describe("转换质检：低置信走存疑", () => {
    it("noul 落 0.5 → 存疑（非明确踩雷）", async () => {
        const r = await checkBatch({
            drafts: [Q],
            materialText: "",
            apiKey: "sk",
            transport: transportOf(noOf("q1", 0.5)),
        });
        expect(r.suspects.map((s) => s.reason)).toEqual(["derive"]);
        expect(r.suspects[0].clear).toBe(false);
    });

    it("质量分置信 <0.7 → 存疑，且不按分值下结论", async () => {
        const r = await checkBatch({
            drafts: [Q],
            materialText: "",
            apiKey: "sk",
            // 分值 5（很高）但置信 0.4：不可用 → 存疑，不是「过」
            transport: transportOf({ ...OK, q4: { score: 5, confidence: 0.4 } }),
        });
        expect(r.suspects).toEqual([{ reason: "quality", clear: false, items: [] }]);
    });

    it("质量分置信足够且分值低（≤2）→ 明确踩雷（只标不删）", async () => {
        const r = await checkBatch({
            drafts: [Q],
            materialText: "",
            apiKey: "sk",
            transport: transportOf({ ...OK, q4: { score: 2, confidence: 0.8 } }),
        });
        expect(r.suspects.map((s) => s.reason)).toEqual(["quality"]);
        expect(r.suspects[0].clear).toBe(true);
    });
});

describe("转换质检：明确踩雷只标不删", () => {
    it("「可推出」≤0.2 → clear 标记，草稿一条不少（无删除通道）", async () => {
        const drafts = [Q, { ...Q }];
        const r = await checkBatch({
            drafts,
            materialText: "",
            apiKey: "sk",
            transport: transportOf(noOf("q1", 0.1)),
        });
        expect(r.checked).toBe(2);
        expect(r.suspects).toEqual([{ reason: "derive", clear: true, items: [] }]);
        // 只标不删：本模块不返回任何「可删清单」，输入草稿原样（长度不变）
        expect(drafts.length).toBe(2);
    });

    it("多项同时踩雷 → 全部列出（不取第一个就收工）", async () => {
        const r = await checkBatch({
            drafts: [Q],
            materialText: "",
            apiKey: "sk",
            transport: transportOf({ ...noOf("q0", 0.1), q2: { noul: 0.9 }, q3: { noul: 0.15 } }),
        });
        expect(r.suspects.map((s) => s.reason)).toEqual(["unique", "typeOk"]);
        expect(r.suspects.every((s) => s.clear)).toBe(true);
    });

    it("答案类型与问题不符（上游串答案）→ 空报告，不误判", async () => {
        const r = await checkBatch({
            drafts: [Q],
            materialText: "",
            apiKey: "sk",
            // q0 该是 noul，回了个 choice 壳（`parseAnswer` 只校验「值可用」、
            // 不校验「类型对不对」——故错位必须由本模块自己拦，否则按位取值
            // 会把 choice 的 confidence 当成 bool 概率用）
            transport: transportOf({ ...OK, q0: { choice: "甲", confidence: 0.9 } }),
        });
        expect(r).toEqual({ checked: 0, suspects: [] });
    });
});

describe("转换质检：Jev 抛错走跳过", () => {
    it("429 退避后仍败 → 空报告（不抛错、不阻塞转换）", async () => {
        let n = 0;
        const r = await checkBatch({
            drafts: [Q],
            materialText: "",
            apiKey: "sk",
            sleep: async () => undefined,
            transport: async () => {
                n++;
                return { status: 429, body: "rate limited" };
            },
        });
        expect(n).toBe(2); // 退避重试一次后放弃（client 的政策，本模块只接住）
        expect(r).toEqual({ checked: 0, suspects: [] });
    });

    it("key 无效（401）→ 空报告", async () => {
        const r = await checkBatch({
            drafts: [Q],
            materialText: "",
            apiKey: "bad",
            transport: async () => ({ status: 401, body: "unauthorized" }),
        });
        expect(r).toEqual({ checked: 0, suspects: [] });
    });

    it("响应形状不对（缺 q0）→ 空报告", async () => {
        const r = await checkBatch({
            drafts: [Q],
            materialText: "",
            apiKey: "sk",
            transport: async () => ({ status: 200, body: JSON.stringify({ answers: { q1: { noul: 0.1 } } }) }),
        });
        expect(r).toEqual({ checked: 0, suspects: [] });
    });
});

describe("转换质检：判定结果不落盘", () => {
    it("无 key 时一次请求都不发（总闸关＝零行为的机械保证）", async () => {
        let hits = 0;
        const r = await checkBatch({
            drafts: [Q],
            materialText: "",
            apiKey: "",
            transport: async () => {
                hits++;
                return { status: 200, body: "{}" };
            },
        });
        expect(hits).toBe(0);
        expect(r.checked).toBe(0);
    });

    it("判定结果只走返回值：模块不 import 任何存储/题库模块", async () => {
        const src = await read("/src/ai/jev/convertChecks.ts");
        // 判定结果不落盘（规划稿 §二 纪律 3）——机械口径：判定层不碰存储
        for (const bad of ["QuestionBank", "saveData", "bank.", "BankRecord", "siyuan"]) {
            expect(src).not.toContain(bad);
        }
    });
});

describe("转换质检报告标注", () => {
    it("存疑项一行 = 哪一项存疑 + 一句原因；汇总带通过/存疑两种头", async () => {
        const t = (k: string): string => k;
        const s: JevQcSuspect = { reason: "derive", clear: true, items: [] };
        expect(suspectLabel(t, s)).toContain("jevQcClear");
        expect(suspectLabel(t, s)).toContain("jevQcDerive");
        expect(qcSummary(t, { checked: 1, suspects: [] })).toBe("jevQcPass");
        expect(qcSummary(t, { checked: 1, suspects: [s] })).toContain("jevQcSuspect");
    });

    it("增量链：无存疑 → 尾巴为 null（零 Jev 痕迹）", async () => {
        const t = (k: string): string => k;
        expect(qcChunkTail(t, { reports: [], suspectChunks: 0, checkedChunks: 2 })).toBeNull();
        const sum = await checkChunks([{ index: 2, drafts: [Q] }], {
            apiKey: "sk",
            transport: transportOf(noOf("q1", 0.5)),
        });
        expect(sum.suspectChunks).toBe(1);
        expect(sum.checkedChunks).toBe(1);
        expect(qcChunkTail(t, sum)).toContain("第 3 块");
    });

    it("增量链：单块失败不影响其余块（逐块独立回落）", async () => {
        let n = 0;
        const sum = await checkChunks(
            [
                { index: 0, drafts: [Q] },
                { index: 1, drafts: [Q] },
            ],
            {
                apiKey: "sk",
                transport: async () => {
                    n++;
                    return n === 1
                        ? { status: 500, body: "boom" }
                        : { status: 200, body: JSON.stringify({ answers: OK }) };
                },
            }
        );
        expect(sum.checkedChunks).toBe(1);
        expect(sum.suspectChunks).toBe(0);
    });
});
