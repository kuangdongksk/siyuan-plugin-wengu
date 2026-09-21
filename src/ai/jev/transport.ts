/**
 * Jev（TypeSafe System One）传输层 —— 经内核 forwardProxy 转发（Issue #183）。
 *
 * 渲染进程直连 `https://api.typesafe.ai` 是跨域请求（CORS 不可靠），
 * 一律走内核 `/api/network/forwardProxy`（`EApi.ForwardProxy`）：
 * body `{url, method, headers, responseEncoding, payload, timeout}`，
 * **上游响应在 `data.body`**。见 `.agents/memory/kernel-pitfalls.md`「外部 API」节。
 *
 * ⚠️ **四条内核契约**（20260921 对内核源码 v3.8.0~v3.8.5-beta.2 逐版核对，
 * 并对照内核自带契约测试 `kernel/api/contract_network_test.go`）：
 *
 *  1. **`headers` 只认数组形态** `[{ "K": "v" }]`。
 *     3.8.0~3.8.3 是 `if headers, ok := arg["headers"].([]any); ok`；
 *     3.8.4+ 换成 `Headers []map[string]JSONValue`（契约式解码）。
 *     **传对象会静默失效**：断言失败 → 整块跳过 → 一个头都不设，
 *     且内核零报错、HTTP 仍 200 ⇒ 表现为「填了正确 key 也一律 401/403」，
 *     极难排查（#197 实测踩中）。退役的 MinerUClient 与旧文档都写的对象形态，
 *     转手即踩——**唯一落点是 `transportBodyOf`，单测钉死**。
 *  2. **`responseEncoding` 显式 `"text"`**：上游 JSON 走 UTF-8 文本回
 *     `data.body`（`bodyEncoding` 同回 `"text"`）。base64/hex 族是给二进制用的
 *     （内核 3.8.2 修过该字段的编码路径，上游 issue #18978）。
 *  3. **内核自身失败时 HTTP 仍是 200**（`code≠0` 走 `{code,msg,data:null}` 信封）
 *     ⇒ 必须读 `code`，只看 HTTP 状态会把内核报错当成上游空响应。
 *  4. **`payload` 只收 string**（内核只认文本，二进制过不去）。
 *     内核会给代理请求补 `Content-Type: application/json`，故本通道不必自带。
 *
 * 设计口径：
 *  - **可注入 mock**：单测不碰真网络（`JevTransportFn` 注入进 client；
 *    要验通道契约本身用 `kernelProxyTransportWith(post)` 换掉内核调用）；
 *  - **超时集中**：本模块是 Jev 通道超时值的唯一落点（调用点禁自造数字，
 *    `.agents/memory/ai.md` 口径）；
 *  - **串行**：内核 `fetchSyncPost` 并发会互相吞响应（真机坑，AGENTS.md
 *    「fetchSyncPost 必须串行」），故本通道自带串行链——多落点同时发起判定时
 *    排队，不会互相吞。
 */
import { fetchSyncPost, type IWebSocketData } from "siyuan";
import { EApi } from "../../siyuan/api";

/** Jev 通道超时（毫秒）：判定模型是短请求，档位远低于生成式 AI。 */
export const JEV_TIMEOUT_MS = {
    /** 单次判定（上游亚秒级，留足网络与队列余量）。 */
    judge: 30_000,
    /** 退避重试前的等待（429/529 时）。 */
    backoff: 5_000,
} as const;

/** 上游响应：状态码 + 原文。status<=0 表示**没拿到响应**（网络/内核层失败）。 */
export interface JevHttpResponse {
    status: number;
    body: string;
}

/** 单笔转发请求（client 组装；本模块翻译成内核 body）。 */
export interface JevProxyRequest {
    url: string;
    method: "POST";
    headers: Record<string, string>;
    /** JSON 序列化后的请求体（内核只收 string）。 */
    payload: string;
    timeout: number;
}

/** 传输函数签名（可注入 mock 的接缝）：只认「发出去什么」与「拿回什么」。 */
export type JevTransportFn = (req: JevProxyRequest) => Promise<JevHttpResponse>;

/** 内核调用注入点（单测替换，免 mock 整个 `siyuan` 模块）：返回内核信封。 */
export type KernelPostFn = (path: string, body: Record<string, unknown>) => Promise<IWebSocketData>;

/** 内核 forwardProxy 请求体：`headers` **数组形态** + `responseEncoding: "text"`
 *  （契约 1/2 见文件头注）。**本函数是本通道契约的唯一落点，单测钉死。** */
export function transportBodyOf(req: JevProxyRequest): Record<string, unknown> {
    return {
        url: req.url,
        method: req.method,
        // ⚠️ 数组形态：对象形态被内核类型断言丢弃 → 鉴权头到不了上游（表现为一律 401/403）
        headers: [req.headers],
        // ⚠️ 显式 text：上游 JSON 按 UTF-8 文本回 data.body
        responseEncoding: "text",
        payload: req.payload,
        timeout: req.timeout,
    };
}

/** 上游 body 解码（契约 2 的兜底路径）。
 *
 *  正常路径：请求显式 `responseEncoding: "text"`，内核按 UTF-8 文本回 string
 *  （`bodyEncoding` 同回 `"text"`）。两条兜底，均由单测钉死：
 *   1. **内核回了编码态**（`bodyEncoding` 是 base64/hex 族——请求被改道或版本差异）：
 *      按该编码解回文本；解不出的（base32 族）原样返回，交由 client 的 JSON
 *      解析层报协议错——**不静默吞**。
 *   2. **body 已是解析对象**（版本差异）：序列化回文本。
 *  二进制/非 UTF-8 场景不在本通道内（判定请求与响应都是 JSON）。 */
export function decodeProxyBody(body: unknown, encoding?: unknown): string {
    const raw = typeof body === "string" ? body : body == null ? "" : serializeBody(body);
    const enc = typeof encoding === "string" ? encoding : "text";
    if (enc === "text" || !raw) return raw;
    try {
        if (enc === "base64" || enc === "base64-std") return atob(raw);
        if (enc === "base64-url") return atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
        if (enc === "hex") return hexToText(raw);
    } catch (_) {
        // 解码失败：返回原文，让 JSON 解析层统一报协议错（附原文便于排查）
    }
    return raw;
}

/** 已解析对象 → 文本（版本差异兜底；循环引用等极端形态退回 String）。 */
function serializeBody(body: unknown): string {
    try {
        return JSON.stringify(body) ?? "";
    } catch (_) {
        return String(body);
    }
}

/** hex → UTF-8 文本（与内核 `payloadEncoding: "hex"` 对称的解码）。 */
function hexToText(hex: string): string {
    const bytes = (hex.match(/.{1,2}/g) ?? []).map((p) => Number.parseInt(p, 16));
    if (bytes.some((b) => Number.isNaN(b))) return hex;
    return new TextDecoder().decode(new Uint8Array(bytes));
}

/** 内核信封 → 上游状态 + 原文（契约 3：内核失败时 HTTP 仍 200，必须读 `code`）。
 *  内核层失败折算 `status: 0`（client 按网络错误统一处置），并把内核 `msg`
 *  带出来当诊断——丢掉它会让内核报错伪装成「上游空响应」。 */
export function readProxyResult(res: IWebSocketData | undefined): JevHttpResponse {
    const data = (res?.data ?? null) as { body?: unknown; status?: unknown; bodyEncoding?: unknown } | null;
    if (!data || Number(res?.code ?? -1) !== 0) {
        const msg = String(res?.msg ?? "").trim();
        return { status: 0, body: msg ? `内核转发失败：${msg}` : "内核转发失败（无响应数据）" };
    }
    return { status: Number(data.status ?? 0) || 0, body: decodeProxyBody(data.body, data.bodyEncoding) };
}

/** 串行链：内核 `fetchSyncPost` 并发会互相吞响应（真机坑），判定请求一律排队。 */
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = chain.then(task, task);
    chain = next.catch((): void => undefined);
    return next;
}

/** 内核转发传输（可换内核调用实现）。本模块**不抛错**——一切失败都折算成
 *  `status: 0`，由 client 按网络错误统一处置（超时/断网/内核异常同一口径）。 */
export function kernelProxyTransportWith(post: KernelPostFn): JevTransportFn {
    return (req) =>
        enqueue(async (): Promise<JevHttpResponse> => {
            try {
                return readProxyResult(await post(EApi.ForwardProxy, transportBodyOf(req)));
            } catch (_) {
                return { status: 0, body: "" };
            }
        });
}

/** 默认传输：真机走内核 `fetchSyncPost`。 */
export const kernelProxyTransport: JevTransportFn = kernelProxyTransportWith((path, body) => fetchSyncPost(path, body));
