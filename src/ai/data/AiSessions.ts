/**
 * AI 会话登记簿（20260831）：全仓 AI 任务走 agentChatOnce 一次性独立
 * 会话，跑完即 removeSession——弹层关掉就看不到「问了什么、答了什么」。
 * 本模块把带 track 元数据的每次 AI 调用登记成一条记录（完整轮次/状态/
 * 模型），供「AI 会话」工作区面板回看产出并重试失败调用（重试 = 把
 * 历史轮次播种进新会话重放，见 client.ts agentChatContinued；20260905
 * 起面板的自由追问退役——闲聊会污染业务记录且每次全量回放烧 token）。
 *
 * 存储放 saveData("ai-sessions")：LRU 双上限——全局 {@link AI_SESSIONS_CAP}
 * 条、单类别 {@link AI_SESSION_KIND_CAP} 条（判题/转换这类高频调用不至
 * 冲掉其他类别的记录），轮次文本单条 2 万字封顶（防御超长 prompt 撑爆
 * 存储）。写走「脏标记 + 600ms 尾随去抖 + 串行链」（内核 fetchSyncPost
 * 并发互吞响应，见 AGENTS.md；转换并发池一秒内多次收口只落一次盘）。
 * 插件重载时在途的 running 记录永远等不到收口——hydrate 一律改判
 * error({@link AI_INTERRUPTED})，面板显示「已中断」。
 *
 * 动作分组（20260902）：一次用户动作触发的多次调用（导入转换的
 * 检测/路由/转换、匹配的逐题路由等）由动作入口发一个组 id，各调用
 * 经 track.group 带上——面板左栏把同组记录归并成一棵可展开子树，
 * 树状呈现「动作 → 多个会话」。
 */

import { errText, isLifecycleGone } from "../../ui/shared";
import { notifyError } from "../../ui/Notify";

/** 会话轮次：user=发给 AI 的完整 prompt，ai=AI 回答全文（即「产出」）。 */
export interface AiTurn {
    role: "user" | "ai";
    text: string;
}

/** 一条登记记录：对应一次 agentChatOnce 调用（error 态记录重试成功后
 *  在原地翻案追加 ai 轮，见 {@link AiSessionStore.retrying}）。 */
export interface AiSessionRecord {
    /** 首次调用的内核 sessionID（继续追问播种新会话，此 id 仅作记录锚点）。 */
    id: string;
    /** 业务类别（judge/convert/detect/tag/route/regen/word/ask，面板过滤徽标）。 */
    kind: string;
    title: string;
    /** 调用时指定的模型 id（继续追问的默认模型，resolveModelId 总闸仍生效）。 */
    model: string;
    createdAt: number;
    endedAt?: number;
    status: "running" | "done" | "error";
    error?: string;
    turns: AiTurn[];
    /** 动作分组 id（可选，20260902）：一次用户动作触发的多次调用共享同组
     *  （如一次导入转换的 检测/路由/转换 全部调用），面板左栏归并成一棵
     *  子树。空 = 不分组（判题这类单发动作平铺显示）。 */
    group?: string;
    /** 分组标题（随每条记录冗余落盘，组节点标题取最新成员的；组员同批
     *  必同值，LRU 淘汰部分成员也不丢标题）。 */
    groupTitle?: string;
}

/** 动作分组（agentChatOnce 的 track 可选参数）：id 由动作入口生成
 *  （newAiGroupId），title 为人读的组名（如「转换 · 文档名」）。 */
export interface AiSessionGroup {
    id: string;
    title: string;
}

/** 会话登记元数据（agentChatOnce 可选参数，client.ts 转发导出）：kind
 *  进「AI 会话」面板的过滤与徽标，title 缺省取消息前 24 字，group 把
 *  该调用挂进一次动作的分组树。带上即登记（收口后可回看产出并继续
 *  追问），不带则不登记。onSid 是运行时回调（**不落盘**）：登记簿
 *  begin 后回传记录 id，供调用方把 AI 会话面板的「停止」按钮接到
 *  自己的 AbortController（见 client.ts aiAbort）。 */
export interface AiTrack {
    kind: string;
    title?: string;
    group?: AiSessionGroup;
    onSid?: (sid: string) => void;
}

/** 插件存储（saveData("ai-sessions")）里的登记簿。 */
export interface AiSessionsData {
    version: 1;
    items: AiSessionRecord[];
}

/** 全局保留条数（超出按最旧淘汰）。 */
export const AI_SESSIONS_CAP = 150;
/** 单类别保留条数（高频类别不冲掉别的类）。 */
export const AI_SESSION_KIND_CAP = 40;
/** 重载时在途记录的收口标记（面板映射为「已中断」文案）。 */
export const AI_INTERRUPTED = "interrupted";

/** 单轮文本封顶（防御超长 prompt 撑爆存储）。 */
const TURN_TEXT_CAP = 20_000;
/** 落盘去抖窗口（ms）。 */
const FLUSH_DELAY_MS = 600;

function validTurns(v: unknown): AiTurn[] {
    return Array.isArray(v)
        ? v.filter(
              (x): x is AiTurn =>
                  !!x && typeof x === "object" && (x.role === "user" || x.role === "ai") && typeof x.text === "string"
          )
        : [];
}

function validItems(raw: unknown): AiSessionRecord[] {
    if (!raw || typeof raw !== "object") return [];
    const items = (raw as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    const out: AiSessionRecord[] = [];
    for (const x of items) {
        if (!x || typeof x !== "object") continue;
        const r = x as Partial<AiSessionRecord>;
        if (
            typeof r.id !== "string" ||
            typeof r.kind !== "string" ||
            typeof r.title !== "string" ||
            typeof r.model !== "string" ||
            typeof r.createdAt !== "number" ||
            (r.status !== "running" && r.status !== "done" && r.status !== "error")
        ) {
            continue;
        }
        out.push(validGroupFields({ ...r, status: r.status, turns: validTurns(r.turns) } as AiSessionRecord));
    }
    return out;
}

/** 组字段宽容装载：string 原样保留，其他类型剥掉（可选字段，旧盘无）。 */
function validGroupFields(r: AiSessionRecord): AiSessionRecord {
    if (typeof r.group !== "string" || !r.group) delete r.group;
    if (typeof r.groupTitle !== "string" || !r.groupTitle) delete r.groupTitle;
    return r;
}

function capText(text: string): string {
    return text.length > TURN_TEXT_CAP ? text.slice(0, TURN_TEXT_CAP) : text;
}

function cloneTurns(turns: AiTurn[]): AiTurn[] {
    return turns.map((t) => ({ role: t.role, text: t.text }));
}

function cloneRecord(r: AiSessionRecord): AiSessionRecord {
    return { ...r, turns: cloneTurns(r.turns) };
}

export class AiSessionStore {
    /** 头新尾旧（begin 头插；hydrate 后统一按 createdAt 降序排）。 */
    private items: AiSessionRecord[] = [];
    private readyPromise?: Promise<void>;
    private dirty = false;
    private flushTimer?: ReturnType<typeof setTimeout>;
    /** 串行落盘链（同 ChatStore/RouteCache 模式：并发 saveData 互吞）。 */
    private chain: Promise<unknown> = Promise.resolve();
    private listeners = new Set<() => void>();
    /** 版本闩：盘上数据来自更新版插件时停写保护（升级后自然解除）。 */
    private foreign = false;

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (v: AiSessionsData) => Promise<unknown>
    ) {
        void this.ensure();
    }

    /** 首次加载（幂等，多次调用共享同一 Promise；坏数据按空处理）。 */
    ready(): Promise<void> {
        return this.ensure();
    }

    private ensure(): Promise<void> {
        this.readyPromise ??= this.loadRaw()
            .catch((): unknown => undefined)
            .then((raw) => {
                // 版本闩（数据演进守则：新持久化存储上线即配）：盘上版本
                // 大于本版已知=来自更新版插件，按空起步+停写，防旧版覆写
                const ver = raw && typeof raw === "object" ? (raw as { version?: number }).version : undefined;
                if (typeof ver === "number" && ver > 1) {
                    this.foreign = true;
                    notifyError({ key: "notifyStoreForeign", vars: { store: "ai-sessions" } });
                    return;
                }
                const stored = validItems(raw);
                if (this.items.length === 0) {
                    this.items = stored;
                } else {
                    // 极端竞态：构造后 hydrate 完成前已有新调用登记（内存
                    // 记录必不在盘上）——按 id 合并，在途记录优先
                    const ids = new Set(this.items.map((r) => r.id));
                    this.items = [...this.items, ...stored.filter((s) => !ids.has(s.id))];
                }
                let changed = false;
                for (const r of this.items) {
                    if (r.status === "running") {
                        r.status = "error";
                        r.error = AI_INTERRUPTED;
                        r.endedAt = Date.now();
                        changed = true;
                    }
                }
                this.items.sort((a, b) => b.createdAt - a.createdAt);
                if (this.trim()) changed = true;
                if (changed) this.schedule();
            });
        return this.readyPromise;
    }

    /** 变更订阅（登记/收口/删除都同步通知；面板据此重拉快照）。 */
    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    private notify(): void {
        for (const fn of [...this.listeners]) fn();
    }

    /** 登记一次调用的起点（running + 首轮 user prompt；group=所属动作组）。 */
    begin(id: string, kind: string, title: string, model: string, prompt: string, group?: AiSessionGroup): void {
        const rec: AiSessionRecord = {
            id,
            kind,
            title,
            model,
            createdAt: Date.now(),
            status: "running",
            turns: [{ role: "user", text: capText(prompt) }],
            ...(group ? { group: group.id, groupTitle: group.title } : {}),
        };
        this.items = [rec, ...this.items.filter((r) => r.id !== id)];
        this.trim();
        this.schedule();
        this.notify();
    }

    /** 调用成功收口（追加 ai 轮 = 产出；仅 running 态可收口，防错序双写）。 */
    succeed(id: string, reply: string): void {
        const r = this.items.find((x) => x.id === id);
        if (!r || r.status !== "running") return;
        r.status = "done";
        r.endedAt = Date.now();
        delete r.error;
        r.turns.push({ role: "ai", text: capText(reply) });
        this.schedule();
        this.notify();
    }

    /** 调用失败收口（中止/超时/报错都算 error，原样记消息）。 */
    fail(id: string, message: string): void {
        const r = this.items.find((x) => x.id === id);
        if (!r || r.status !== "running") return;
        r.status = "error";
        r.error = message || "error";
        r.endedAt = Date.now();
        this.schedule();
        this.notify();
    }

    /** 重试在途：error→running（面板重试入口；重放轮次走新会话，收口
     *  复用 succeed/fail——成功追加 ai 轮原地翻案、失败记新错误消息）。
     *  仅 error 态可转：done 无「未完成调用」可重跑，running 防重入。 */
    retrying(id: string): void {
        const r = this.items.find((x) => x.id === id);
        if (!r || r.status !== "error") return;
        r.status = "running";
        delete r.error;
        delete r.endedAt;
        this.schedule();
        this.notify();
    }

    /** 删除一条（面板行内动作）。 */
    remove(id: string): void {
        const before = this.items.length;
        this.items = this.items.filter((r) => r.id !== id);
        if (this.items.length === before) return;
        this.schedule();
        this.notify();
    }

    /** 删除一批记录（面板分支行删除：树算出的可见成员按 id 精确回收；
     *  20260903 树改种类/文档两级后，删除对象=文档分支的成员集合）。 */
    removeIds(ids: string[]): void {
        if (ids.length === 0) return;
        const dead = new Set(ids);
        const before = this.items.length;
        this.items = this.items.filter((r) => !dead.has(r.id));
        if (this.items.length === before) return;
        this.schedule();
        this.notify();
    }

    /** 清空全部。 */
    clear(): void {
        if (this.items.length === 0) return;
        this.items = [];
        this.schedule();
        this.notify();
    }

    /** 全部记录快照（头新尾旧；返回副本，读方改不动登记簿）。 */
    list(): AiSessionRecord[] {
        return this.items.map(cloneRecord);
    }

    /** 单条快照（无则 undefined）。 */
    peek(id: string): AiSessionRecord | undefined {
        const r = this.items.find((x) => x.id === id);
        return r ? cloneRecord(r) : undefined;
    }

    /** 容量收口：先单类别（从头新尾旧序数起，超出上限的旧记录淘汰）、
     *  后全局截断（保留头部=最新）。 */
    private trim(): boolean {
        const before = this.items.length;
        const byKind = new Map<string, number>();
        for (let i = 0; i < this.items.length; i++) {
            const k = this.items[i].kind;
            const c = (byKind.get(k) ?? 0) + 1;
            byKind.set(k, c);
            if (c > AI_SESSION_KIND_CAP) {
                this.items.splice(i, 1);
                i--;
            }
        }
        if (this.items.length > AI_SESSIONS_CAP) this.items.length = AI_SESSIONS_CAP;
        return this.items.length !== before;
    }

    /** 脏了安排去抖落盘。 */
    private schedule(): void {
        if (this.foreign) return; // 版本闩：停写保护
        this.dirty = true;
        this.flushTimer ??= setTimeout(() => {
            this.flushTimer = undefined;
            this.flushNow();
        }, FLUSH_DELAY_MS);
    }

    /** 立即落盘（去抖窗口合并多笔；插件卸载/单测直调）。 */
    flushNow(): void {
        if (this.foreign) return; // 版本闩：停写保护
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        if (!this.dirty) return;
        this.dirty = false;
        const snap: AiSessionsData = { version: 1, items: this.items.map(cloneRecord) };
        const run = this.chain.then(() => this.saveRaw(snap));
        const noop = (): void => undefined;
        // 链面吞错保后续可排（内存为准），但不再静默：落盘失败走思源
        // 通知（Notify 错误冷却防重试风暴）。3.8.2 生命周期闸（410）
        // 除外——重载后旧实例的僵尸登记（长 AI 任务熬过重载才收口）
        // 属预期失败，弹了只是调试重载期的噪音（20260904）。
        this.chain = run.then(noop, (e: unknown): void => {
            if (isLifecycleGone(e)) return;
            notifyError({ key: "notifySaveFailAi", vars: { msg: errText(e) } });
        });
    }
}

/** 模块级单例（index.ts onload 注入内核 IO；未初始化=测试环境，
 *  agentChatOnce 的 track 自动裸跑不登记）。 */
let instance: AiSessionStore | undefined;

/** 插件装载时接线。 */
export function initAiSessions(io: {
    load: () => Promise<unknown>;
    save: (v: AiSessionsData) => Promise<unknown>;
}): AiSessionStore {
    instance = new AiSessionStore(io.load, io.save);
    return instance;
}

/** 取共享登记簿单例（面板与 client 共用）。 */
export function aiSessions(): AiSessionStore | undefined {
    return instance;
}
