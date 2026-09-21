import { describe, expect, it } from "vitest";
import {
    JEV_ENDPOINT,
    JEV_MODEL,
    judgeJev,
    JevAuthError,
    JevNetworkError,
    JevProtocolError,
    JevUpstreamError,
    type JevAnswer,
    type JevQuestion,
} from "./client";
import {
    JEV_TIMEOUT_MS,
    decodeProxyBody,
    kernelProxyTransportWith,
    readProxyResult,
    transportBodyOf,
    type JevHttpResponse,
} from "./transport";
import { EApi } from "../../siyuan/api";
import { noulVerdict, choiceLowConfidence, scoreLowConfidence } from "./policy";

/** 单题 noul（判定请求主体与断言都短）。 */
const QS: JevQuestion[] = [{ kind: "noul", question: "答案唯一吗？" }];

/** 造一个可注入的 mock transport：按脚本逐次回响应，并记录每次请求。 */
function mockTransport(script: JevHttpResponse[]) {
    const calls: { url: string; payload: string; headers: Record<string, string>; timeout: number }[] = [];
    let i = 0;
    const fn = async (req: { url: string; payload: string; headers: Record<string, string>; timeout: number }) => {
        calls.push(req);
        const res = script[Math.min(i, script.length - 1)];
        i++;
        return res;
    };
    return { fn, calls };
}

/** 正常响应体：`answers` 是**按名对象**（`q0..`，与请求的按名 questions 对称）。 */
const noulBody = (p: number): string => JSON.stringify({ answers: { q0: { noul: p } } });

describe("Jev 客户端（judgeJev）", () => {
    it("正常解析：走注入 transport、URL/模型/鉴权头/payload 契约齐备", async () => {
        const { fn, calls } = mockTransport([{ status: 200, body: noulBody(0.93) }]);
        const answers = await judgeJev({ state: "材料原文", questions: QS, apiKey: "sk-test", transport: fn });

        expect(calls.length).toBe(1);
        // 请求形状：forwardProxy 传的是上游 URL，payload 必须是 string（内核只收 string）
        expect(calls[0].url).toBe(JEV_ENDPOINT);
        expect(typeof calls[0].payload).toBe("string");
        expect(calls[0].headers.Authorization).toBe("Bearer sk-test");
        expect(calls[0].timeout).toBe(JEV_TIMEOUT_MS.judge);
        const sent = JSON.parse(calls[0].payload) as Record<string, unknown>;
        expect(sent.model).toBe(JEV_MODEL);
        expect(sent.state).toBe("材料原文");
        // 线格式（生产实证，见 .cnb/scripts/jev-pr-review.mjs）：questions 是按名对象
        expect(Array.isArray(sent.questions)).toBe(false);
        expect(sent.questions).toEqual({
            q0: { type: "noul", instructions: "答案唯一吗？", criteria: { true: "是", false: "否" } },
        });

        expect(answers).toEqual([{ kind: "noul", noul: 0.93 }]);
    });

    it("401 → JevAuthError（key 无效），不重试", async () => {
        const { fn, calls } = mockTransport([{ status: 401, body: "unauthorized" }]);
        await expect(judgeJev({ state: "s", questions: QS, apiKey: "bad", transport: fn })).rejects.toBeInstanceOf(
            JevAuthError
        );
        expect(calls.length).toBe(1);
    });

    it("403 → JevAuthError（无权）", async () => {
        const { fn } = mockTransport([{ status: 403, body: "forbidden" }]);
        const err = await judgeJev({ state: "s", questions: QS, apiKey: "bad", transport: fn }).catch((e) => e);
        expect(err).toBeInstanceOf(JevAuthError);
        expect((err as JevAuthError).status).toBe(403);
    });

    it("429 退避一次后成功：退避时长取常量、两次请求同形", async () => {
        const { fn, calls } = mockTransport([
            { status: 429, body: "rate limited" },
            { status: 200, body: noulBody(0.9) },
        ]);
        const sleeps: number[] = [];
        const answers = await judgeJev({
            state: "s",
            questions: QS,
            apiKey: "sk",
            transport: fn,
            sleep: async (ms) => {
                sleeps.push(ms);
            },
        });
        expect(sleeps).toEqual([JEV_TIMEOUT_MS.backoff]);
        expect(calls.length).toBe(2);
        expect(calls[0].payload).toBe(calls[1].payload);
        expect(noulVerdict((answers[0] as { noul: number }).noul)).toBe("yes");
    });

    it("429 两次失败 → JevUpstreamError（不再重试第三次）", async () => {
        const { fn, calls } = mockTransport([
            { status: 429, body: "rate limited" },
            { status: 429, body: "rate limited" },
        ]);
        const err = await judgeJev({
            state: "s",
            questions: QS,
            apiKey: "sk",
            transport: fn,
            sleep: async () => undefined,
        }).catch((e) => e);
        expect(err).toBeInstanceOf(JevUpstreamError);
        expect((err as JevUpstreamError).status).toBe(429);
        expect(calls.length).toBe(2);
    });

    it("529 过载同样退避一次", async () => {
        const { fn, calls } = mockTransport([
            { status: 529, body: "overloaded" },
            { status: 200, body: noulBody(0.1) },
        ]);
        const answers = await judgeJev({
            state: "s",
            questions: QS,
            apiKey: "sk",
            transport: fn,
            sleep: async () => undefined,
        });
        expect(calls.length).toBe(2);
        expect(noulVerdict((answers[0] as { noul: number }).noul)).toBe("no");
    });

    it("网络错误（status 0）→ JevNetworkError", async () => {
        const { fn } = mockTransport([{ status: 0, body: "" }]);
        await expect(judgeJev({ state: "s", questions: QS, apiKey: "sk", transport: fn })).rejects.toBeInstanceOf(
            JevNetworkError
        );
    });

    it("500 → JevUpstreamError（其余非 2xx 上抛，由调用方降级）", async () => {
        const { fn } = mockTransport([{ status: 500, body: "boom" }]);
        await expect(judgeJev({ state: "s", questions: QS, apiKey: "sk", transport: fn })).rejects.toBeInstanceOf(
            JevUpstreamError
        );
    });

    it("200 但 JSON 坏 / answers 非按名对象 / 缺名 / 多题 → JevProtocolError", async () => {
        const cases = [
            "not json",
            JSON.stringify({ answers: [] }), // 匿名数组：旧口径，已不合法
            JSON.stringify({ answers: {} }), // 空对象：q0 缺失
            JSON.stringify({ answers: { q1: { noul: 0.5 } } }), // 名不匹配：回了 q1、缺 q0
            JSON.stringify({ answers: { q0: { noul: 0.5 }, q1: { noul: 0.5 } } }), // 多题：q0 在但多回 q1
            JSON.stringify({}), // 无 answers 键
        ];
        for (const body of cases) {
            const { fn } = mockTransport([{ status: 200, body }]);
            await expect(judgeJev({ state: "s", questions: QS, apiKey: "sk", transport: fn })).rejects.toBeInstanceOf(
                JevProtocolError
            );
        }
    });

    it("空 key 直接 JevAuthError（不发请求）", async () => {
        const { fn, calls } = mockTransport([{ status: 200, body: noulBody(0.5) }]);
        await expect(judgeJev({ state: "s", questions: QS, apiKey: "  ", transport: fn })).rejects.toBeInstanceOf(
            JevAuthError
        );
        expect(calls.length).toBe(0);
    });

    it("一批多问（noul/choice/score）逐条解析、顺序与提问一致", async () => {
        const qs: JevQuestion[] = [
            { kind: "noul", question: "可推出？" },
            { kind: "choice", question: "哪个是同一概念？", options: ["甲", "乙", "不同"] },
            { kind: "score", question: "出题价值？", legend: { "1": "目录", "5": "定义密集" } },
        ];
        const body = JSON.stringify({
            answers: {
                q0: { noul: 0.85 },
                q1: { choice: "甲", probabilities: { 甲: 0.9, 乙: 0.05, 不同: 0.05 }, confidence: 0.9 },
                q2: {
                    score: 4,
                    legend: { "1": "目录", "5": "定义密集" },
                    probabilities: { "4": 0.8 },
                    confidence: 0.75,
                },
            },
        });
        const { fn, calls } = mockTransport([{ status: 200, body }]);
        const answers = (await judgeJev({ state: "s", questions: qs, apiKey: "sk", transport: fn })) as JevAnswer[];
        // 三型单题线格式：choice→criteria 选项对象、score→档位描述字符串数组
        expect((JSON.parse(calls[0].payload) as { questions: Record<string, unknown> }).questions).toEqual({
            q0: { type: "noul", instructions: "可推出？", criteria: { true: "是", false: "否" } },
            q1: {
                type: "choice",
                instructions: "哪个是同一概念？",
                criteria: { 甲: "甲", 乙: "乙", 不同: "不同" },
            },
            q2: {
                type: "score",
                instructions: "出题价值？",
                criteria: ["目录", "定义密集"],
            },
        });
        expect(answers.map((a) => a.kind)).toEqual(["noul", "choice", "score"]);
        const choice = answers[1] as { choice: string; confidence: number };
        expect(choice.choice).toBe("甲");
        expect(choiceLowConfidence(choice.confidence)).toBe(false);
        const score = answers[2] as { score: number; confidence: number };
        expect(score.score).toBe(4);
        expect(scoreLowConfidence(score.confidence)).toBe(false);
    });

    it("置信度/概率缺失按「低置信」处置（不静默当明确）", async () => {
        const body = JSON.stringify({
            answers: {
                q0: { choice: "甲", probabilities: { 甲: "高" }, confidence: undefined },
                q1: { score: 3, legend: {}, probabilities: {}, confidence: null },
                q2: { noul: null },
            },
        });
        const qs: JevQuestion[] = [
            { kind: "choice", question: "?", options: ["甲"] },
            { kind: "score", question: "?", legend: {} },
            { kind: "noul", question: "?" },
        ];
        const { fn } = mockTransport([{ status: 200, body }]);
        const answers2 = (await judgeJev({
            state: "s",
            questions: qs,
            apiKey: "sk",
            transport: fn,
        })) as JevAnswer[];
        const [c, s] = answers2;
        expect(choiceLowConfidence((c as { confidence: number }).confidence)).toBe(true);
        expect(scoreLowConfidence((s as { confidence: number }).confidence)).toBe(true);
        const n = answers2[2] as { noul: number };
        expect(Number.isNaN(n.noul)).toBe(true);
        expect(noulVerdict(n.noul)).toBe("unsure");
    });
});

describe("transport 通道契约（内核 forwardProxy / Issue #197）", () => {
    it("string 直用；已解析对象序列化兜底；空值归空串", () => {
        expect(decodeProxyBody('{"a":1}')).toBe('{"a":1}');
        expect(decodeProxyBody({ a: 1 })).toBe('{"a":1}');
        expect(decodeProxyBody(null)).toBe("");
        expect(decodeProxyBody(undefined)).toBe("");
    });

    it("内核回编码态（bodyEncoding）时按编码解回文本；解不出原样返回待协议层报错", () => {
        const text = '{"answers":{"q0":{"noul":0.9}}}';
        expect(decodeProxyBody(btoa(text), "base64")).toBe(text);
        expect(decodeProxyBody(btoa(text), "base64-std")).toBe(text);
        const hex = [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join("");
        expect(decodeProxyBody(hex, "hex")).toBe(text);
        // 非 UTF-8 语义的编码（base32）解不了：原样返回，由 JSON 解析层报协议错
        expect(decodeProxyBody("MFRGG", "base32")).toBe("MFRGG");
        expect(decodeProxyBody(text)).toBe(text);
        expect(decodeProxyBody(text, "text")).toBe(text);
    });

    it("内核 body 契约：headers 数组形态 + responseEncoding text + string payload", () => {
        const body = transportBodyOf({
            url: JEV_ENDPOINT,
            method: "POST",
            headers: { Authorization: "Bearer k" },
            payload: '{"a":1}',
            timeout: 1000,
        });
        // 内核按 `arg["headers"].([]any)`（3.8.0~3.8.3）/`[]map[string]JSONValue`
        // （3.8.4+）取头——**只认数组**；对象会被断言丢弃、静默不设任何头（#197 根因）
        expect(body.headers).toEqual([{ Authorization: "Bearer k" }]);
        expect(Array.isArray(body.headers)).toBe(true);
        expect(body.responseEncoding).toBe("text");
        expect(typeof body.payload).toBe("string");
        expect(body.url).toBe(JEV_ENDPOINT);
        expect(body.method).toBe("POST");
    });

    it("内核信封解读：成功取 data.status/data.body；内核失败折算网络错并带 msg", () => {
        expect(readProxyResult({ code: 0, msg: "", data: { status: 200, body: '{"ok":1}' } })).toEqual({
            status: 200,
            body: '{"ok":1}',
        });
        // 内核回编码态时也解回文本（bodyEncoding 契约）
        expect(
            readProxyResult({ code: 0, msg: "", data: { status: 200, body: "eyJvayI6MX0=", bodyEncoding: "base64" } })
        ).toEqual({ status: 200, body: '{"ok":1}' });
        // 内核自身失败时 HTTP 仍是 200，只有 code≠0 —— 必须读 code，并把 msg 带出来
        const failed = readProxyResult({ code: 8, msg: "forward request failed: timeout", data: null });
        expect(failed.status).toBe(0);
        expect(failed.body).toContain("timeout");
        expect(readProxyResult(undefined).status).toBe(0);
    });

    it("内核 transport 真发到 EApi.ForwardProxy，且并发串行（不互相吞）", async () => {
        const paths: string[] = [];
        const seen: Record<string, unknown>[] = [];
        let inFlight = 0;
        let peak = 0;
        const transport = kernelProxyTransportWith(async (path, body) => {
            paths.push(path);
            seen.push(body);
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 1));
            inFlight--;
            return { code: 0, msg: "", data: { status: 200, body: noulBody(0.7) } };
        });
        const req = {
            url: JEV_ENDPOINT,
            method: "POST" as const,
            headers: { Authorization: "Bearer k" },
            payload: JSON.stringify({ hi: 1 }),
            timeout: JEV_TIMEOUT_MS.judge,
        };
        const results = await Promise.all([transport(req), transport(req), transport(req)]);
        // 契约断言**无条件执行**（不得写成「mock 没被调到就跳过」——那会让通道失效静默通过）
        expect(paths).toEqual([EApi.ForwardProxy, EApi.ForwardProxy, EApi.ForwardProxy]);
        expect(seen[0]).toEqual(transportBodyOf(req));
        expect(peak).toBe(1); // 串行：内核 fetchSyncPost 并发互吞
        expect(results.every((r) => r.status === 200)).toBe(true);
    });

    it("内核抛错（网络/超时）折算 status 0，不向上抛", async () => {
        const transport = kernelProxyTransportWith(async () => {
            throw new Error("Failed to fetch");
        });
        const res = await transport({
            url: JEV_ENDPOINT,
            method: "POST",
            headers: {},
            payload: "{}",
            timeout: 1,
        });
        expect(res.status).toBe(0);
    });
});

describe("policy 阈值边界", () => {
    it("noul 三档边界：0.8/0.2 归明确侧，其间不确定", () => {
        expect(noulVerdict(0.8)).toBe("yes");
        expect(noulVerdict(0.79)).toBe("unsure");
        expect(noulVerdict(0.2)).toBe("no");
        expect(noulVerdict(0.21)).toBe("unsure");
        expect(noulVerdict(undefined)).toBe("unsure");
        expect(noulVerdict(Number.NaN)).toBe("unsure");
    });

    it("choice 低置信边界：0.5", () => {
        expect(choiceLowConfidence(0.5)).toBe(false);
        expect(choiceLowConfidence(0.49)).toBe(true);
        expect(choiceLowConfidence(undefined)).toBe(true);
    });

    it("score 低置信边界：0.7", () => {
        expect(scoreLowConfidence(0.7)).toBe(false);
        expect(scoreLowConfidence(0.69)).toBe(true);
        expect(scoreLowConfidence(undefined)).toBe(true);
    });
});
