import type { QuizView } from "../index";
import { filterReviewDocFor, filterReviewQidsFor, selectReviewQid } from "../../review";
import { destroyStatsPanel } from "../../stats";

/**
 * 模式入口（自 QuizView 拆出压 500 行红线）：预览/复习的进入编排，
 * 状态变更仍走 QuizView.switchMode 统一入口。
 */

/** 预览模式入口：开刷面板「预览」按钮（只读浏览，不作答不计轮次）。 */
export function enterPreviewFor(v: QuizView): void {
    destroyStatsPanel();
    v.switchMode("preview");
}

/** 复习模式统一入口：右键文档预筛 / 统计 qid 定位 / 相关题集回顾 / 直入
 *  （统计面板先关）。
 *  qids（Issue #44「回顾」）＝相关题弹窗传入的题集筛选，与 docId 过滤
 *  并存互不冲突（清单侧按合取语义），错题详情/时间线全走既有通道。 */
export function enterReviewFor(v: QuizView, opt: { docId?: string; qid?: string; qids?: string[] }): void {
    destroyStatsPanel();
    if (opt.docId) filterReviewDocFor(opt.docId);
    if (opt.qids) filterReviewQidsFor(opt.qids);
    if (opt.qid) selectReviewQid(opt.qid);
    v.switchMode("review");
}
