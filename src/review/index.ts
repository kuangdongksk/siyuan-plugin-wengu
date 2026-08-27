import { ATTR_PREFIX, Attr } from "../siyuan/attrs";
import { KernelQuery } from "../siyuan/query";
import type { HistoryStore, WenguSession } from "../quiz/HistoryStore";
import { mdFragmentHtml, renderMathIn } from "../quiz/ProtyleHost";
import { copyQuestionText } from "../quiz/PreviewFlow";
import { renderHeadHtml, renderSideHtml } from "../quiz/CardHtml";
import { renderRailHtml } from "../quiz/RailHtml";
import {
    renderDetailLoadingHtml,
    renderGroupsHtml,
    renderReviewDetailHtml,
    renderReviewMainHtml,
    renderTimelineHtml,
    type ReviewDetailModel,
    type ReviewGroupModel,
    type ReviewItemModel,
} from "./ReviewHtml";
import { hydrate, rowToQuestion, type AttrsRow } from "../quiz/QuestionService";
import type { WenguDoc, WenguQuestion } from "../types";
import { optionDisplayMd } from "../types";
import { esc, fmt } from "../ui/shared";

/**
 * 错题本（复习模式，M6 mode="review"）编排：全局错题 SQL 清单（块属性
 * 为唯一事实源，不碰题库镜像）+ 会话历史时间线索引 + 单题惰性回看。
 *
 * 「看」是全局的（跨文档清单），「刷」按文档进行——组头「重刷本文档」
 * 切回做题模式并以 scope=wrongAll 直落开轮（D5）。UI 状态与数据缓存
 * 为模块级（同统计面板的单例模式），视图重渲染不丢筛选与选中。
 * 侧栏/头部事件由 QuizView 统一绑定（复习模式下点文档=筛选该文档）。
 */

/** 一条历史作答（时间线行；qid#k 已按题归并）。 */
export interface ReviewAttempt {
    ts: number;
    submitted: string;
    ok: boolean;
    verdict?: "right" | "partial" | "wrong";
    comment?: string;
    cause?: string;
}

/** 错题清单条目（块属性 + 会话索引的合成视图）。 */
export interface ReviewItem extends ReviewItemModel {
    qid: string;
    docId: string;
    type?: WenguQuestion["type"];
    lastAnswer?: string;
    attempts: ReviewAttempt[];
}

/** 复习模式渲染所需的视图能力（QuizView 用箭头属性实现）。 */
export interface ReviewViewAccess {
    readonly el: HTMLElement;
    t(key: string): string;
    historyStore(): HistoryStore | undefined;
    docsOf(): WenguDoc[];
    /** 侧栏树展开集合（树形渲染与做题模式共用）。 */
    sideTreeOpenOf(): string[];
    /** 组头「重刷本文档」：切做题模式 + scope=wrongAll 开轮。 */
    startReviewDrill(docId: string): void;
    /** 完整重渲染（含头部重绑——renderReviewFor 只重绘不绑头部，直接调会丢切换器事件）。 */
    rerenderView(): void;
}

/* ── 模块级 UI 状态与数据缓存 ── */
const ui = {
    filter: "all" as "all" | "pending" | "mastered",
    sort: "recent" as "recent" | "count",
    docFilter: "",
    selQid: "",
};
let cache: { items: ReviewItem[]; at: number } | undefined;
let cacheSeq = 0; // 在途装载的代数：重渲染/刷新时旧结果放弃
let docTitles = new Map<string, string>();

const CACHE_TTL_MS = 60_000;
const SQL_PAGE = 512;

/** 复习模式主渲染入口（QuizView.renderListInner 的 review 分支调，
 *  头部/侧栏事件由调用方随后统一绑定）。 */
export function renderReviewFor(v: ReviewViewAccess): void {
    const t = v.t;
    const m = listModelOf(t, cache?.items ?? []);
    const o = wrongOverviewNow();
    const summary = o ? fmt(t("reviewHeadSummary"), { p: String(o.pending), m: String(o.mastered) }) : t("reviewTitle");
    v.el.innerHTML =
        renderRailHtml(t, "drill") +
        renderSideHtml({
            t,
            docs: v.docsOf(),
            docId: "",
            sideCollapsed: false,
            hasSettingsButton: true,
            filter: "",
            collections: [],
            activeCollection: "",
            sideTreeOpen: v.sideTreeOpenOf(),
        }) +
        `<div class="wengu-main wengu-review-main">
  <div class="wengu-head">${renderHeadHtml(t, false, esc(summary))}</div>
  ${renderReviewMainHtml(m)}
</div>`;
    bindReviewEvents(v);
    void renderDetailFor(v, ui.selQid);
    if (!cache || Date.now() - cache.at > CACHE_TTL_MS) void refreshReview(v);
}

/** 清单/排序/选中/跳块/刷新的事件绑定。 */
function bindReviewEvents(v: ReviewViewAccess): void {
    const root = v.el;
    root.querySelector("[data-act='review-refresh']")?.addEventListener("click", () => {
        cache = undefined; // 手动刷新绕过 TTL
        void refreshReview(v);
    });
    root.querySelector<HTMLSelectElement>("[data-review-filter]")?.addEventListener("change", (ev) => {
        ui.filter = (ev.target as HTMLSelectElement).value as typeof ui.filter;
        rerenderListOnly(v);
    });
    root.querySelector<HTMLSelectElement>("[data-review-sort]")?.addEventListener("change", (ev) => {
        ui.sort = (ev.target as HTMLSelectElement).value as typeof ui.sort;
        rerenderListOnly(v);
    });
    root.querySelector("[data-review-list]")?.addEventListener("click", (ev) => {
        const redrill = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-redrill]");
        if (redrill && !redrill.disabled) {
            v.startReviewDrill(redrill.dataset.redrill ?? "");
            return;
        }
        const item = (ev.target as HTMLElement).closest<HTMLElement>("[data-review-qid]");
        if (item) {
            ui.selQid = item.dataset.reviewQid ?? "";
            root.querySelectorAll(".wengu-review-item-cur").forEach((n) => n.classList.remove("wengu-review-item-cur"));
            item.classList.add("wengu-review-item-cur");
            void renderDetailFor(v, ui.selQid);
        }
    });
    root.querySelector("[data-review-detail]")?.addEventListener("click", (ev) => {
        if ((ev.target as HTMLElement).closest("[data-review-copy]")) {
            if (detailQ) void copyQuestionText(detailQ, v.t);
            return;
        }
        const goto = (ev.target as HTMLElement).closest<HTMLElement>("[data-goto-block]");
        if (goto?.dataset.gotoBlock) window.open(`siyuan://blocks/${goto.dataset.gotoBlock}`);
    });
}

/** 筛选/排序变化只重绘清单块（下拉不重建、详情不动）。 */
function rerenderListOnly(v: ReviewViewAccess): void {
    const list = v.el.querySelector("[data-review-list]");
    if (list) list.innerHTML = renderGroupsHtml(listModelOf(v.t, cache?.items ?? []));
}

/** 侧栏点文档（复习模式）＝清单筛选该文档；再点一次取消。 */
export function filterReviewDocFor(docId: string): void {
    ui.docFilter = ui.docFilter === docId ? "" : docId;
}

/** 统计面板「进错题本」/错题行点击的定位（切模式后由渲染消费）。 */
export function selectReviewQid(qid: string): void {
    ui.selQid = qid;
    cache = undefined; // 定位语义要求最新清单，直接重拉
}

/** 组装清单模型：筛选（状态/文档）→ 排序 → 按文档分组。 */
function listModelOf(t: (k: string) => string, items: ReviewItem[]) {
    const filtered = items.filter((it) => {
        if (ui.filter === "pending" && it.mastered) return false;
        if (ui.filter === "mastered" && !it.mastered) return false;
        if (ui.docFilter && it.docId !== ui.docFilter) return false;
        return true;
    });
    filtered.sort((a, b) =>
        ui.sort === "count"
            ? b.wrongCount - a.wrongCount || (b.lastWrongAt ?? 0) - (a.lastWrongAt ?? 0)
            : (b.lastWrongAt ?? 0) - (a.lastWrongAt ?? 0) || b.wrongCount - a.wrongCount
    );
    const byDoc = new Map<string, ReviewItem[]>();
    for (const it of filtered) {
        const arr = byDoc.get(it.docId) ?? [];
        arr.push(it);
        byDoc.set(it.docId, arr);
    }
    const groups: ReviewGroupModel[] = [];
    for (const [docId, arr] of byDoc) {
        groups.push({
            docId,
            docTitle: docTitleOf(docId),
            pending: arr.filter((x) => !x.mastered).length,
            items: arr,
        });
    }
    groups.sort((a, b) => (b.items[0]?.lastWrongAt ?? 0) - (a.items[0]?.lastWrongAt ?? 0));
    const pending = items.filter((x) => !x.mastered).length;
    return {
        t,
        groups,
        total: items.length,
        pending,
        mastered: items.length - pending,
        filter: ui.filter,
        sort: ui.sort,
    };
}

function docTitleOf(docId: string): string {
    return docTitles.get(docId) || docId.slice(0, 10);
}

/** 全局错题装载：SQL 分页直查块属性（事实源）+ history 时间线索引，
 *  完成后重渲染（缓存刷新，TTL 内的重复触发不重拉）。 */
async function refreshReview(v: ReviewViewAccess): Promise<void> {
    const seq = ++cacheSeq;
    const rows = await listWrongRows();
    const sessions = (await v.historyStore()?.allSessions()) ?? [];
    if (seq !== cacheSeq) return; // 已有更新的装载在途
    docTitles = new Map(v.docsOf().map((d) => [d.id, d.title || d.id]));
    cache = { items: mergeItems(rows, sessions), at: Date.now() };
    if (!v.el.isConnected || !v.el.querySelector("[data-review-list]")) return; // 视图已切走
    v.rerenderView();
}

/** SQL 分页直查 wrong-count>0 的题块（仿 listQuestions 的聚合，
 *  附带 blocks.content 做摘要；不 hydrate——详情点开才取）。 */
async function listWrongRows(): Promise<(AttrsRow & { content?: string })[]> {
    const out: (AttrsRow & { content?: string })[] = [];
    for (let offset = 0; offset < 100 * SQL_PAGE; offset += SQL_PAGE) {
        const stmt = `
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
            GROUP BY b.id
            LIMIT ${SQL_PAGE} OFFSET ${offset};`;
        const rows = (await KernelQuery.rows<AttrsRow & { content?: string }>(stmt)).filter(
            (r) => typeof r.attrs === "string"
        );
        out.push(...rows);
        if (rows.length < SQL_PAGE) break;
    }
    return out;
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

/** 详情渲染：选中题惰性 hydrate（fetchSyncPost 串行约束天然满足），
 *  重渲染代际变化则放弃填充；hydrated 题存模块级供「复制题目」用。 */
let detailQ: WenguQuestion | undefined;
async function renderDetailFor(v: ReviewViewAccess, qid: string): Promise<void> {
    const box = v.el.querySelector<HTMLElement>("[data-review-detail]");
    if (!box) return;
    if (!qid) {
        box.innerHTML = `<div class="wengu-muted wengu-review-detail-empty">${esc(v.t("reviewPickHint"))}</div>`;
        return;
    }
    const item = cache?.items.find((x) => x.qid === qid);
    if (!item) {
        box.innerHTML = renderDetailLoadingHtml(v.t);
        return;
    }
    box.innerHTML = renderDetailLoadingHtml(v.t);
    const q: WenguQuestion = { id: item.qid, attempts: 0, wrongCount: item.wrongCount, type: item.type };
    try {
        await hydrate(q);
        detailQ = q; // 快捷复制的原料（题干/选项/答案/解析已齐）
    } catch (_) {
        // 保留已知信息（时间线/摘要），题目正文缺省
    }
    if (v.el.querySelector("[data-review-detail]") !== box) return; // 已重渲染
    const t = v.t;
    const optionsHtml = (q.optionMd ?? [])
        .map((md) => `<div class="wengu-review-option">${mdFragmentHtml(optionDisplayMd(md))}</div>`)
        .join("");
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
        docTitle: docTitleOf(item.docId),
        stemHtml: q.stemMd ? mdFragmentHtml(q.stemMd) : `<div class="wengu-muted">${esc(item.stemSummary)}</div>`,
        optionsHtml,
        stepsHtml,
        timelineHtml: renderTimelineHtml(t, item.attempts),
        answerHtml: q.answer ? mdFragmentHtml(q.answer) : "",
        solutionHtml: q.solutionMd ? mdFragmentHtml(q.solutionMd) : "",
    };
    box.innerHTML = renderReviewDetailHtml(t, d);
    renderMathIn(box);
}

/** 统计面板总览「错题概况」的数据（缓存命中即回；未命中由面板自拉）。 */
export function wrongOverviewNow(): { pending: number; mastered: number } | undefined {
    if (!cache) return undefined;
    const pending = cache.items.filter((x) => !x.mastered).length;
    return { pending, mastered: cache.items.length - pending };
}
