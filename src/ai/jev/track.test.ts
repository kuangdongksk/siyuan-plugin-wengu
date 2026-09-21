import { beforeEach, describe, expect, it, vi } from "vitest";
import { initAiSessions, aiSessions } from "../data/AiSessions";
import { judgeJev, JEV_ENDPOINT, JEV_MODEL, type JevQuestion } from "./client";
import {
    beginJevSession,
    isJevRecord,
    jevAnswersSummary,
    jevAnswerLine,
    jevStateSummary,
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
        // 输出侧=判定值 + confidence（noul 只有概率；choice/score 带 confidence）
        expect(rec.turns[1]).toEqual({ role: "ai", text: "q1：是/否 0.93" });
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
