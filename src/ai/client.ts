import { EApi } from "../siyuan/api";
import { authHeaders } from "../siyuan/files";
import { resolveModelId, listAiModels } from "./models";
import { aiSessions, type AiTurn } from "./data/AiSessions";
import { notifyInfo } from "../ui/Notify";

/** 模型失效回落通知的冷却（同一失效 id 60s 内只报一次——转换并发池
 *  每批都过闸口，不冷却会连发十几条同文案）。 */
const fallbackNotifiedAt = new Map<string, number>();
const FALLBACK_COOLDOWN_MS = 60_000;

/** 闸口校正模型 id：传入的 id 失效被回落时浮层告知（原静默降级——用户
 *  为长转换选的高档模型被悄悄换成默认，产出质量落差无从归因）。 */
function resolveAndNotify(preferred: string): string {
    const resolved = resolveModelId(preferred);
    if (!preferred || resolved === preferred) return resolved;
    const now = Date.now();
    if (now - (fallbackNotifiedAt.get(preferred) ?? 0) < FALLBACK_COOLDOWN_MS) return resolved;
    fallbackNotifiedAt.set(preferred, now);
    const name = listAiModels().find((m) => m.id === resolved)?.name ?? "";
    notifyInfo(name ? { key: "notifyModelFallback", vars: { name } } : { key: "notifyModelFallbackDefault" });
    return resolved;
}

/**
 * 思源内置 AI 的调用通道（2026-08-27 从 convert/AgentClient 抽离成
 * 独立域——convert/bank/quiz/word/stats/companion 六域共用的基础设施，
 * 不再隶属任何业务域）。**对外通道两条：agentChatOnce**（一次性独立
 * 会话，天然并发 + 可按次指定模型，可选 track 参数登记进 AI 会话面板）
 * **与 agentChatContinued**（面板继续追问：历史轮次回放播种新会话）；
 * 旧 chatGPT 直答与共享空会话两条路已于 2026-08-30 弃用（见 AGENTS.md），
 * 并发靠独立 sessionID 而非换端点/全局串行队列（queue.ts 已随之退役）。
 */

/**
 * 调思源内置智能体（/api/ai/agent/chat，SSE 流式）并收集完整回答。
 * 真机 3.8.0 验证：model 传模型 id（与智能体面板同源）；event:content
 * 的 token 拼接为回答，event:error 抛错；非 SSE 响应是普通 JSON 错误。
 * 可选 signal 供调用方中途终止（分批转换的「终止生成」）。
 * 超时按**空闲**计：每收到一段流数据即续期——慢模型长批次只要还在
 * 出字就不掐，只有长时间无响应才断（总时长超时会误杀 5 分钟以上的
 * 正常生成，真机踩坑）。
 *
 * 模块内部实现细节：只被 agentChatOnce 以独立 sessionID 调用——
 * 内核并发锁按 sessionID 键控，不传会撞 "" 共享锁（老设计，已退役）。
 */
async function agentChat(
    message: string,
    modelId: string,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    /** 独立会话 id：带 sessionID/userEntryID，并发锁按 sessionID 键控。 */
    sessionId: string
): Promise<string> {
    // 总闸口校正（20260829）：失效/存量 model id 内核一律报「请先参考
    // 用户指南进行配置」——不在当前可用清单的回落默认，覆盖全部调用点；
    // 回落时浮层告知（原静默降级）
    modelId = resolveAndNotify(modelId);
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
                sessionID: sessionId,
                userEntryID: "",
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

/** 会话登记元数据（agentChatOnce 可选参数）：kind 进「AI 会话」面板的
 *  过滤与徽标，title 缺省取消息前 24 字。带上即登记（收口后可回看
 *  产出并继续追问，见 data/AiSessions），不带则与旧版行为一致。 */
export interface AiTrack {
    kind: string;
    title?: string;
}

/** saveSession 会话标题：消息前 24 字压平空白（内核面板列表同款观感）。 */
function titleOf(message: string): string {
    return message.replace(/\s+/g, " ").trim().slice(0, 24) || "温故";
}

/** 播种会话条目（user/assistant 交替回放；type 值与思源前端同源，
 *  20260831 于 stage/common 的智能体实现核实）。 */
interface SeededEntry {
    id: string;
    type: "user" | "assistant";
    content: string;
}

/** saveSession 落盘（一次性会话与继续会话共用；code≠0 抛错）。 */
async function seedSession(sid: string, title: string, entries: SeededEntry[], signal?: AbortSignal): Promise<void> {
    const resp = await fetch(EApi.AgentSaveSession, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ id: sid, revision: 0, title, entries }),
        signal,
    });
    const text = await resp.text();
    let j: { code?: number; msg?: string };
    try {
        j = JSON.parse(text) as { code?: number; msg?: string };
    } catch (e) {
        const err = new Error(`saveSession HTTP ${resp.status}`);
        (err as Error & { cause?: unknown }).cause = e;
        throw err;
    }
    if (j.code !== 0) throw new Error(j.msg || `saveSession ${j.code}`);
}

/** 会话清仓（失败静默——堆积文件无功能影响）。 */
function removeSession(sid: string): void {
    void fetch(EApi.AgentRemoveSession, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ id: sid }),
    }).catch((): void => undefined);
}

/**
 * 一次性智能体会话（全仓唯一 AI 对外通道）：saveSession 落盘一条
 * user 条目 → chat（并发锁按 sessionID 键控，不同会话互不 busy）→
 * removeSession 清理防落盘堆积。20260827 真机验证双路并发零 busy；
 * 20260830 起判分/出题/匹配/转换等原共享 "" 会话与 chatGPT 直答的
 * 调用点全部收拢至此——调用方无需任何串行队列，需要限流的场景
 * （转换并发池）自带 worker 池。
 * 带 track 的调用同步登记进 AI 会话面板（data/AiSessions）：起点
 * running、成功追加 ai 轮、失败记 error——弹层不等结果也能事后回看。
 */
export async function agentChatOnce(
    message: string,
    modelId: string,
    timeoutMs: number,
    signal?: AbortSignal,
    track?: AiTrack
): Promise<string> {
    const sid = newSessionId();
    const sessions = aiSessions();
    if (sessions && track) sessions.begin(sid, track.kind, track.title ?? titleOf(message), modelId, message);
    try {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError"); // 已终止不设防会白建会话
        await seedSession(sid, titleOf(message), [{ id: "u1", type: "user", content: message }], signal);
        const reply = await agentChat(message, modelId, timeoutMs, signal, sid);
        if (sessions && track) sessions.succeed(sid, reply);
        return reply;
    } catch (e) {
        if (sessions && track) sessions.fail(sid, String((e as Error)?.message ?? e));
        throw e;
    } finally {
        removeSession(sid);
    }
}

/**
 * 继续已有会话（AI 会话面板用）：把登记簿里的历史轮次播种进新的一次性
 * 会话（user/assistant 条目交替回放，思源前端续聊同款形态），再带新
 * 追问调用。不复用旧 sessionID——旧会话早已 removeSession 清仓，内核
 * 侧 revision/commitTurn 状态也无从对齐；回放条目即完整上下文，对
 * 模型等价。返回 AI 回答全文（追问轮的登记由面板侧 appendTurns 落）。
 */
export async function agentChatContinued(
    turns: AiTurn[],
    message: string,
    modelId: string,
    timeoutMs: number,
    signal?: AbortSignal
): Promise<string> {
    const sid = newSessionId();
    const first = turns.find((t) => t.role === "user")?.text ?? message;
    const entries: SeededEntry[] = turns.map((t, i) => ({
        id: `h${i}`,
        type: t.role === "user" ? "user" : "assistant",
        content: t.text,
    }));
    entries.push({ id: "u1", type: "user", content: message });
    try {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        await seedSession(sid, titleOf(first), entries, signal);
        return await agentChat(message, modelId, timeoutMs, signal, sid);
    } finally {
        removeSession(sid);
    }
}

interface SiyuanWindow {
    siyuan?: { config?: { lang?: string } };
}
