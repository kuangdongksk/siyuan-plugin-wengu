/**
 * 思源内置智能体客户端（design-review P2-5）：SSE 调用 + 用户配置的
 * 模型清单。转换与 AI 分析报告共用，ConvertService 不再持有这层。
 */
import {esc} from "./ui";

/** 用户在 设置→AI 配置的可选模型（提供商 × 模型）。 */
export interface WenguAiModel {
    /** 模型 id（agent/chat 的 model 参数）。 */
    id: string;
    name: string;
    provider: string;
}

interface SiyuanAiModelConf {
    id?: string;
    name?: string;
    displayName?: string;
    enabled?: boolean;
}
interface SiyuanAiProviderConf {
    id?: string;
    displayName?: string;
    enabled?: boolean;
    models?: SiyuanAiModelConf[];
}
interface SiyuanAiConf {
    agent?: {modelId?: string;};
    providers?: SiyuanAiProviderConf[];
}
interface SiyuanWindow {
    siyuan?: {config?: {ai?: SiyuanAiConf; lang?: string;};};
}

function aiConf(): SiyuanAiConf {
    return (window as unknown as SiyuanWindow).siyuan?.config?.ai ?? {};
}

/** 列出用户配置的全部可用模型（启用的提供商 × 启用的模型）。 */
export function listAiModels(): WenguAiModel[] {
    const out: WenguAiModel[] = [];
    for (const p of aiConf().providers ?? []) {
        if (!p.enabled) continue;
        for (const m of p.models ?? []) {
            if (!m.enabled) continue;
            const name = m.displayName || m.name;
            if (name) out.push({id: m.id || m.name, name, provider: p.displayName || p.id || "?"});
        }
    }
    return out;
}

/** 智能体设置里的默认模型 id（空串表示未配置）。 */
export function defaultAgentModelId(): string {
    return aiConf().agent?.modelId ?? "";
}

/** 模型下拉的全部选项（各模型「提供商 · 名称」），设置页/转换弹窗共用。
 *  不单列「默认」项：selectedId 命中则选中，否则预选智能体设置的默认模型。 */
export function modelOptionsHtml(selectedId: string): string {
    const models = listAiModels();
    const sel = selectedId && models.some((m) => m.id === selectedId) ? selectedId : defaultAgentModelId();
    return models
        .map((m) =>
            `<option value="${esc(m.id)}"${sel === m.id ? " selected" : ""}>${esc(m.provider)} · ${
                esc(m.name)
            }</option>`
        )
        .join("");
}

/**
 * 调思源内置智能体（/api/ai/agent/chat，SSE 流式）并收集完整回答。
 * 真机 3.8.0 验证：model 传模型 id（与智能体面板同源）；event:content
 * 的 token 拼接为回答，event:error 抛错；非 SSE 响应是普通 JSON 错误。
 * 可选 signal 供调用方中途终止（分批转换的「终止生成」）。
 */
export async function agentChat(
    message: string,
    modelId: string,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    try {
        const lang = (window as unknown as SiyuanWindow).siyuan?.config?.lang ?? "zh_CN";
        const resp = await fetch("/api/ai/agent/chat", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                message,
                language: lang,
                references: [],
                ...(modelId ? {model: modelId} : {}),
            }),
            signal: controller.signal,
        });
        const ctype = resp.headers.get("Content-Type") ?? "";
        if (!resp.ok || !ctype.includes("text/event-stream")) {
            const text = await resp.text();
            let msg = "";
            try {
                msg = String((JSON.parse(text) as {msg?: string;})?.msg ?? "");
            } catch (_) {
                msg = text.slice(0, 200);
            }
            throw new Error(msg || `HTTP ${resp.status}`);
        }
        const reader = resp.body?.getReader();
        if (!reader) throw new Error("empty stream");
        const decoder = new TextDecoder();
        let buf = "";
        let evt = "";
        let out = "";
        for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            buf += decoder.decode(value, {stream: true});
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
                if (line.startsWith("event:")) {
                    evt = line.slice(6).trim();
                    continue;
                }
                if (!line.startsWith("data:")) continue;
                const raw = line.slice(5).trim();
                if (!evt || !raw) continue;
                let data: {token?: unknown; message?: unknown; msg?: unknown;};
                try {
                    data = JSON.parse(raw);
                } catch (_) {
                    continue;
                }
                if (evt === "content" && typeof data.token === "string") {
                    out += data.token;
                } else if (evt === "error") {
                    throw new Error(String(data.message ?? data.msg ?? "agent error"));
                }
            }
        }
        return out;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
    }
}
