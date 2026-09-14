import { aiAbort, aiFlowBegin, aiFlowEnd, type AiAbort } from "./client";
import { beginAiFlow, endAiFlow } from "./core/FlowRegistry";
import { notifyError, notifyInfo } from "../ui/Notify";

/** 批流的流级登记载荷（Issue #77）：title=既有通知的流名（横幅上的人读
 *  标签，i18n 已解析）。 */
export interface AiFlowMeta {
    /** 流名（i18n 已解析成品文案）。 */
    title: string;
}

/**
 * 后台 AI 批流的公共发射口（20260905 弹窗去阻塞改造）：六个批流弹窗
 * （匹配/批量关联/生成标签/变式重练/薄弱加练/收集补题）点击开始即关窗，
 * 由这里统一起步——单飞闸（已有流在跑时通知不叠跑）、起步告知（进度
 * 与「停止」都在 AI 会话面板）、后台执行 + finally 释放闸。
 *
 * Issue #77 起同时是**流级横幅的登记口**：begin 时把流注册进
 * core/FlowRegistry（title 取流名、stop 挂本流的 AiAbort 总闸），结束/
 * 失败/中止一律在 finally 里 end（「end 必达」口径）——横幅的「停止」
 * 因此**等价于原面板点停**（同一条 aiAbort 句柄，零新中止通道）。
 *
 * 约定：run 内部自行收口终态（完成/中止 notifyInfo、失败 notifyError），
 * 不得向本函数抛异常以外的路径泄漏未通知的失败；异常在这里兜底成错误
 * 通知（防 unhandled rejection 刷屏）。
 */
export function launchAiFlow(meta: AiFlowMeta, run: (stop: AiAbort) => Promise<void>): void {
    if (!aiFlowBegin()) {
        notifyInfo({ key: "aiFlowBusy" });
        return;
    }
    notifyInfo({ key: "aiFlowStarted" });
    const id = `flow:${Date.now()}`;
    const stop = aiAbort();
    // stop 挂本流的 AiAbort 总闸：横幅的「停止」与面板记录点停
    //（abortAiSession → controller.abort）走的是同一条通道，零新中止面
    beginAiFlow({ id, title: meta.title, stop: () => stop.stop?.() });
    void run(stop)
        .catch((e: unknown) => {
            notifyError(String((e as Error)?.message ?? e));
        })
        .finally(() => {
            endAiFlow(id); // end 必达（正常/失败/中止三条路径）
            aiFlowEnd();
        });
}
