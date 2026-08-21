import type {WenguTimingMode} from "./types";

/** 一题在一轮里的作答记录。 */
export interface WenguSessionResult {
    qid: string;
    submitted: string;
    ok: boolean;
}

/** 一轮刷题（N 刷里的一刷）：开刷时创建，逐题作答时更新，结束时封卷。 */
export interface WenguSession {
    id: string;
    docId: string;
    startedAt: number;
    endedAt?: number;
    mode: WenguTimingMode;
    /** 倒计时的计划时长（秒）。 */
    plannedSec?: number;
    /** 实际用时（秒，到最近一次作答/收卷为止）。 */
    elapsedSec: number;
    answered: number;
    correct: number;
    results: WenguSessionResult[];
}

/** 插件存储（saveData("history")）里的会话历史。 */
export interface WenguHistory {
    version: 1;
    sessions: WenguSession[];
}

/**
 * N 刷会话历史存储。
 *
 * 官方没有给插件在内核 SQLite 建表的 API（/api/query/sql 只读），
 * 会话历史放插件数据（saveData 的 JSON，落 workspace
 * data/storage/petal/<plugin>/history.json）正合适：数据量小（每轮
 * 一条对象、逐题结果内嵌），整文件读写即可，无需数据库。
 *
 * 块属性仍是单题「最新状态 + 终身累计」的家（随文档走、可 SQL 聚合、
 * 联动闪卡）；本存储补上「按轮次」的维度。
 */
export class HistoryStore {
    private cache?: WenguHistory;

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (h: WenguHistory) => Promise<unknown>,
    ) {}

    private async all(): Promise<WenguHistory> {
        if (this.cache) return this.cache;
        try {
            const data = await this.loadRaw() as WenguHistory | "" | null | undefined;
            this.cache = data && typeof data === "object" && Array.isArray(data.sessions) ?
                data :
                {version: 1, sessions: []};
        } catch (_) {
            this.cache = {version: 1, sessions: []};
        }
        return this.cache;
    }

    /** 新建/更新一轮（同 id 覆盖），整文件落盘——量级小，直接写。 */
    async upsert(session: WenguSession): Promise<void> {
        const h = await this.all();
        const i = h.sessions.findIndex((s) => s.id === session.id);
        if (i >= 0) h.sessions[i] = session;
        else h.sessions.push(session);
        try {
            await this.saveRaw(h);
        } catch (_) {
            // 尽力而为：写失败不阻断答题（内存态仍在）
        }
    }

    /** 某文档的全部轮次，按开始时间升序。 */
    async docSessions(docId: string): Promise<WenguSession[]> {
        const h = await this.all();
        return h.sessions
            .filter((s) => s.docId === docId)
            .sort((a, b) => a.startedAt - b.startedAt);
    }
}

/** 会话 id：时间戳 + 随机串，够用且可读。 */
export function newSessionId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
