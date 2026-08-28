import { EApi } from "../siyuan/api";
import { authHeaders } from "../siyuan/files";

/**
 * 思源内置 AI 的调用通道（2026-08-27 从 convert/AgentClient 抽离成
 * 独立域——convert/bank/quiz/word/stats/companion 六域共用的基础设施，
 * 不再隶属任何业务域）。三条通道按场景选：
 *  - agentChat：智能体 SSE 流式，可按次指定 model；不传 sessionID 时
 *    共用 "" 会话（内核并发锁键控，并发互斥，须过 enqueueAi 串行）。
 *  - agentChatConcurrent：旧直答端点 chatGPT，支持并发、模型跟随
 *    设置默认不可指定——转换并发池用。
 *  - agentChatOnce：一次性独立会话（saveSession→chat→removeSession），
 *    独立 sessionID 天然并发（20260827 真机验证），高频独立任务
 *    （看板娘反应/聊天/单词复盘）用它，无需串行队列。
 */

/**
 * 调思源内置智能体（/api/ai/agent/chat，SSE 流式）并收集完整回答。
 * 真机 3.8.0 验证：model 传模型 id（与智能体面板同源）；event:content
 * 的 token 拼接为回答，event:error 抛错；非 SSE 响应是普通 JSON 错误。
 * 可选 signal 供调用方中途终止（分批转换的「终止生成」）。
 * 超时按**空闲**计：每收到一段流数据即续期——慢模型长批次只要还在
 * 出字就不掐，只有长时间无响应才断（总时长超时会误杀 5 分钟以上的
 * 正常生成，真机踩坑）。
 */
export async function agentChat(
    message: string,
    modelId: string,
    timeoutMs: number,
    signal?: AbortSignal,
    /** 独立会话 id（见 agentChatOnce）：传了即带 sessionID/userEntryID，
     * 并发锁按 sessionID 键控，不同会话互不 busy。 */
    sessionId = ""
): Promise<string> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const armTimer = (): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), timeoutMs);
    };
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    if (signal?.aborted) controller.abort(); // 已终止的 signal 不再触发 abort 事件，显式设防（挂账清偿）
    armTimer();
    try {
        const lang = (window as unknown as SiyuanWindow).siyuan?.config?.lang ?? "zh_CN";
        const resp = await fetch(EApi.AgentChat, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({
                message,
                language: lang,
                references: [],
                ...(modelId ? { model: modelId } : {}),
                ...(sessionId ? { sessionID: sessionId, userEntryID: "" } : {}),
            }),
            signal: controller.signal,
        });
        const ctype = resp.headers.get("Content-Type") ?? "";
        if (!resp.ok || !ctype.includes("text/event-stream")) {
            const text = await resp.text();
            let msg = "";
            try {
                msg = String((JSON.parse(text) as { msg?: string })?.msg ?? "");
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
            const { done, value } = await reader.read();
            armTimer(); // 有流数据到达即续期（空闲超时）
            if (done) break;
            buf += decoder.decode(value, { stream: true });
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
                let data: { token?: unknown; message?: unknown; msg?: unknown };
                try {
                    data = JSON.parse(raw);
                } catch (_) {
                    continue;
                }
                if (evt === "content" && typeof data.token === "string") {
                    out += data.token;
                } else if (evt === "error") {
                    // 服务端报错也要掐掉底层流：只 throw 不 cancel 的话
                    // 连接半开到服务端自行关闭，错误多发时堆积
                    void reader.cancel().catch((): void => undefined);
                    throw new Error(String(data.message ?? data.msg ?? "agent error"));
                }
            }
        }
        return out;
    } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
    }
}

/**
 * 旧直答端点（POST /api/ai/chatGPT，{msg} → {code, data: 回复全文}）。
 * 与 agent/chat 的关键差异（真机 20260823 验证）：无智能体会话，
 * **支持并发**（agent/chat 并发会报 "session is busy in another
 * instance"）；模型跟随 设置→AI 的默认模型，不能按次指定。分批转换
 * 的并发池走这里。
 */
export async function agentChatConcurrent(message: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener("abort", onAbort);
    if (signal?.aborted) controller.abort(); // 已终止的 signal 显式设防（挂账清偿）
    try {
        const resp = await fetch(EApi.AiChatGpt, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ msg: message }),
            signal: controller.signal,
        });
        // 先取文本再解析：鉴权 401 等回 HTML 页时 resp.json() 抛裸
        // SyntaxError（无上下文），这里给出可读的状态码错误
        const text = await resp.text();
        let j: { code?: number; msg?: string; data?: unknown };
        try {
            j = JSON.parse(text) as { code?: number; msg?: string; data?: unknown };
        } catch (e) {
            throw new Error(`chatGPT HTTP ${resp.status}`, { cause: e });
        }
        if (j.code !== 0) throw new Error(j.msg || `chatGPT ${j.code}`);
        return String(j.data ?? "");
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
    }
}

/** 一次性会话 id：{14位时间戳}-{7位字母数字}（内核 isValidSessionID 校验格式）。 */
export function newSessionId(now = new Date()): string {
    const p = (n: number): string => String(n).padStart(2, "0");
    const stamp =
        `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
        `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
    let rand = "";
    for (let i = 0; i < 7; i++) rand += abc[Math.floor(Math.random() * abc.length)];
    return `${stamp}-${rand}`;
}

/**
 * 一次性智能体会话（独立 sessionID 并发通道）：saveSession 落盘一条
 * user 条目 → chat（并发锁按 sessionID 键控，不同会话互不 busy）→
 * removeSession 清理防落盘堆积。20260827 真机验证双路并发零 busy；
 * 高频独立任务（看板娘反应/聊天/讲题、单词复盘）直接用它，无需
 * 模块级串行队列。
 */
export async function agentChatOnce(
    message: string,
    modelId: string,
    timeoutMs: number,
    signal?: AbortSignal
): Promise<string> {
    const sid = newSessionId();
    try {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError"); // 已终止不设防会白建会话
        const resp = await fetch(EApi.AgentSaveSession, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({
                id: sid,
                revision: 0,
                title: message.replace(/\s+/g, " ").trim().slice(0, 24) || "温故",
                entries: [{ id: "u1", type: "user", content: message }],
            }),
            signal,
        });
        const text = await resp.text();
        let j: { code?: number; msg?: string };
        try {
            j = JSON.parse(text) as { code?: number; msg?: string };
        } catch (e) {
            throw new Error(`saveSession HTTP ${resp.status}`, { cause: e });
        }
        if (j.code !== 0) throw new Error(j.msg || `saveSession ${j.code}`);
        return await agentChat(message, modelId, timeoutMs, signal, sid);
    } finally {
        // 会话清仓（失败静默——堆积文件无功能影响）
        void fetch(EApi.AgentRemoveSession, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ id: sid }),
        }).catch((): void => undefined);
    }
}

interface SiyuanWindow {
    siyuan?: { config?: { lang?: string } };
}
