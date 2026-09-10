import { hideBar } from "./AnnoFlow";
import { detachCompanionPanel } from "../../companion";
import { detachBankPanels } from "../../bank";
import { detachAiSessionPanel } from "../../ai/SessionPanel";
import { detachReviewApp } from "../../review";
import { destroyStatsPanel } from "../../stats";
import { detachRoundReport } from "../render/RoundReport";
import { detachRail } from "../render/RailMount";
import { detachNumRail } from "../render/NumRail";
import { detachCardApps } from "../render/CardMount";
import { detachStartPanel } from "../render/StartPanel";
import { detachSideHead } from "./SideMount";

/**
 * 页签销毁的全部解绑（Issue #12 自 QuizView 外移，压行数）：模块级单例
 * 挂载物的统一反挂。原先平铺在 `destroy()` 里二十余行——与视图状态无关
 * 的机械清单，外移不伤内聚。**顺序照旧**（浮层类先于 DOM 类，同原实现）。
 */
export function teardownView(): void {
    destroyStatsPanel(); // 浮层 echarts 防 leak（此前 destroy 漏清，挂账项）
    detachCompanionPanel();
    detachBankPanels();
    detachAiSessionPanel();
    detachReviewApp();
    detachStartPanel();
    detachRoundReport();
    detachRail();
    detachNumRail();
    detachCardApps(); // 题卡/组单元组件（6-4a 渲染层组件化）
    detachSideHead();
    hideBar();
}
