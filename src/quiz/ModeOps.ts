import type { QuizView } from "./index";
import { filterReviewDocFor, selectReviewQid } from "../review";
import { destroyStatsPanel } from "../stats";

/**
 * 模式入口（自 QuizView 拆出压 500 行红线）：预览/复习的进入编排，
 * 状态变更仍走 QuizView.switchMode 统一入口。
 */

/** 预览模式入口：开刷面板「预览」按钮（只读浏览，不作答不计轮次）。 */
export function enterPreviewFor(v: QuizView): void {
    destroyStatsPanel();
    v.switchMode("preview");
}

/** 复习模式统一入口：右键文档预筛 / 统计 qid 定位 / 直入（统计面板先关）。 */
export function enterReviewFor(v: QuizView, opt: { docId?: string; qid?: string }): void {
    destroyStatsPanel();
    if (opt.docId) filterReviewDocFor(opt.docId);
    if (opt.qid) selectReviewQid(opt.qid);
    v.switchMode("review");
}
