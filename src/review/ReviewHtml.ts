import { svgIcon } from "../ui/FormHtml";
import type { ReviewAttempt } from "./core/ReviewUi";
import { esc, fmt, fmtDateTime } from "../ui/shared";

/**
 * 错题本（复习模式）的模型层（Svelte 化前的清单/详情渲染函数已删，
 * 20260830）：清单分组纯函数 + 详情模型类型 + 历次作答时间线的 HTML
 * 串（svg/Lute 产物统一走 {@html} 桥接，与详情其余 html 字段同口径）。
 * 数据装载/事件在 core/ReviewCtl，组件在 comp/，样式在 scss/review.scss。
 */

/** 清单条目模型（ReviewCtl 聚合后传入）。 */
export interface ReviewItemModel {
    qid: string;
    /** 归属文档（清单分组的键）。 */
    docId: string;
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

/** 清单模型（组件 $derived 现算；文案层 t 在组件侧取）。 */
export interface ReviewListModel {
    groups: ReviewGroupModel[];
    total: number;
    pending: number;
    mastered: number;
}

/** 组装清单模型：筛选（状态/文档）→ 排序 → 按文档分组。 */
export function listReviewModel(
    items: ReviewItemModel[],
    filter: "all" | "pending" | "mastered",
    sort: "recent" | "count",
    docFilter: string,
    docTitleOf: (docId: string) => string
): ReviewListModel {
    const filtered = items.filter((it) => {
        if (filter === "pending" && it.mastered) return false;
        if (filter === "mastered" && !it.mastered) return false;
        if (docFilter && it.docId !== docFilter) return false;
        return true;
    });
    filtered.sort((a, b) =>
        sort === "count"
            ? b.wrongCount - a.wrongCount || (b.lastWrongAt ?? 0) - (a.lastWrongAt ?? 0)
            : (b.lastWrongAt ?? 0) - (a.lastWrongAt ?? 0) || b.wrongCount - a.wrongCount
    );
    const byDoc = new Map<string, ReviewItemModel[]>();
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
    return { groups, total: items.length, pending, mastered: items.length - pending };
}

/** 详情模型（ReviewCtl 惰性 hydrate 后构建；html 均已 Lute 渲染）。 */
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

/** 历次作答时间线（最新在上；qid#k 条目由 Ctl 归并后传入）。 */
export function renderTimelineHtml(t: (k: string) => string, attempts: ReviewAttempt[]): string {
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

function cap(s: string): string {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}
