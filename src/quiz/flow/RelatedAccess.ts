import type { QuizView } from "../index";
import type { RelatedViewAccess } from "../../bank/ui/RelatedDialog";

/**
 * 相关题弹窗的视图能力（Issue #44）：预览/开刷/回顾三个动作都落在刷题
 * 页签既有机制上（related 活视图专题 → switchTo → 工作区/模式切换），
 * 本文件只做结构匹配转发，不新增流程。
 */
export function relatedAccessFor(v: QuizView): RelatedViewAccess {
    return {
        t: v.t,
        aiModelId: () => v.aiModelId(),
        weaknessStore: () => v.weaknessStore(),
        enterPreviewMode: () => v.enterPreviewMode(),
        enterReviewMode: (opt) => v.enterReviewMode(opt),
        switchWorkspace: (ws) => v.switchWorkspace(ws),
        colFlowOf: () => v.colFlowOf(),
    };
}
