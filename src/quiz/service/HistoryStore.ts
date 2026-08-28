import type { WenguRevealMode, WenguStepsMode, WenguTimingMode } from "../../types";

/** 一轮的刷题范围：全部 / 上轮错题 / 历史未掌握错题（复习模式 D5）。 */
export type WenguRoundScope = "all" | "wrong" | "wrongAll";

/** 一题在一轮里的作答记录。 */
export interface WenguSessionResult {
    qid: string;
    submitted: string;
    ok: boolean;
    /** 该题用时（秒，逐题计时模式记录）。 */
    sec?: number;
    /** brief 的 AI 判分三态（partial 统计记错但展示单列）。 */
    verdict?: "right" | "partial" | "wrong";
    /** brief 的 AI 评语（恢复继续时仍能展示）。 */
    comment?: string;
    /** 错因规范键（weakness 画像用，AI 判分/批量归因写入）。 */
    cause?: string;
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
    /** 答案展示方式（旧记录缺省视为即时）。 */
    revealMode?: WenguRevealMode;
    /** 多步题作答模式（旧记录缺省视为离线）。 */
    stepsMode?: WenguStepsMode;
    /** 刷题范围（旧记录缺省视为 all；「继续上次」按它恢复清单，P2-6）。 */
    scope?: WenguRoundScope;
    /** 范围快照（开轮时冻结的 qid 清单）：恢复按它裁剪，避免按该轮自身
     *  结果重算导致范围漂移（旧记录缺省走 scope 重算兜底）。 */
    scopeIds?: string[];
    /** 实际用时（秒，到最近一次作答/收卷为止）。 */
    elapsedSec: number;
    answered: number;
    correct: number;
    results: WenguSessionResult[];
    /** 各题思路（qid→文本，收卷时从题卡「思路」输入区快照；AI 判卷用）。 */
    thoughts?: Record<string, string>;
    /** 各题线索标注（qid→选段文本数组，M5 定位能力训练；纯会话数据不写块）。 */
    clues?: Record<string, string[]>;
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
    private loading?: Promise<WenguHistory>;
    /** 串行落盘链（同 WordStore/ChatStore 模式）：逐题 void upsert 全是
     *  fire-and-forget，快速连答并发 saveData 撞「内核 fetchSyncPost 并发
     *  互吞响应」——一轮最后一次落库被吞则封卷数据（endedAt/最终计数）
     *  丢失（20260829 三轮审查）。 */
    private saveChain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (h: WenguHistory) => Promise<unknown>
    ) {}

    private async all(): Promise<WenguHistory> {
        if (this.cache) return this.cache;
        // in-flight 备忘：并发首载各自 loadRaw 后赋 cache 会互相覆盖丢更新
        if (!this.loading) {
            this.loading = this.loadRaw()
                .then((data) => {
                    // 只把「读到的东西不是合法历史」当空库；**读异常上抛不落
                    // 缓存**——原 catch 一切失败归空库，随后 upsert 把
                    // 「空库+单轮」写回 history.json，全部历史永久丢失
                    // （20260828 二轮审查；loadRaw 的「文件不存在」约定
                    // 返回空串/undefined，进 then 分支归空库，不受影响）
                    this.cache =
                        data && typeof data === "object" && Array.isArray((data as WenguHistory).sessions)
                            ? (data as WenguHistory)
                            : { version: 1, sessions: [] };
                    return this.cache;
                })
                .finally(() => (this.loading = undefined));
        }
        return this.loading;
    }

    /** 新建/更新一轮（同 id 覆盖），整文件落盘——量级小，直接写。 */
    async upsert(session: WenguSession): Promise<void> {
        const h = await this.all();
        const i = h.sessions.findIndex((s) => s.id === session.id);
        if (i >= 0) h.sessions[i] = session;
        else h.sessions.push(session);
        await this.enqueueSave(h);
    }

    /** 挂到串行链落盘（写失败吞错：内存态仍在，下次写入自愈）。 */
    private enqueueSave(h: WenguHistory): Promise<void> {
        const run = this.saveChain.then(() => this.saveRaw(h));
        const noop = (): void => undefined;
        this.saveChain = run.then(noop, noop);
        return run.then(noop, noop);
    }

    /** 某文档的全部轮次，按开始时间升序。 */
    async docSessions(docId: string): Promise<WenguSession[]> {
        const h = await this.all();
        return h.sessions.filter((s) => s.docId === docId).sort((a, b) => a.startedAt - b.startedAt);
    }

    /** 全库全部轮次，按开始时间升序（统计面板总览用）。 */
    async allSessions(): Promise<WenguSession[]> {
        const h = await this.all();
        return [...h.sessions].sort((a, b) => a.startedAt - b.startedAt);
    }

    /** 删除一组文档的全部轮次（孤儿习题文档清理时联动调用）。 */
    async removeDocs(docIds: string[]): Promise<void> {
        if (docIds.length === 0) return;
        const h = await this.all();
        const dead = new Set(docIds);
        h.sessions = h.sessions.filter((s) => !dead.has(s.docId));
        await this.enqueueSave(h);
    }
}

/** 会话 id：时间戳 + 随机串，够用且可读。 */
export function newSessionId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 把一次作答记入会话（计数/用时/三态评语；落库由持有方调用）。 */
export function pushSessionAnswer(
    s: WenguSession,
    qid: string,
    submitted: string,
    ok: boolean,
    sec: number,
    elapsedSec: number,
    extra?: { verdict?: "right" | "partial" | "wrong"; comment?: string; cause?: string }
): void {
    s.results.push({
        qid,
        submitted,
        ok,
        ...(sec > 0 ? { sec } : {}),
        ...(extra?.verdict ? { verdict: extra.verdict } : {}),
        ...(extra?.comment ? { comment: extra.comment } : {}),
        ...(extra?.cause ? { cause: extra.cause } : {}),
    });
    s.answered++;
    if (ok) s.correct++;
    s.elapsedSec = Math.max(s.elapsedSec, elapsedSec);
}
