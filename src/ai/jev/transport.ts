/**
 * Jev（TypeSafe System One）传输层 —— 经内核 forwardProxy 转发（Issue #183）。
 *
 * 渲染进程直连 `https://api.typesafe.ai` 是跨域请求（CORS 不可靠），
 * 一律走内核 `/api/network/forwardProxy`（`EApi.ForwardProxy`）：
 * body `{url, method, headers, payload?, timeout}`，**上游响应在 `data.body`**。
 * 见 `.agents/memory/kernel-pitfalls.md`「外部 API」节与退役的 MinerUClient
 * （同款通道，20260823 真机验证；`payload` 只收 string，二进制过不去）。
 *
 * 设计口径：
 *  - **可注入 mock**：单测不碰真网络（`JevTransportFn` 注入进 client）；
 *  - **超时集中**：本模块是 Jev 通道超时值的唯一落点（调用点禁自造数字，
 *    `.agents/memory/ai.md` 口径）；
 *  - **responseEncoding 契约**：`body` 按「string 直用，否则 JSON 序列化」
 *    解码（内核 3.8.2 修过该字段的编码路径，上游 issue #18978），
 *    非 UTF-8/二进制场景不在本通道内。
 */
import { fetchSyncPost } from "siyuan";

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

/** 传输函数签名（可注入 mock 的接缝）：只认「发出去什么」与「拿回什么」。 */
export type JevTransportFn = (req: {
    url: string;
    method: "POST";
    headers: Record<string, string>;
    /** JSON 序列化后的请求体（内核只收 string）。 */
    payload: string;
    timeout: number;
}) => Promise<JevHttpResponse>;

/** 上游 body 解码：内核正常回 string；少数形态回已解析对象（版本差异），
 *  两者都按 UTF-8 文本口径收口——真机正确性靠单测钉死这条契约。 */
export function decodeProxyBody(body: unknown): string {
    if (typeof body === "string") return body;
    if (body == null) return "";
    try {
        return JSON.stringify(body);
    } catch (_) {
        return String(body);
    }
}

/** 默认传输：真机走内核 forwardProxy。失败（内核层异常/无响应）
 *  一律折算成 `status: 0`，由 client 按网络错误统一处置——本模块不抛错。 */
export const kernelProxyTransport: JevTransportFn = async (req) => {
    try {
        const res = await fetchSyncPost("/api/network/forwardProxy", {
            url: req.url,
            method: req.method,
            headers: req.headers,
            payload: req.payload,
            timeout: req.timeout,
        });
        const data = (res?.data ?? {}) as { body?: unknown; status?: unknown };
        return { status: Number(data.status ?? 0) || 0, body: decodeProxyBody(data.body) };
    } catch (_) {
        return { status: 0, body: "" };
    }
};
