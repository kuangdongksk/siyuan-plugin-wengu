import { ATTR_PREFIX, Attr } from "../../siyuan/attrs";
import { KernelQuery } from "../../siyuan/query";
import type { ReviewViewAccess } from "../index";
import { mdFragmentHtml, optionRowHtml } from "../../quiz/service/ProtyleHost";
import { copyQuestionText } from "../../quiz/flow/PreviewFlow";
import { hydrate, rowToQuestion, type AttrsRow } from "../../quiz/service/QuestionService";
import { renderTimelineHtml, type ReviewDetailModel } from "../ReviewHtml";
import type { ReviewAttempt, ReviewItem, ReviewUi } from "./ReviewUi";
import type { WenguSession } from "../../quiz/service/HistoryStore";
import type { WenguQuestion } from "../../types";
import { esc } from "../../ui/shared";

/**
 * 错题本控制器（四件套之一，模块级单例——外部域在视图外也要读写
 * 筛选/定位/缓存，状态必须跨视图生命周期存活）。attach/detach 对齐
 * 「视图重挂」节奏：renderList 全量重绘会 unmount 组件，持久字段留在
 * ctl，下次 attach 同步进新 ui。数据事实源=块属性 SQL（不碰题库镜像），
 * 「看」是全局的、「刷」按文档进行（组头重刷按钮）。
 */
export class ReviewCtl {
    private ui?: ReviewUi;
    private v?: ReviewViewAccess;
    private alive = false;
    /* 持久状态（旧模块级变量语义） */
    private filter: "all" | "pending" | "mastered" = "all";
    private sort: "recent" | "count" = "recent";
    private docFilter = "";
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

    /** 详情「跳源块」。 */
    gotoBlock(id: string): void {
        window.open(`siyuan://blocks/${id}`);
    }

    /** 组标题（装载时缓存的文档标题映射）。 */
    docTitleOf(docId: string): string {
        return this.docTitles.get(docId) || docId.slice(0, 10);
    }

    /* ── 装载（SQL 分页直查块属性 + history 时间线索引） ── */

    private async reload(): Promise<void> {
        if (!this.alive) return;
        const seq = ++this.cacheSeq;
        const rows = await listWrongRows();
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
            const q: WenguQuestion = { id: item.qid, attempts: 0, wrongCount: item.wrongCount, type: item.type };
            try {
                await hydrate(q);
            } catch (_) {
                // 保留已知信息（时间线/摘要），题目正文缺省
            }
            if (seq !== this.detailSeq || !this.alive) return;
            const t = this.v?.t;
            if (!t) return;
            const optRows = (q.optionMd ?? []).map((md, i) => optionRowHtml(i, md, "wengu-review-option")).join("");
            // .wengu-opts 容器：短选项多列排布挂点（opt-compact，同题库静态路径）
            const optionsHtml = optRows ? `<div class="wengu-opts">${optRows}</div>` : "";
            const stepsHtml = (q.steps ?? [])
                .map(
                    (s, i) =>
                        `<div class="wengu-review-step"><span class="wengu-muted">#${i + 1}</span><div class="wengu-review-step-stem">${mdFragmentHtml(
                            s.stemMd
                        )}</div><div class="wengu-review-step-ans">${mdFragmentHtml(s.answer)}</div></div>`
                )
                .join("");
            const d: ReviewDetailModel = {
                qid: item.qid,
                docTitle: this.docTitleOf(item.docId),
                stemHtml: q.stemMd
                    ? mdFragmentHtml(q.stemMd)
                    : `<div class="wengu-muted">${esc(item.stemSummary)}</div>`,
                optionsHtml,
                stepsHtml,
                timelineHtml: renderTimelineHtml(t, item.attempts),
                answerHtml: q.answer ? mdFragmentHtml(q.answer) : "",
                solutionHtml: q.solutionMd ? mdFragmentHtml(q.solutionMd) : "",
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

/** SQL 直查 wrong-count>0 的题块（仿 listQuestions 的聚合，附带
 *  blocks.content 做摘要；不 hydrate——详情点开才取；rowsAll 自动分页）。 */
async function listWrongRows(): Promise<(AttrsRow & { content?: string })[]> {
    const rows = await KernelQuery.rowsAll<AttrsRow & { content?: string }>(`
            SELECT
                b.id AS block_id,
                b.root_id,
                b.content AS content,
                '{' || GROUP_CONCAT('"' || a.name || '":"' || a.value || '"', ',') || '}' AS attrs
            FROM attributes AS a, blocks AS b
            WHERE a.name LIKE '${ATTR_PREFIX}%'
              AND a.block_id = b.id
              AND b.id IN (
                  SELECT block_id FROM attributes
                  WHERE name = '${Attr.wrongCount}' AND CAST(value AS INTEGER) > 0
              )
            GROUP BY b.id`);
    return rows.filter((r) => typeof r.attrs === "string");
}

/** 块属性行 × 会话索引 → 清单条目（掌握口径 D4：最近一次对即掌握）。 */
function mergeItems(rows: (AttrsRow & { content?: string })[], sessions: WenguSession[]): ReviewItem[] {
    const timeline = new Map<string, ReviewAttempt[]>();
    for (const s of sessions) {
        for (const r of s.results) {
            const qid = r.qid.split("#")[0];
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
    return rows.map((row) => {
        const q = rowToQuestion(row);
        const attempts = timeline.get(q.id) ?? [];
        const wrongs = attempts.filter((a) => !a.ok);
        const lastWrong = wrongs[wrongs.length - 1];
        return {
            qid: q.id,
            docId: row.root_id,
            type: q.type,
            wrongCount: q.wrongCount,
            right: q.right,
            lastAnswer: q.lastAnswer,
            knowledge: q.knowledge,
            stemSummary: plainSummary(row.content ?? q.lastAnswer ?? q.id),
            mastered: q.right === "1",
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
