/**
 * Jev 判定客户端（Issue #183）：`judgeJev(questions)` → `POST /v1/systemone`。
 *
 * 通道一律经 `transport.ts` 的内核 forwardProxy（渲染进程不直连外部域）；
 * 本模块只负责「请求组装 → 状态码政策 → 响应解析 → 类型化答案」。
 *
 * 线格式（**权威实证** = `.cnb/scripts/jev-pr-review.mjs`，同一端点
 * `https://api.typesafe.ai/v1/systemone` + `jev-latest` 在 CI 真跑通过，
 * 标定 7/7）：
 *  - 请求 `questions` 是**按名对象**（`{ <问题名>: {...} }`），不是数组；
 *    单题字段 `{type, instructions, criteria}`——
 *    choice→`criteria` 为「选项→描述」对象、noul→`{true, false}`、
 *    score→档位描述**字符串数组**；
 *  - 响应 `answers` 同样按名索引（`answers.<问题名>.choice/.noul/.score/.confidence`）。
 *  插件内部 API 仍收 `JevQuestion[]` / 返回 `JevAnswer[]`（保持位序），
 *  按名组装与取回在 `wireQuestions` / `parseAnswers` 内收口，调用方无感。
 *
 * 与 ai 域既有通道的关系（红线）：
 *  - **不登记 AI 会话面板**：判定不是对话，不产生可回看的产出，登记只会
 *    污染面板的类别树（见 AGENTS.md「AI 会话登记」节）；
 *  - **不走 agentChatOnce/agentChatContinued 与全局在途闸**：那是生成式
 *    通道的机制；判定请求短、廉价，且各落点自带「低置信回落现状」，
 *    并发交由各落点自行节流（一次请求问完，见规划稿 §二 纪律 5）。
 *
 * 错误政策（Issue #183 需求 2）：
 *  - 401/403            → 抛 `JevAuthError`（key 无效，调用方提示换 key）；
 *  - 429/529            → 退避 `JEV_TIMEOUT_MS.backoff` 重试**一次**，
 *    再败抛 `JevUpstreamError`（带 status）；
 *  - 其余非 2xx / 网络  → 抛 `JevUpstreamError` / `JevNetworkError`；
 *  - 200 但 JSON 坏/形状不对 → 抛 `JevProtocolError`。
 *  以上全部由**调用方降级**（本模块从不静默返回假答案）。
 */
import { JEV_TIMEOUT_MS, kernelProxyTransport, type JevHttpResponse, type JevTransportFn } from "./transport";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/** 模型 id（判定模型档位，规划稿口径）。 */
export const JEV_MODEL = "jev-latest";

/** 退避重试的状态码：限流/过载（429 Too Many Requests、529 Overloaded）。 */
const RETRY_STATUS = new Set([429, 529]);

/* ── 问题类型（Jev 原生三型：noul / choice / score） ── */

/** 是/否问题：答案是 0~1 的概率。 */
export interface JevNoulQuestion {
    kind: "noul";
    /** 问题正文（线上字段名 `instructions`）。 */
    question: string;
}

/** 单选题：从 `options` 里挑一个，附各选项概率与总体置信度。 */
export interface JevChoiceQuestion {
    kind: "choice";
    question: string;
    /** 选项清单（线上组装成 `criteria` 的「选项→描述」对象，描述取选项原文）。 */
    options: string[];
}

/** 打分题：`legend` 把 1~5 档写成具体情形描述。 */
export interface JevScoreQuestion {
    kind: "score";
    question: string;
    /** 档位描述表（档位键 → 情形描述）；线上取**描述值**组装成字符串数组 `criteria`。 */
    legend: Record<string, string>;
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

/* ── 答案类型（与问题一一对应） ── */

export interface JevNoulAnswer {
    kind: "noul";
    /** 0~1：模型认为「是」的概率。 */
    noul: number;
}

export interface JevChoiceAnswer {
    kind: "choice";
    /** 选中项原文（与 options 逐字对应）。 */
    choice: string;
    /** 选项 → 概率。 */
    probabilities: Record<string, number>;
    confidence: number;
}

export interface JevScoreAnswer {
    kind: "score";
    /** 分值（1~5，与 legend 的键对应）。 */
    score: number;
    legend: Record<string, string>;
    probabilities: Record<string, number>;
    confidence: number;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

/* ── 错误类型 ── */

/** key 无效/无权（401/403）——调用方应提示用户检查设置里的 Jev key。 */
export class JevAuthError extends Error {
    constructor(
        public readonly status: number,
        detail: string
    ) {
        super(`jev auth failed (${status}): ${detail}`);
        this.name = "JevAuthError";
    }
}

/** 上游错误（非 2xx，含重试后仍失败的 429/529）。 */
export class JevUpstreamError extends Error {
    constructor(
        public readonly status: number,
        detail: string
    ) {
        super(`jev upstream error (${status}): ${detail}`);
        this.name = "JevUpstreamError";
    }
}

/** 网络层失败（没拿到响应：内核转发失败/超时/断网）。 */
export class JevNetworkError extends Error {
    constructor(detail: string) {
        super(`jev network error: ${detail}`);
        this.name = "JevNetworkError";
    }
}

/** 响应形状不符（200 但 JSON 坏 / 缺答案字段）——协议层问题，别当「不确定」吞掉。 */
export class JevProtocolError extends Error {
    constructor(detail: string) {
        super(`jev protocol error: ${detail}`);
        this.name = "JevProtocolError";
    }
}

/* ── 请求体组装（线上：按名对象 + instructions/criteria） ── */

/** 线上问题名：按输入位序生成（`q0..qN`），仅用于请求/响应配对，不外泄给调用方。 */
export function wireQuestionName(index: number): string {
    return `q${index}`;
}

/** 单题线上形态：`{type, instructions, criteria}`（三型 cri 形态各异，见头注）。 */
function wireQuestion(q: JevQuestion): Record<string, unknown> {
    if (q.kind === "choice") {
        const criteria: Record<string, string> = {};
        for (const opt of q.options) criteria[opt] = opt;
        return { type: "choice", instructions: q.question, criteria };
    }
    if (q.kind === "score") {
        return { type: "score", instructions: q.question, criteria: Object.values(q.legend) };
    }
    return {
        type: "noul",
        instructions: q.question,
        criteria: { true: "是", false: "否" },
    };
}

/** 问题清单 → 线上**按名对象**（位序即 `q0..qN`，与 `parseAnswers` 对称）。 */
export function wireQuestions(qs: JevQuestion[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    qs.forEach((q, i) => {
        out[wireQuestionName(i)] = wireQuestion(q);
    });
    return out;
}

/** 单次判定请求体：一次请求问完（纪律 5），state 由调用方给。 */
export function buildJudgeBody(opts: { state: string; questions: JevQuestion[] }): Record<string, unknown> {
    return {
        model: JEV_MODEL,
        state: opts.state,
        questions: wireQuestions(opts.questions),
    };
}

/* ── 响应解析 ── */

/** 取概率数值：非有限数归一为 undefined，由 policy 层按「不确定」处置。 */
function numOrUndefined(v: unknown): number | undefined {
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** 概率表：只收数值项，坏项丢弃（不因一项坏就废整批）。 */
function probMap(v: unknown): Record<string, number> {
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
        const n = numOrUndefined(raw);
        if (n !== undefined) out[k] = n;
    }
    return out;
}

/** 单条答案解析：问题类型与答案类型必须一致，否则是协议错。 */
function parseAnswer(q: JevQuestion, raw: unknown): JevAnswer {
    const a = (raw ?? {}) as Record<string, unknown>;
    if (q.kind === "noul") {
        const p = numOrUndefined(a.noul);
        // 概率非数（null/字符串）：**别当协议错**——协议错是「结构不对」，
        // 这里是「值不可用」，按不确定处置（policy 侧 NaN 同口径）
        if (p === undefined && a.noul !== null && a.noul !== undefined) {
            throw new JevProtocolError(`noul 答案概率非数：${JSON.stringify(raw).slice(0, 120)}`);
        }
        return { kind: "noul", noul: p ?? Number.NaN };
    }
    if (q.kind === "choice") {
        if (typeof a.choice !== "string" || !a.choice) throw new JevProtocolError("choice 答案缺选中项");
        return {
            kind: "choice",
            choice: a.choice,
            probabilities: probMap(a.probabilities),
            confidence: numOrUndefined(a.confidence) ?? 0,
        };
    }
    const score = numOrUndefined(a.score);
    if (score === undefined) throw new JevProtocolError("score 答案缺分值");
    return {
        kind: "score",
        score,
        legend: probMapText(a.legend),
        probabilities: probMap(a.probabilities),
        confidence: numOrUndefined(a.confidence) ?? 0,
    };
}

/** legend 是「档位 → 情形描述」的文本表（不是概率表，别用 probMap）。 */
function probMapText(v: unknown): Record<string, string> {
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, raw] of Object.entries(v as Record<string, unknown>)) out[k] = String(raw ?? "");
    return out;
}

/**
 * 上游 body 取 `answers` **按名对象**，按输入位序取回。
 * **缺名/多题都判协议错**（口径：`q0..qN` 必须一一对应）——
 * 缺名是模型漏答、多题是上游串了别人的答案，两者都不能静默补齐/截断。
 */
function parseAnswers(qs: JevQuestion[], body: string): JevAnswer[] {
    let json: unknown;
    try {
        json = JSON.parse(body);
    } catch (_) {
        throw new JevProtocolError(`响应非 JSON：${body.slice(0, 120)}`);
    }
    const answers = (json as { answers?: unknown } | null)?.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
        throw new JevProtocolError("响应缺 answers 按名对象");
    }
    const table = answers as Record<string, unknown>;
    const names = Object.keys(table);
    // 先卡总数：多题（含串名）在这里就拦下，别让多余答案悄悄溜过
    if (names.length !== qs.length) {
        throw new JevProtocolError(`答案条数不匹配：问 ${qs.length} 条、回 ${names.length} 条`);
    }
    return qs.map((q, i) => {
        const name = wireQuestionName(i);
        if (!Object.prototype.hasOwnProperty.call(table, name)) {
            throw new JevProtocolError(`答案缺 ${name}（回 ${names.length} 条、问 ${qs.length} 条）`);
        }
        return parseAnswer(q, table[name]);
    });
}

/* ── 主入口 ── */

export interface JudgeJevOpts {
    /** 判定所依据的材料（题目 + 材料原文等）。 */
    state: string;
    questions: JevQuestion[];
    /** API key（空串即未配置，直接抛 auth 错——总闸在 isJevEnabled，这里兜底）。 */
    apiKey: string;
    /** 传输注入（单测用 mock）；缺省走内核 forwardProxy。 */
    transport?: JevTransportFn;
    /** 退避等待注入（单测避免真睡）。 */
    sleep?: (ms: number) => Promise<void>;
    /** 请求超时（缺省 JEV_TIMEOUT_MS.judge，调用点禁自造）。 */
    timeout?: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 一次判定请求：`state` + 一组独立问题 → 与问题一一对应的类型化答案。
 * 顺序与 `questions` 严格对应（线上按名问答，`q0..qN` 由本模块生成，调用方无感）。
 */
export async function judgeJev(opts: JudgeJevOpts): Promise<JevAnswer[]> {
    const key = opts.apiKey.trim();
    if (!key) throw new JevAuthError(401, "未配置 Jev key");
    const transport = opts.transport ?? kernelProxyTransport;
    const sleep = opts.sleep ?? realSleep;
    const timeout = opts.timeout ?? JEV_TIMEOUT_MS.judge;
    const payload = JSON.stringify(buildJudgeBody({ state: opts.state, questions: opts.questions }));
    const req = {
        url: JEV_ENDPOINT,
        method: "POST" as const,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        payload,
        timeout,
    };

    let res: JevHttpResponse = await transport(req);
    if (RETRY_STATUS.has(res.status)) {
        // 限流/过载：退避一次。第二次仍 429/529 由下面的统一分支上抛
        await sleep(JEV_TIMEOUT_MS.backoff);
        res = await transport(req);
    }
    return handleResponse(opts.questions, res);
}

/** 状态码政策（与重试解耦，便于单测直击各分支）。 */
export function handleResponse(qs: JevQuestion[], res: JevHttpResponse): JevAnswer[] {
    if (res.status <= 0) throw new JevNetworkError(res.body || "无响应");
    if (res.status === 401 || res.status === 403) throw new JevAuthError(res.status, res.body.slice(0, 200));
    if (res.status < 200 || res.status >= 300) throw new JevUpstreamError(res.status, res.body.slice(0, 200));
    return parseAnswers(qs, res.body);
}
