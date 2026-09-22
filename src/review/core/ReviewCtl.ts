import { originDocIdOf, questionOf } from "../../bank/data/BankSets";
import { copyQuestionText } from "../../quiz/flow/PreviewFlow";
import { stripIal } from "../../siyuan/kramdown";
import type { BankRecord, QuestionBank } from "../../bank/data/QuestionBank";
import { baseQid, normalizeType } from "../../types";
import type { ReviewViewAccess } from "../index";
import { renderDetailModel, renderTimelineHtml, type ReviewDetailModel } from "../ReviewHtml";
import type { ReviewAttempt, ReviewItem, ReviewUi } from "./ReviewUi";
import type { WenguSession } from "../../quiz/service/HistoryStore";
import type { WenguQuestion } from "../../types";

/**
 * 错题本控制器（四件套之一，模块级单例——外部域在视图外也要读写
 * 筛选/定位/缓存，状态必须跨视图生命周期存活）。attach/detach 对齐
 * 「视图重挂」节奏：renderList 全量重绘会 unmount 组件，持久字段留在
 * ctl，下次 attach 同步进新 ui。数据事实源=题库 records 统计（20260831
 * 自托管后块属性停写，原 wrong-count SQL 直查随之退役），「看」是全局
 * 的、「刷」按文档进行（组头重刷按钮）。
 */
export class ReviewCtl {
    private ui?: ReviewUi;
    private v?: ReviewViewAccess;
    private alive = false;
    /* 持久状态（旧模块级变量语义） */
    private filter: "all" | "pending" | "mastered" = "all";
    private sort: "recent" | "count" = "recent";
    private docFilter = "";
    /** 相关题弹窗「回顾」传入的 qid 集（Issue #44；空集=不筛）。
     *  与 docFilter 并存时按交集语义（listReviewModel 纯合取）。 */
    private qidFilter?: Set<string> = undefined;
    private selQid = "";
    private cache?: { items: ReviewItem[]; at: number };
    private cacheSeq = 0; // 在途装载的代数：重挂/刷新时旧结果放弃
    private docTitles = new Map<string, string>();
    /* 详情串行链（快速连点不再并发 fetchSyncPost——内核并发互吞响应） */
    private detailQ?: WenguQuestion;
    private detailSeq = 0;
    private detailChain: Promise<void> = Promise.resolve();

    /** 组件挂载（onMount）：同步持久字段、按缓存渲染、TTL 过期装载。 */
    attach(ui: ReviewUi, v: ReviewViewAccess): void {
        this.ui = ui;
        this.v = v;
        this.alive = true;
        ui.filter = this.filter;
        ui.sort = this.sort;
        ui.docFilter = this.docFilter;
        ui.qidFilter = this.qidFilter;
        ui.selQid = this.selQid;
        ui.items = this.cache?.items ?? [];
        void this.renderDetail(this.selQid);
        if (!this.cache || Date.now() - this.cache.at > CACHE_TTL_MS) void this.refresh();
    }

    /** 组件卸载（cleanup）：在途装载与详情作废，持久状态留存。 */
    detach(): void {
        this.cacheSeq++;
        this.detailSeq++;
        this.alive = false;
        this.ui = undefined;
        this.v = undefined;
    }

    /* ── 外部入口（视图可能不在场；quiz 侧栏/统计面板调用） ── */

    /** 侧栏点文档（复习模式）＝清单筛选该文档；再点一次取消。 */
    filterDoc(docId: string): void {
        this.docFilter = this.docFilter === docId ? "" : docId;
        if (this.ui) this.ui.docFilter = this.docFilter;
    }

    /** 相关题弹窗「回顾」：按 qid 集筛选错题（同集再点=取消，回全部）。
     *  只管筛选口径，错题清单/详情/时间线全走既有通道——不新做重刷。
     *  进入时**清掉 docFilter**：头部徽标只展示 qid 集这一维，留着上一轮
     *  侧栏点文档的文档筛会让「回顾」静默变窄（用户看不懂为何少了几题）。 */
    filterQids(qids: string[]): void {
        const next = new Set(qids);
        const same = this.qidFilter?.size === next.size && [...next].every((q) => this.qidFilter?.has(q) === true);
        this.qidFilter = same || next.size === 0 ? undefined : next;
        if (this.qidFilter) this.docFilter = "";
        this.cache = undefined; // 筛选维度变了：定位/概览缓存不再代表当前集
        if (this.ui) {
            this.ui.qidFilter = this.qidFilter;
            this.ui.docFilter = this.docFilter;
        }
    }

    /** 清除 qid 集筛选（头部徽标「查看全部」）。 */
    clearQidFilter(): void {
        if (!this.qidFilter) return;
        this.qidFilter = undefined;
        this.cache = undefined;
        if (this.ui) this.ui.qidFilter = this.qidFilter;
        void this.reload();
    }

    /** 当前 qid 集筛选（头部徽标文案用；undefined=未筛）。 */
    qidFilterNow(): Set<string> | undefined {
        return this.qidFilter;
    }

    /** 文档筛现值（侧栏选中态/头部展示用；空=全部）。 */
    docFilterNow(): string {
        return this.docFilter;
    }

    /** 统计面板「进错题本」/错题行点击的定位（切模式后由渲染消费）。 */
    selectQid(qid: string): void {
        this.selQid = qid;
        this.cache = undefined; // 定位语义要求最新清单，直接重拉
        if (this.ui) this.ui.selQid = qid;
    }

    /** 统计面板总览「错题概况」（缓存命中即回；未命中由面板自拉）。 */
    overview(): { pending: number; mastered: number } | undefined {
        if (!this.cache) return undefined;
        const pending = this.cache.items.filter((x) => !x.mastered).length;
        return { pending, mastered: this.cache.items.length - pending };
    }

    /* ── 组件事件 ── */

    setFilter(f: "all" | "pending" | "mastered"): void {
        this.filter = f;
        if (this.ui) this.ui.filter = f;
    }

    setSort(s: "recent" | "count"): void {
        this.sort = s;
        if (this.ui) this.ui.sort = s;
    }

    /** 清空 qid 集筛选（外部域在视图外调用；重置/切走时机）。 */
    resetQidFilter(): void {
        this.qidFilter = undefined;
    }

    /** 清单条目点击：选中 + 详情惰性装载。 */
    select(qid: string): void {
        this.selQid = qid;
        if (!this.ui) return;
        this.ui.selQid = qid;
        void this.renderDetail(qid);
    }

    /** 手动刷新（绕过 TTL）。 */
    refresh(force = false): Promise<void> {
        if (!force && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return Promise.resolve();
        return this.reload();
    }

    /** 组头「重刷本文档」：切做题模式 + scope=wrongAll 开轮（D5）。 */
    redrill(docId: string): void {
        this.v?.startReviewDrill(docId);
    }

    /** 详情「复制题目」（渲染落框后才置位的 detailQ）。 */
    copyDetail(): void {
        if (this.detailQ && this.v) void copyQuestionText(this.detailQ, this.v.t);
    }

    /** 详情「查看原文」（Issue #13；Issue #214 收窄）：唯一判据＝题集
     *  有源讲义（set.srcId）→ 跳源讲义；无则零动作（按钮由 detail.gotoId
     *  门控，正常情况下点不到）。点击时异步查库（bank.all() 已缓存，
     *  零额外 IO）。 */
    gotoBlock(id: string): void {
        void (async (): Promise<void> => {
            const bank = this.v?.bankStore();
            const target = bank ? await originDocIdOf(bank, id) : "";
            if (target) window.open(`siyuan://blocks/${target}`);
        })();
    }

    /** 组标题（装载时缓存的文档标题映射）。 */
    docTitleOf(docId: string): string {
        return this.docTitles.get(docId) || docId.slice(0, 10);
    }

    /** 该题是否有「查看原文」目标（唯一判据＝源讲义 set.srcId）。
     *  Issue #214 收窄：存量块题兜底与「查库失败宁可露钮」的 fail-open
     *  一并删除——无源讲义即无目标，不渲染按钮。 */
    private async originOf(qid: string): Promise<string> {
        const bank = this.v?.bankStore();
        return bank ? await originDocIdOf(bank, qid) : "";
    }

    /* ── 装载（SQL 分页直查块属性 + history 时间线索引） ── */

    private async reload(): Promise<void> {
        if (!this.alive) return;
        const seq = ++this.cacheSeq;
        const bank = this.v?.bankStore();
        const rows = bank ? await wrongRecordsOf(bank) : [];
        const sessions = (await this.v?.historyStore()?.allSessions()) ?? [];
        if (seq !== this.cacheSeq || !this.alive) return; // 已有更新的装载在途/视图已切走
        this.docTitles = new Map((this.v?.docsOf() ?? []).map((d) => [d.id, d.title || d.id]));
        this.cache = { items: mergeItems(rows, sessions), at: Date.now() };
        if (!this.ui) return;
        this.ui.items = this.cache.items;
        // 头部 summary 是字符串渲染（壳的一部分），装载完成整壳重绘刷新
        // （旧语义；Svelte 主区随之重挂，持久状态由本单例承接）
        this.v?.rerenderView();
    }

    /* ── 详情：选中题惰性 hydrate，串行链逐个执行 ──
       代际序号双保险：重挂/换选中后旧结果不落框；hydrated 题存字段供
       「复制题目」用，仅在成功渲染当前选中后才置位（hydrate 失败保留
       undefined，复制不会把上一题复制出去）。 */
    private async renderDetail(qid: string): Promise<void> {
        const ui = this.ui;
        if (!ui) return;
        if (!qid) {
            this.detailQ = undefined;
            ui.detail = { phase: "empty" };
            return;
        }
        const item = this.cache?.items.find((x) => x.qid === qid);
        if (!item) {
            this.detailQ = undefined;
            ui.detail = { phase: "loading" };
            return;
        }
        const seq = ++this.detailSeq;
        this.detailQ = undefined; // 等待期间失效：复制不再命中上一题
        ui.detail = { phase: "loading" };
        const run = this.detailChain.then(async (): Promise<void> => {
            if (seq !== this.detailSeq || !this.alive) return;
            // 单题详情直取题库记录解析（零内核 IO；记录缺失保留已知信息）
            let q: WenguQuestion = { id: item.qid, attempts: 0, wrongCount: item.wrongCount, type: item.type };
            try {
                const bank = this.v?.bankStore();
                if (bank) q = (await questionOf(bank, item.qid)) ?? q;
            } catch (_) {
                // 保留已知信息（时间线/摘要），题目正文缺省
            }
            if (seq !== this.detailSeq || !this.alive) return;
            const t = this.v?.t;
            if (!t) return;
            // 「查看原文」渲染门控（Issue #13）：无跳转目标不渲染按钮
            const gotoId = await this.originOf(item.qid);
            if (seq !== this.detailSeq || !this.alive) return;
            const d: ReviewDetailModel = {
                qid: item.qid,
                docTitle: this.docTitleOf(item.docId),
                gotoId,
                ...renderDetailModel({ q, stemSummary: item.stemSummary }),
                timelineHtml: renderTimelineHtml(t, item.attempts),
            };
            this.detailQ = q; // 快捷复制的原料（渲染落框后才置位）
            ui.detail = { phase: "ready", model: d };
        });
        const noop = (): void => undefined;
        this.detailChain = run.then(noop, noop); // 链面吞错保后续可排（错误已在 run 内自兜）
        await run;
    }
}

const CACHE_TTL_MS = 60_000;

/** 题库 wrongCount>0 的记录清单（原 wrong-count 块属性 SQL 直查的自托管
 *  等位；摘要用 kramdown 剥 IAL 后截断，详情点开才 hydrate）。 */
async function wrongRecordsOf(bank: QuestionBank): Promise<BankRecord[]> {
    const data = await bank.all();
    return Object.values(data.records).filter((r) => r.stats.wrongCount > 0);
}

/** 题库记录 × 会话索引 → 清单条目（掌握口径 D4：最近一次对即掌握）。 */
function mergeItems(records: BankRecord[], sessions: WenguSession[]): ReviewItem[] {
    const timeline = new Map<string, ReviewAttempt[]>();
    for (const s of sessions) {
        for (const r of s.results) {
            const qid = baseQid(r.qid);
            const arr = timeline.get(qid) ?? [];
            arr.push({
                ts: s.startedAt,
                submitted: r.submitted,
                ok: r.ok,
                ...(r.verdict ? { verdict: r.verdict } : {}),
                ...(r.comment ? { comment: r.comment } : {}),
                ...(r.cause ? { cause: r.cause } : {}),
            });
            timeline.set(qid, arr);
        }
    }
    return records.map((r) => {
        const attempts = timeline.get(r.qid) ?? [];
        const wrongs = attempts.filter((a) => !a.ok);
        const lastWrong = wrongs[wrongs.length - 1];
        return {
            qid: r.qid,
            docId: r.sourceDocId,
            type: normalizeType(r.type),
            wrongCount: r.stats.wrongCount,
            right: r.stats.right,
            lastAnswer: r.stats.lastAnswer,
            knowledge: r.knowledge,
            stemSummary: plainSummary(stripIal(r.kramdown)),
            mastered: r.stats.right === "1",
            lastWrongAt: lastWrong?.ts,
            cause: lastWrong?.cause,
            attempts,
        };
    });
}

/** 块纯文本摘要（SQL 行自带 content，剥空白截断）。 */
function plainSummary(text: string): string {
    const s = text.replace(/\s+/g, " ").trim();
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/** review 模块级单例（外部域在视图外读写的锚点）。 */
export const reviewCtl = new ReviewCtl();
