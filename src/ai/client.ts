import { errText } from "./../ui/shared";
import { EApi } from "../siyuan/api";
import { authHeaders } from "../siyuan/files";
import { sanitizeAiImages } from "./PromptHygiene";
import { resolveModelId, listAiModels } from "./models";
import { AI_STOPPED, aiSessions, type AiTurn, type AiTrack } from "./data/AiSessions";
import { notifyInfo } from "../ui/Notify";
import { mintTsId } from "../types";
import { acquireAiSlot, aiSlotUsage } from "./queue";

/** 会话登记元数据（agentChatOnce 可选参数）：定义在 data/AiSessions
 *  （数据层持有形状，client 只是通道），此处转发导出保调用方 import 路径。 */
export type { AiTrack, AiSessionGroup } from "./data/AiSessions";

/** 模型失效回落通知的冷却（同一失效 id 60s 内只报一次——转换并发池
 *  每批都过闸口，不冷却会连发十几条同文案）。 */
const fallbackNotifiedAt = new Map<string, number>();
const FALLBACK_COOLDOWN_MS = 60_000;

/* ── 后台 AI 流的中止接线与单飞闸（20260905 弹窗去阻塞改造） ── */

/** 登记簿里的「可中止句柄」两种形态：AbortController（aiAbort 造的
 *  通用流出品）与停止回调（**自带总闸**的业务流专用，如转换的
 *  stopConvertRun → internal.abort()——见 aiStopHandle）。面板「停止」
 *  对两者都只是「调一下」，不关心里面是断单笔 fetch 还是收整条流。 */
type StopHandle = AbortController | (() => void);

/** 登记簿记录 id → 该调用所属流的可中止句柄：流入口用 aiAbort() /
 *  aiStopHandle() 建句柄、track.onSid 把每个在途调用的记录 id 挂上——
 *  AI 会话面板对 running 记录点「停止」即 abortAiSession(id) 调停该流，
 *  流循环逐项检查 signal / 自身 aborted 标记退出。调用收口时自动注销。 */
const stopBySid = new Map<string, StopHandle>();

/** 后台流的中止句柄：signal 传给每个 agentChatOnce，onSid 传进 track，
 *  stop（可选）是**整条流的停止动作**——Issue #77 的流级横幅挂在它上面
 *  （`stop()` 与面板记录点停 `abortAiSession` 走的是同一个 controller，
 *  两条入口等价）；`aiStopHandle` 形态下它即调用方给的业务总闸。 */
export interface AiAbort {
    signal: AbortSignal;
    onSid(sid: string): void;
    stop?(): void;
}

export function aiAbort(): AiAbort {
    const ctrl = new AbortController();
    // 中止理由带 AI_STOPPED：**中止与失败靠它分辨**（见 isUserStopOf）
    return { signal: ctrl.signal, onSid: (sid) => stopBySid.set(sid, ctrl), stop: () => ctrl.abort(AI_STOPPED) };
}

/**
 * 该在途调用是否**因用户停止**而断（Issue #88）：判据是「signal 已断
 * **且**中止理由为 {@link AI_STOPPED}」——**不能只看 signal.aborted**：
 *  - 转换 / 增量族的「面板停止」走业务总闸 `internal.abort()`，而**同片
 *    兄弟失败**（`runSegment` 报错后编排层 `internal.abort()` 收掉其余
 *    in-flight 调用）走的是**同一个** signal——只看 aborted 会把「被兄弟
 *    失败连坐断掉的那笔」也标成「已停止」，用户看到的是「失败了」却标
 *    「停止」，比不标更坏；
 *  - 超时是内部 controller abort 出来的，压根没断这个 signal。
 *  故约定：**业务侧凡「用户显式停止」都在 abort 时带上 AI_STOPPED**
 *  （转换族的 `abortFlow` 是唯一写入点）。理由缺失（旧调用方/不支持
 *  `AbortSignal.reason` 的运行时）一律按失败处置——**宁可报失败，不可
 *  把失败说成停止**。
 */
export function isUserStopOf(signal: AbortSignal | undefined): boolean {
    return !!signal?.aborted && signal.reason === AI_STOPPED;
}

/**
 * 自带停止回调的中止句柄（业务流总闸版 aiAbort）：signal 只用于**本轮
 * 在途 fetch 断流**（转换族每笔调用都要它），onSid 把面板「停止」接到
 * 调用方给的 stop——**语义等价于页内停止钮**：转换流即
 * `stopConvertRun` → `internal.abort()`（置 aborted 标记 + 断在途
 * fetch + worker 池收口），不是只断当前这一笔 fetch。
 *
 * 转换族（整卷/批量队列/增量）原先 track 只带 {kind,title,group}、从不
 * 传 onSid，面板点停因此查无此 id、静默无效（Issue #72 根因）。
 */
export function aiStopHandle(signal: AbortSignal, stop: () => void): AiAbort {
    return { signal, onSid: (sid) => stopBySid.set(sid, stop), stop };
}

/** 中止一条在途调用所属的流（面板「停止」入口）；未接线/已收口返 false。 */
export function abortAiSession(sid: string): boolean {
    const h = stopBySid.get(sid);
    if (!h) return false;
    stopBySid.delete(sid);
    if (typeof h === "function") h();
    // AbortController 形态同样带 AI_STOPPED 理由：面板点停**就是用户停止**
    // （Issue #88），在途记录据此记「停止」而非把用户动作显示成失败。
    else h.abort(AI_STOPPED);
    return true;
}

/** 重型批流单飞闸：六个 AI 批流（匹配/批量关联/生成标签/变式重练/薄弱
 *  加练/收集补题）后台化后失去模态天然串行——引用注入的内核写流并发
 *  互吞（fetchSyncPost 真机坑），同一时间只放一条。 */
let flowBusy = false;

export function aiFlowBegin(): boolean {
    if (flowBusy) return false;
    flowBusy = true;
    return true;
}

export function aiFlowEnd(): void {
    flowBusy = false;
}

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
 * **与 agentChatContinued**（AI 会话面板重试失败记录：历史轮次回放
 * 播种新会话）；旧 chatGPT 直答与共享空会话两条路已于 2026-08-30 弃用
 * （见 AGENTS.md），并发靠独立 sessionID 而非换端点/全局串行队列（queue.ts 已随之退役）。
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
    return mintTsId(now);
}

/** saveSession 会话标题：消息前 24 字压平空白（内核面板列表同款观感）。 */
function titleOf(message: string): string {
    return message.replace(/\s+/g, " ").trim().slice(0, 24) || "温故";
}

/**
 * 全局在途闸的取槽（Issue #76）：**每条对外通道在发请求前取槽**，
 * 容量默认 4、由 index.ts onload 按设置里的转换并行度注入——转换 4
 * 并发跑动中再点面板「重试」时重试排队等槽，而不是直发第 5 笔。
 *
 * 三条口径：
 *  - **abort 感知**：排队期间 signal 中止 → 立刻出队抛 AbortError
 *    （语义与「已终止不设防会白建会话」那条一致，调用方的 Error 分支
 *    照常认；不得出现「点了停止还挂在队里等槽」）；
 *  - **超时从取到槽后才起算**：排队时间不计入 AI_TIMEOUT 的 SSE 空闲
 *    超时（排队等一小时也不该被判超时）；
 *  - **槽在调用收口（成功/失败/中止）释放**：返回的释放函数幂等，
 *    finally 里调一次即可。
 */
async function slotGate(sid: string | undefined, signal?: AbortSignal): Promise<() => void> {
    // 满载（无空闲槽）⇒ 这一笔要排队：先标「排队中」（面板详情显示
    // 「等待空闲通道…」，status 仍是 running），取到槽立刻清掉。
    // 判据必须是**满载**而不是「已有等待者」——本次调用此刻还没入队，
    // 拿等待者数判会漏标第一笔排队者（就变成「第五笔才显示」）。
    const { used, capacity } = aiSlotUsage();
    if (sid && used >= capacity) aiSessions()?.queued(sid);
    try {
        return await acquireAiSlot(signal);
    } finally {
        if (sid) aiSessions()?.dequeued(sid);
    }
}

/** 动作分组 id：动作入口（转换/匹配/批量关联等）在一次动作开始时生成，
 *  该动作触发的所有 agentChatOnce 调用共用（面板树归并的键；格式无内核
 *  约束，仅登记簿内唯一即可，形如 g{时间戳}-{随机}）。 */
export function newAiGroupId(now = new Date()): string {
    return `g${mintTsId(now)}`;
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
    // 消毒先行：登记簿与 saveSession 落的都是实际发送文本（assets 图片行
    // 换占位符，防内核抠图附件 detail:auto 触发供应商 2013，见 PromptHygiene）
    message = sanitizeAiImages(message);
    const sid = newSessionId();
    const sessions = aiSessions();
    if (sessions && track) {
        sessions.begin(sid, track.kind, track.title ?? titleOf(message), modelId, message, track.group);
        track.onSid?.(sid); // 生命周期由下方 finally 统一注销
    }
    // 全局在途闸（Issue #76）：先取槽再发请求（**在登记之后**——排队中
    // 的记录也该在面板可见，语义仍是 running；超时从取到槽后才起算）
    let release: (() => void) | undefined;
    try {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError"); // 已终止不设防会白建会话
        release = await slotGate(sid, signal);
        await seedSession(sid, titleOf(message), [{ id: "u1", type: "user", content: message }], signal);
        const reply = await agentChat(message, modelId, timeoutMs, signal, sid);
        if (sessions && track) sessions.succeed(sid, reply);
        return reply;
    } catch (e) {
        if (sessions && track) {
            // 用户停止 → **停止态**（Issue #88：面板出琥珀色点 + stopped
            // 徽标，与横幅「转换已停止」同口径）；其余（超时/网络/服务端
            // 报错/被兄弟失败连坐）→ 失败态（判据见 isUserStopOf）。
            if (isUserStopOf(signal)) sessions.aborted(sid);
            else sessions.fail(sid, errText(e));
        }
        throw e;
    } finally {
        release?.(); // 槽在收口（成功/失败/中止）释放，排队者按 FIFO 补位
        if (track) stopBySid.delete(sid);
        removeSession(sid);
    }
}

/**
 * 重放轮次进新会话（AI 会话面板的重试入口）：把登记簿里该记录的已有
 * 轮次播种进新的一次性会话（user/assistant 条目交替回放，思源前端续聊
 * 同款形态），再重发指定的 user 消息调用——面板重试传「记录末条 user
 * 轮」（失败调用必以 user 轮收尾，即重跑最后一次调用）。不复用旧
 * sessionID——旧会话早已 removeSession 清仓，内核侧 revision/commitTurn
 * 状态也无从对齐；回放条目即完整上下文，对模型等价。返回 AI 回答全文
 * （重试的写回由面板侧 retrying/succeed/fail 落，20260905 起追问退役）。
 */
export async function agentChatContinued(
    turns: AiTurn[],
    message: string,
    modelId: string,
    timeoutMs: number,
    signal?: AbortSignal
): Promise<string> {
    // 追问消息与回放的历史 user 轮（旧转换记录可能带图片行）同样消毒
    message = sanitizeAiImages(message);
    const sid = newSessionId();
    const first = turns.find((t) => t.role === "user")?.text ?? message;
    const entries: SeededEntry[] = turns.map((t, i) => ({
        id: `h${i}`,
        type: t.role === "user" ? "user" : "assistant",
        content: t.role === "user" ? sanitizeAiImages(t.text) : t.text,
    }));
    entries.push({ id: "u1", type: "user", content: message });
    // 全局在途闸（Issue #76）：重试与判分/转换/伴学竞争**同一组**槽位，
    // 满载时排队等槽（面板「重试」在转换 4 并发跑动中不再是第 5 笔直发）
    let release: (() => void) | undefined;
    try {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        release = await slotGate(sid, signal);
        await seedSession(sid, titleOf(first), entries, signal);
        return await agentChat(message, modelId, timeoutMs, signal, sid);
    } finally {
        release?.();
        removeSession(sid);
    }
}

interface SiyuanWindow {
    siyuan?: { config?: { lang?: string } };
}
