import { svgIcon } from "../ui/FormHtml";
import type { ReviewAttempt } from "./";
import { esc, fmt, fmtDateTime } from "../ui/shared";

/**
 * 错题本（复习模式）纯渲染层：清单（按文档分组）+ 单题回看详情。
 * 只做字符串拼接；数据装载/事件绑定在 ReviewFlow，样式在 scss/review.scss。
 */

type T = (k: string) => string;

/** 清单条目模型（ReviewFlow 聚合后传入）。 */
export interface ReviewItemModel {
    qid: string;
    stemSummary: string;
    wrongCount: number;
    /** 掌握=错过且最近一次对（D4 口径）。 */
    mastered: boolean;
    lastWrongAt?: number;
    cause?: string;
    knowledge?: string;
}

/** 一个文档的错题分组（组头带「重刷本文档」）。 */
export interface ReviewGroupModel {
    docId: string;
    docTitle: string;
    /** 未掌握数（重刷按钮的计数）。 */
    pending: number;
    items: ReviewItemModel[];
}

/** 清单渲染入参。 */
export interface ReviewListModel {
    t: T;
    groups: ReviewGroupModel[];
    total: number;
    pending: number;
    mastered: number;
    filter: "all" | "pending" | "mastered";
    sort: "recent" | "count";
}

/** 复习模式主区（工具行 + 左清单右详情两栏）。 */
export function renderReviewMainHtml(m: ReviewListModel): string {
    const { t } = m;
    const opt = (v: string, label: string, cur: string) =>
        `<option value="${v}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
    return `<div class="wengu-review">
  <div class="wengu-review-tools">
    <select class="b3-select" data-review-filter title="${esc(t("reviewFilterTitle"))}">
      ${opt("all", t("reviewFilterAll"), m.filter)}${opt("pending", t("reviewFilterPending"), m.filter)}${opt(
          "mastered",
          t("reviewFilterMastered"),
          m.filter
      )}
    </select>
    <select class="b3-select" data-review-sort title="${esc(t("reviewSortTitle"))}">
      ${opt("recent", t("reviewSortRecent"), m.sort)}${opt("count", t("reviewSortCount"), m.sort)}
    </select>
    <span class="wengu-muted wengu-review-summary">${esc(
        fmt(t("reviewSummary"), { n: String(m.total), p: String(m.pending), m: String(m.mastered) })
    )}</span>
    <button class="wengu-side-iconbtn" data-act="review-refresh" title="${esc(t("quizRefresh"))}">${svgIcon(
        "iconRefresh"
    )}</button>
  </div>
  <div class="wengu-review-cols">
    <div class="wengu-review-list" data-review-list>${renderGroupsHtml(m)}</div>
    <div class="wengu-review-detail" data-review-detail>
      <div class="wengu-muted wengu-review-detail-empty">${esc(t("reviewPickHint"))}</div>
    </div>
  </div>
</div>`;
}

/** 分组清单（空态两种：无错题 / 筛选后为空）。 */
export function renderGroupsHtml(m: ReviewListModel): string {
    if (m.groups.length === 0) {
        return `<div class="wengu-muted wengu-review-empty">${esc(
            m.total === 0 ? m.t("reviewEmpty") : m.t("reviewFilterEmpty")
        )}</div>`;
    }
    return m.groups.map((g) => renderGroupHtml(g, m.t)).join("");
}

function renderGroupHtml(g: ReviewGroupModel, t: T): string {
    const drill = `<button class="b3-button b3-button--outline wengu-review-redrill" data-redrill="${esc(
        g.docId
    )}"${g.pending === 0 ? " disabled" : ""}>${esc(fmt(t("reviewRedrill"), { n: String(g.pending) }))}</button>`;
    return `<div class="wengu-review-group" data-doc-group="${esc(g.docId)}">
  <div class="wengu-review-group-head">
    <span class="wengu-review-group-title" title="${esc(g.docTitle)}">${esc(g.docTitle)}</span>
    ${drill}
  </div>
  ${g.items.map((it) => renderItemHtml(it, t)).join("")}
</div>`;
}

function renderItemHtml(it: ReviewItemModel, t: T): string {
    const meta = [
        it.knowledge ? esc(it.knowledge) : "",
        esc(fmt(t("statsWrongCount"), { n: String(it.wrongCount) })),
        it.lastWrongAt ? fmtDateTime(it.lastWrongAt) : "",
    ]
        .filter(Boolean)
        .join(" · ");
    const badge = it.mastered
        ? `<span class="wengu-review-badge wengu-review-badge-mastered">${esc(t("reviewFilterMastered"))}</span>`
        : `<span class="wengu-review-badge wengu-review-badge-pending">${esc(t("reviewFilterPending"))}</span>`;
    const cause = it.cause ? `<span class="wengu-review-cause">${esc(t(`weakCause${cap(it.cause)}`))}</span>` : "";
    return `<div class="wengu-review-item" data-review-qid="${esc(it.qid)}">
  <div class="wengu-review-item-stem" title="${esc(it.stemSummary)}">${esc(it.stemSummary)}</div>
  <div class="wengu-review-item-meta">${meta}</div>
  <div class="wengu-review-item-tags">${badge}${cause}</div>
</div>`;
}

function cap(s: string): string {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** 详情模型（ReviewFlow 惰性 hydrate 后构建；html 均已 Lute 渲染）。 */
export interface ReviewDetailModel {
    qid: string;
    docTitle: string;
    stemHtml: string;
    optionsHtml: string;
    stepsHtml: string;
    timelineHtml: string;
    answerHtml: string;
    solutionHtml: string;
    loading?: boolean;
}

/** 详情加载骨架。 */
export function renderDetailLoadingHtml(t: T): string {
    return `<div class="wengu-muted">${esc(t("loading"))}</div>`;
}

/** 单题回看：题目 + 历次作答时间线 + 正确答案/解析 + 跳源块。 */
export function renderReviewDetailHtml(t: T, d: ReviewDetailModel): string {
    const section = (title: string, body: string, cls = "") =>
        body
            ? `<div class="wengu-review-sec${cls ? ` ${cls}` : ""}"><div class="wengu-review-sec-title">${esc(title)}</div>${body}</div>`
            : "";
    return `<div class="wengu-review-detail-inner">
  ${section(t("reviewSecQuestion"), `<div class="wengu-review-q">${d.stemHtml}</div>${d.optionsHtml}${d.stepsHtml}`)}
  ${section(t("reviewSecTimeline"), d.timelineHtml)}
  ${section(t("reviewSecAnswer"), d.answerHtml, " wengu-review-sec-answer")}
  ${section(t("reviewSecSolution"), d.solutionHtml)}
  <div class="wengu-review-detail-actions">
    <button class="b3-button b3-button--outline" data-review-copy title="${esc(t("pvCopyTitle"))}">
      ${svgIcon("iconCopy")} ${esc(t("pvCopyTitle"))}
    </button>
    <button class="b3-button b3-button--outline" data-goto-block="${esc(d.qid)}">
      ${svgIcon("iconRight")} ${esc(t("reviewGotoBlock"))}
    </button>
  </div>
</div>`;
}

/** 历次作答时间线（最新在上；qid#k 条目由 Flow 归并后传入）。 */
export function renderTimelineHtml(t: T, attempts: ReviewAttempt[]): string {
    if (attempts.length === 0) return `<div class="wengu-muted">${esc(t("reviewNoAttempts"))}</div>`;
    return attempts
        .slice()
        .sort((a, b) => b.ts - a.ts)
        .map((a) => {
            const mark = a.ok ? "right" : a.verdict === "partial" ? "partial" : "wrong";
            const icon = mark === "right" ? "iconCheck" : mark === "partial" ? "iconIndeterminateCheck" : "iconClose";
            const comment = a.comment ? `<div class="wengu-review-tl-comment">${esc(a.comment)}</div>` : "";
            const cause = a.cause
                ? `<div class="wengu-review-tl-cause">${esc(t(`weakCause${cap(a.cause)}`))}</div>`
                : "";
            return `<div class="wengu-review-tl-item">
  <span class="wengu-review-tl-time">${fmtDateTime(a.ts)}</span>
  <span class="wengu-review-tl-mark wengu-review-tl-${mark}">${svgIcon(icon)}</span>
  <div class="wengu-review-tl-body">
    <div class="wengu-review-tl-ans">${esc(fmt(t("reviewTlAnswer"), { a: a.submitted }))}</div>
    ${comment}${cause}
  </div>
</div>`;
        })
        .join("");
}
