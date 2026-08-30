import type { ReviewDetailModel, ReviewItemModel } from "../ReviewHtml";
import type { WenguQuestion } from "../../types";
import type { ReviewCtl } from "./ReviewCtl";

/**
 * 错题本（复习模式）的响应态形状（四件套之一，模式见
 * docs/svelte-migration.md）。筛选/排序/选中/文档筛选用 ctl 单例持久
 * （跨视图重渲染保留，旧模块级变量语义），attach 时同步进 ui。
 * 清单分组模型由组件 $derived 现算；详情由控制器串行链写入。
 */

/** 子组件经 context 取的载荷。 */
export interface ReviewCtx {
    ctl: ReviewCtl;
    ui: ReviewUi;
    t: (key: string) => string;
}

export const REVIEW_CTX = Symbol("wengu-review");

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
    type?: WenguQuestion["type"];
    lastAnswer?: string;
    attempts: ReviewAttempt[];
}

export interface ReviewUi {
    /** 原始清单（缓存镜像，refresh 完整体重赋值触发清单重算）。 */
    items: ReviewItem[];
    filter: "all" | "pending" | "mastered";
    sort: "recent" | "count";
    /** 侧栏筛选的文档 id（空=全部；quiz 侧栏点击联动写入）。 */
    docFilter: string;
    /** 当前选中的题（清单 cur 高亮 + 详情装载目标）。 */
    selQid: string;
    /** 详情面板（惰性 hydrate 的串行链产出；empty=未选）。 */
    detail: ReviewDetailState;
}

export interface ReviewDetailState {
    phase: "empty" | "loading" | "ready";
    model?: ReviewDetailModel;
}

/** 初始态（$state 包装在 ReviewApp 内完成；持久初值由 ctl.attach 覆写）。 */
export function initialReviewUi(): ReviewUi {
    return { items: [], filter: "all", sort: "recent", docFilter: "", selQid: "", detail: { phase: "empty" } };
}
