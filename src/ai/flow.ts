import { aiAbort, aiFlowBegin, aiFlowEnd, type AiAbort } from "./client";
import { notifyError, notifyInfo } from "../ui/Notify";

/**
 * 后台 AI 批流的公共发射口（20260905 弹窗去阻塞改造）：六个批流弹窗
 * （匹配/批量关联/生成标签/变式重练/薄弱加练/收集补题）点击开始即关窗，
 * 由这里统一起步——单飞闸（已有流在跑时通知不叠跑）、起步告知（进度
 * 与「停止」都在 AI 会话面板）、后台执行 + finally 释放闸。
 *
 * 约定：run 内部自行收口终态（完成/中止 notifyInfo、失败 notifyError），
 * 不得向本函数抛异常以外的路径泄漏未通知的失败；异常在这里兜底成错误
 * 通知（防 unhandled rejection 刷屏）。
 */
export function launchAiFlow(run: (stop: AiAbort) => Promise<void>): void {
    if (!aiFlowBegin()) {
        notifyInfo({ key: "aiFlowBusy" });
        return;
    }
    notifyInfo({ key: "aiFlowStarted" });
    void run(aiAbort())
        .catch((e: unknown) => {
            notifyError(String((e as Error)?.message ?? e));
        })
        .finally(() => aiFlowEnd());
}
