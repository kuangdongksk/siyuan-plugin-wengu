import { svgIcon } from "../ui/FormHtml";
import { mdFragmentHtml, optionRowHtml } from "../quiz/service/ProtyleHost";
import type { WenguQuestion } from "../types";
import type { ReviewAttempt, ReviewItem } from "./core/ReviewUi";
import { displaySetName, esc, fmt, fmtDateTime, fmtDayShort, fmtFullDateTime } from "../ui/shared";
import { weakCauseLabelKey } from "../bank/data/WeaknessStore";

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
    /** 组头/行头展示名（已过 displaySetName 剥「-题解」后缀，§7.e）。 */
    docTitle: string;
    /** 源文档全名（悬停 title 用；显示层加工不损数据）。 */
    docTitleFull: string;
    /** 未掌握数（重刷按钮的计数）。 */
    pending: number;
    /** 组内条目（ReviewCtl 聚合的完整条目——含 attempts，展开区直接消费）。 */
    items: ReviewItem[];
}

/** 清单模型（组件 $derived 现算；文案层 t 在组件侧取）。 */
export interface ReviewListModel {
    groups: ReviewGroupModel[];
    total: number;
    pending: number;
    mastered: number;
    /** 清单是否处于「全部文档」聚合视图（Issue #136 §5.3）：为真时行头
     *  出题集名列（跨文档看必须知道题从哪来），按文档分组视图下组头已
     *  表达归属 ⇒ 同名列省掉（同一列 190px 宽重复 N 遍纯属噪音）。 */
    aggregated: boolean;
}

/**
 * 组装清单模型：qid 集筛选 → 状态/文档筛选 → 排序 → 按文档分组。
 *
 * qidFilter（Issue #44「回顾」）：相关题弹窗传入的 qid 集，只留这组题里
 * 的错题——**空集 = 不筛**（不是「筛出零条」，否则取消筛选后会空清单）。
 * 它是「数据域」，统计口径（total/pending/mastered）随之走；状态/文档筛
 * 是「看哪部分」，不影响统计（与改造前口径一致）。与 docFilter 并存时按
 * 交集语义（先 qid 后 doc，纯合取，无隐含优先级）。
 */
export function listReviewModel(
    items: ReviewItem[],
    filter: "all" | "pending" | "mastered",
    sort: "recent" | "count",
    docFilter: string,
    docTitleOf: (docId: string) => string,
    qidFilter?: Set<string>
): ReviewListModel {
    // qid 集是**数据域**（这组相关题里有哪些错题），先收窄再走状态/文档
    // 筛选——统计口径（total/pending）只随它变，不随状态/文档筛变（那两维
    // 是「看哪部分」，改概览会推翻旧口径）。空集=不筛。
    const scoped = qidFilter && qidFilter.size > 0 ? items.filter((it) => qidFilter.has(it.qid)) : items;
    const filtered = scoped.filter((it) => {
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
    const byDoc = new Map<string, ReviewItem[]>();
    for (const it of filtered) {
        const arr = byDoc.get(it.docId) ?? [];
        arr.push(it);
        byDoc.set(it.docId, arr);
    }
    const groups: ReviewGroupModel[] = [];
    for (const [docId, arr] of byDoc) {
        // 展示名在此收口（§7.e）：一处加工，组头与行头同时生效；全名随行
        // 带着供悬停 title 用，数据层原值不动。
        const full = docTitleOf(docId);
        groups.push({
            docId,
            docTitle: displaySetName(full),
            docTitleFull: full,
            pending: arr.filter((x) => !x.mastered).length,
            items: arr,
        });
    }
    groups.sort((a, b) => (b.items[0]?.lastWrongAt ?? 0) - (a.items[0]?.lastWrongAt ?? 0));
    const pending = scoped.filter((x) => !x.mastered).length;
    return { groups, total: scoped.length, pending, mastered: scoped.length - pending, aggregated: !docFilter };
}

/** 行头日期列文案（§5.3/§7.e）：同年 MM-DD、跨年 YYYY-MM-DD；无时间戳
 *  （题库有错次但本页签无作答记录）出空串，列仍占位不塌陷。 */
export function rowDateOf(ts: number | undefined, now?: number): string {
    return ts ? fmtDayShort(ts, now) : "";
}

/** 行头日期列的悬停 title：全量时刻；无时间戳同款空串。 */
export function rowDateTitle(ts: number | undefined): string {
    return fmtFullDateTime(ts);
}

/** 详情模型（ReviewCtl 惰性 hydrate 后构建；html 均已 Lute 渲染）。 */
export interface ReviewDetailModel {
    qid: string;
    docTitle: string;
    /** 「查看原文」跳转门控（Issue #13）：非空才渲染该钮（无目标不出
     *  死钮）；本字段即待跳 qid，实际目标由 ReviewCtl.gotoBlock 降级解。 */
    gotoId?: string;
    stemHtml: string;
    optionsHtml: string;
    stepsHtml: string;
    timelineHtml: string;
    answerHtml: string;
    solutionHtml: string;
    loading?: boolean;
}

/** 详情 html 字段组装（题干/选项/步骤/答案/解析；Ctl 惰性 hydrate 后
 *  调用——html 产物口径归本模型层，Ctl 只装配数据字段）。 */
export function renderDetailModel(args: {
    q: WenguQuestion;
    /** 题库记录缺失时的题干兜底文案（纯文本）。 */
    stemSummary: string;
}): Pick<ReviewDetailModel, "stemHtml" | "optionsHtml" | "stepsHtml" | "answerHtml" | "solutionHtml"> {
    const { q, stemSummary } = args;
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
    return {
        stemHtml: q.stemMd ? mdFragmentHtml(q.stemMd) : `<div class="wengu-muted">${esc(stemSummary)}</div>`,
        optionsHtml,
        stepsHtml,
        answerHtml: q.answer ? mdFragmentHtml(q.answer) : "",
        solutionHtml: q.solutionMd ? mdFragmentHtml(q.solutionMd) : "",
    };
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
                ? `<div class="wengu-review-tl-cause">${esc(t(weakCauseLabelKey(a.cause)))}</div>`
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
