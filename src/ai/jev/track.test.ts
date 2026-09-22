import { beforeEach, describe, expect, it, vi } from "vitest";
import { initAiSessions, aiSessions } from "../data/AiSessions";
import { judgeJev, JEV_ENDPOINT, JEV_MODEL, type JevQuestion } from "./client";
import {
    beginJevSession,
    isJevRecord,
    jevAnswerBlock,
    jevAnswersSummary,
    jevAnswerLine,
    jevQuestionLine,
    jevQuestionsSummary,
    jevStateSummary,
    JEV_QUESTION_SUMMARY_CAP,
    JEV_STATE_SUMMARY_CAP,
    type JevTrack,
} from "./track";
import type { JevHttpResponse } from "./transport";

/**
 * Jev 判定的会话登记（Issue #201）：判定落「AI 会话」面板的**生命周期**、
 * 摘要形态与失败路径。断言全落在登记簿真读出来的记录上（`aiSessions().list()`）
 * ——测的是登记结果，不是本模块的自述。
 */

vi.mock("../../ui/Notify", () => ({
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
    initNotify: (): void => undefined,
}));

const QS: JevQuestion[] = [{ kind: "noul", question: "答案唯一吗？" }];
const TRACK: JevTrack = { title: "Jev 质检 · 高等数学", group: { id: "g1", title: "转换 · 高等数学" } };

/** 可注入的 mock transport：按脚本回响应（同 client.test 口径）。 */
function mockTransport(script: JevHttpResponse[]) {
    let i = 0;
    return async (): Promise<JevHttpResponse> => script[Math.min(i++, script.length - 1)];
}

const noulBody = (p: number): string => JSON.stringify({ answers: { q0: { noul: p } } });

beforeEach(() => {
    initAiSessions({ load: async (): Promise<unknown> => ({}), save: async (): Promise<unknown> => undefined });
});

/** 登记簿里的唯一一条（读真快照）。 */
function only(): import("../data/AiSessions").AiSessionRecord {
    const all = aiSessions()!.list();
    expect(all.length).toBe(1);
    return all[0];
}

describe("登记生命周期（begin → succeed / fail）", () => {
    it("成功：kind=jev、model=JEV_MODEL、done、user=输入摘要、ai=类型化答案摘要", async () => {
        const answers = await judgeJev({
            state: "材料原文第一行\n第二行",
            questions: QS,
            apiKey: "sk-test",
            transport: mockTransport([{ status: 200, body: noulBody(0.93) }]),
            track: TRACK,
        });
        expect(answers).toEqual([{ kind: "noul", noul: 0.93 }]);

        const rec = only();
        expect(rec.kind).toBe("jev");
        expect(rec.model).toBe(JEV_MODEL);
        expect(rec.title).toBe("Jev 质检 · 高等数学");
        expect(rec.status).toBe("done");
        expect(rec.group).toBe("g1");
        expect(rec.groupTitle).toBe("转换 · 高等数学");
        expect(rec.turns[0]).toEqual({ role: "user", text: "材料原文第一行 · 第二行" });
        // 输出侧=判定值 + confidence（noul 只有概率；choice/score 带 confidence），
        // 后接「问题：」节（Issue #210）——两节编号同口径（位序 +1）
        expect(rec.turns[1]).toEqual({ role: "ai", text: "q1：是/否 0.93\n\n问题：\nq1 答案唯一吗？" });
        expect(rec.error).toBeUndefined();
    });

    it("失败：error 态记原样错误消息（401 之类面板能直接读到）", async () => {
        await expect(
            judgeJev({
                state: "s",
                questions: QS,
                apiKey: "bad",
                transport: mockTransport([{ status: 401, body: "unauthorized" }]),
                track: TRACK,
            })
        ).rejects.toThrow(/jev auth failed/);

        const rec = only();
        expect(rec.status).toBe("error");
        expect(rec.error).toContain("jev auth failed (401)");
        expect(rec.turns.map((t) => t.role)).toEqual(["user"]); // 无输出轮
        // 失败记录零变化（Issue #210 验收 4）：不带问题清单，只记错误消息
        expect(JSON.stringify(rec)).not.toContain("问题：");
        expect(JSON.stringify(rec)).not.toContain("答案唯一吗？");
    });

    it("协议错/网络错同样收口成 error（判定仍上抛，登记只旁听）", async () => {
        await expect(
            judgeJev({
                state: "s",
                questions: QS,
                apiKey: "sk",
                transport: mockTransport([{ status: 200, body: "not json" }]),
                track: TRACK,
            })
        ).rejects.toThrow(/protocol/);
        expect(only().status).toBe("error");
    });

    it("429 退避后成功：仍是一条记录（登记不随重试分叉）", async () => {
        await judgeJev({
            state: "s",
            questions: QS,
            apiKey: "sk",
            transport: mockTransport([
                { status: 429, body: "rate limited" },
                { status: 200, body: noulBody(0.9) },
            ]),
            sleep: async () => undefined,
            track: TRACK,
        });
        expect(aiSessions()!.list().length).toBe(1);
        expect(only().status).toBe("done");
    });

    it("不带 track = 零登记（纯逻辑单测与未接线环境零感知）", async () => {
        await judgeJev({
            state: "s",
            questions: QS,
            apiKey: "sk",
            transport: mockTransport([{ status: 200, body: noulBody(0.5) }]),
        });
        expect(aiSessions()!.list()).toEqual([]);
    });

    it("空 key 直接抛错：**不登记**（请求都没发出去，没有「这次判定」可记）", async () => {
        await expect(judgeJev({ state: "s", questions: QS, apiKey: "  ", track: TRACK })).rejects.toThrow(
            /未配置 Jev key/
        );
        expect(aiSessions()!.list()).toEqual([]);
    });

    it("登记簿未接线：track 照传也不炸（begin 返回 undefined）", async () => {
        // 绕过 beforeEach 的接线：本用例目的就是「未接线」形态
        vi.resetModules();
        const fresh = await import("./client");
        const answers = await fresh.judgeJev({
            state: "s",
            questions: QS,
            apiKey: "sk",
            transport: mockTransport([{ status: 200, body: noulBody(0.6) }]),
            track: TRACK,
        });
        expect(answers).toEqual([{ kind: "noul", noul: 0.6 }]);
    });
});

describe("摘要折算（纯函数）", () => {
    it("输入摘要：单行化 + 截断（超长补省略号）", () => {
        expect(jevStateSummary("a\n\n  b  ")).toBe("a · b");
        const long = "x".repeat(JEV_STATE_SUMMARY_CAP + 50);
        const out = jevStateSummary(long);
        expect(out.length).toBe(JEV_STATE_SUMMARY_CAP + 1);
        expect(out.endsWith("…")).toBe(true);
    });

    it("答案摘要：三型各自的结论 + 置信度；缺值印 `?` 不印 NaN", () => {
        expect(jevAnswerLine(0, { kind: "noul", noul: 0.93 })).toBe("q1：是/否 0.93");
        expect(jevAnswerLine(0, { kind: "noul", noul: Number.NaN })).toBe("q1：是/否 ?");
        expect(jevAnswerLine(1, { kind: "choice", choice: "甲", probabilities: {}, confidence: 0.9 })).toBe(
            "q2：甲（confidence 0.90）"
        );
        expect(jevAnswerLine(2, { kind: "score", score: 4, legend: {}, probabilities: {}, confidence: 0.7 })).toBe(
            "q3：4 档（confidence 0.70）"
        );
        expect(
            jevAnswersSummary([
                { kind: "noul", noul: 0.1 },
                { kind: "score", score: 2, legend: {}, probabilities: {}, confidence: 0.8 },
            ])
        ).toBe("q1：是/否 0.10\nq2：2 档（confidence 0.80）");
    });

    it("问题清单：一行一问 `qN 正文`（编号与答案行同口径：位序 +1）", () => {
        expect(
            jevQuestionsSummary([
                { kind: "noul", question: "第一问" },
                { kind: "score", question: "第二问", legend: {} },
            ])
        ).toBe("q1 第一问\nq2 第二问");
    });

    it("问题清单：正文超 80 字符截断补省略号，未超不动", () => {
        const short = "x".repeat(JEV_QUESTION_SUMMARY_CAP);
        expect(jevQuestionLine(short)).toBe(short);
        const long = "y".repeat(JEV_QUESTION_SUMMARY_CAP + 20);
        const out = jevQuestionLine(long);
        expect(out.length).toBe(JEV_QUESTION_SUMMARY_CAP + 1);
        expect(out.endsWith("…")).toBe(true);
        // 判定问句里的换行/缩进先单行化，免得一行变两行把两节错位
        expect(jevQuestionLine("  这题是否唯一？\n 即只有一个成立  ")).toBe("这题是否唯一？ 即只有一个成立");
    });

    it("回答块：答案行在前、空行、「问题：」节在后（按位序一一对应）", () => {
        const answers: import("./client").JevAnswer[] = [
            { kind: "noul", noul: 0.93 },
            { kind: "score", score: 4, legend: {}, probabilities: {}, confidence: 0.7 },
        ];
        const questions: import("./client").JevQuestion[] = [
            { kind: "noul", question: "答案唯一吗？" },
            { kind: "score", question: "总体质量如何？", legend: {} },
        ];
        expect(jevAnswerBlock(answers, questions)).toBe(
            "q1：是/否 0.93\nq2：4 档（confidence 0.70）\n\n问题：\nq1 答案唯一吗？\nq2 总体质量如何？"
        );
    });

    it("回答块：空问题清单不出问题节（登记不该凭空多一段空标题）", () => {
        expect(jevAnswerBlock([{ kind: "noul", noul: 0.1 }], [])).toBe("q1：是/否 0.10");
    });

    it("isJevRecord：只认 kind=jev（面板重试钮的排除面）", () => {
        expect(isJevRecord({ kind: "jev" } as never)).toBe(true);
        expect(isJevRecord({ kind: "judge" } as never)).toBe(false);
        expect(isJevRecord(undefined)).toBe(false);
    });

    it("beginJevSession：id 唯一、首轮即输入摘要（同跟踪两次不同记录）", () => {
        const a = beginJevSession(TRACK, "一");
        const b = beginJevSession(TRACK, "二");
        expect(a).toBeTruthy();
        expect(a).not.toBe(b);
        const ids = aiSessions()!
            .list()
            .map((r) => r.id);
        expect(ids).toContain(a!);
        expect(ids).toContain(b!);
    });
});

describe("回答块含问题清单（Issue #210）", () => {
    const QC: JevQuestion[] = [
        { kind: "noul", question: "这道题的正确答案是否唯一？" },
        { kind: "noul", question: "仅凭材料原文，题干与答案是否能够推出？" },
        { kind: "noul", question: "这道题是否与材料原文直接相关？" },
        { kind: "noul", question: "这道题的题型是否正确？" },
        { kind: "score", question: "这道题作为练习题的总体质量如何？", legend: { "4": "良好" } },
    ];
    const qcBody = (): string =>
        JSON.stringify({
            answers: {
                q0: { noul: 0.9 },
                q1: { noul: 0.8 },
                q2: { noul: 0.7 },
                q3: { noul: 0.6 },
                q4: { score: 4, confidence: 0.85 },
            },
        });

    it("质检五问：先答案行、后问题节，位序一一对应", async () => {
        await judgeJev({
            state: "题干：1+1=?",
            questions: QC,
            apiKey: "sk",
            transport: mockTransport([{ status: 200, body: qcBody() }]),
            track: TRACK,
        });
        const lines = only().turns[1].text.split("\n");
        expect(lines.slice(0, 5)).toEqual([
            "q1：是/否 0.90",
            "q2：是/否 0.80",
            "q3：是/否 0.70",
            "q4：是/否 0.60",
            "q5：4 档（confidence 0.85）",
        ]);
        expect(lines[5]).toBe("");
        expect(lines[6]).toBe("问题：");
        expect(lines[7]).toBe("q1 这道题的正确答案是否唯一？");
        expect(lines[8]).toBe("q2 仅凭材料原文，题干与答案是否能够推出？");
        expect(lines.slice(9)).toEqual([
            "q3 这道题是否与材料原文直接相关？",
            "q4 这道题的题型是否正确？",
            "q5 这道题作为练习题的总体质量如何？",
        ]);
    });

    it("长问句在登记文本里就截断（80 字符）", async () => {
        const longQ: JevQuestion = { kind: "noul", question: "问".repeat(JEV_QUESTION_SUMMARY_CAP + 5) };
        await judgeJev({
            state: "s",
            questions: [longQ],
            apiKey: "sk",
            transport: mockTransport([{ status: 200, body: noulBody(0.5) }]),
            track: TRACK,
        });
        const tail = only().turns[1].text.split("问题：\n")[1];
        expect(tail).toBe(`q1 ${"问".repeat(JEV_QUESTION_SUMMARY_CAP)}…`);
    });

    it("choice 落点（同义判定）同格式生效", async () => {
        const choiceQ: JevQuestion = { kind: "choice", question: "这两个词义相同吗？", options: ["相同", "不同"] };
        await judgeJev({
            state: "s",
            questions: [choiceQ],
            apiKey: "sk",
            transport: mockTransport([
                {
                    status: 200,
                    body: JSON.stringify({
                        answers: { q0: { choice: "相同", probabilities: { 相同: 0.9 }, confidence: 0.9 } },
                    }),
                },
            ]),
            track: TRACK,
        });
        expect(only().turns[1].text).toBe("q1：相同（confidence 0.90）\n\n问题：\nq1 这两个词义相同吗？");
    });

    it("登记簿 schema 零新增：轮次仍只有 role/text 两个键", async () => {
        await judgeJev({
            state: "s",
            questions: QS,
            apiKey: "sk",
            transport: mockTransport([{ status: 200, body: noulBody(0.5) }]),
            track: TRACK,
        });
        for (const t of only().turns) expect(Object.keys(t).sort()).toEqual(["role", "text"]);
    });
});

describe("通道红线（#201 复核）", () => {
    it("登记**不进全局在途闸**：判定不发 slotGate、不占生成式槽位", async () => {
        const { aiSlotUsage } = await import("../queue");
        const before = aiSlotUsage().used;
        await judgeJev({
            state: "s",
            questions: QS,
            apiKey: "sk",
            transport: mockTransport([{ status: 200, body: noulBody(0.5) }]),
            track: TRACK,
        });
        expect(aiSlotUsage().used).toBe(before);
        expect(aiSlotUsage().used).toBe(0);
    });

    it("端点与请求形状零变化（登记不改判定请求）", async () => {
        const seen: { url: string; payload: string }[] = [];
        await judgeJev({
            state: "s",
            questions: QS,
            apiKey: "sk",
            track: TRACK,
            transport: async (req) => {
                seen.push({ url: req.url, payload: req.payload });
                return { status: 200, body: noulBody(0.5) };
            },
        });
        expect(seen[0].url).toBe(JEV_ENDPOINT);
        expect((JSON.parse(seen[0].payload) as { model: string }).model).toBe(JEV_MODEL);
    });
});
