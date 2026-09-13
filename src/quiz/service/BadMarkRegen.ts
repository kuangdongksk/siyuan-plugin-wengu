import type { QuizView } from "../index";
import type { BankData } from "../../bank/data/QuestionBank";
import { launchAiFlow } from "../../ai/flow";
import { regenBadMarkedRecords } from "../../bank/ui/RegenDialog";

/**
 * 预览头部「批量重转标记的错题」的视图侧收口（Issue #46）：把视图能力
 * 组装成 RegenDeps，经 launchAiFlow 起步（**点击即关/后台流**，照抄
 * RepairDialog 调 regenRecords 的口径——单飞闸、进度与停止在 AI 会话
 * 面板、终态走通知）。
 *
 * 逐题串行、跨卷全局收集、成功自动清标记的逻辑全在
 * `bank/ui/RegenDialog.regenBadMarkedRecords`（复用 regenRecords，零新账）。
 */

/** 已标记题数（纯函数，单测覆盖）：题库未装载/未初始化返回 0=不显示。 */
export function countBadMarked(data: BankData | undefined): number {
    if (!data) return 0;
    let n = 0;
    for (const r of Object.values(data.records)) if (r.badMark === "1") n++;
    return n;
}

/** 起步批量重转（视图入口：QuizView.regenBadMarked）。 */
export function regenBadMarkedFor(v: QuizView): void {
    const bank = v.bankStore();
    if (!bank) return;
    launchAiFlow(async (stop) => {
        await regenBadMarkedRecords({ t: v.t, bank, modelId: v.aiModelId(), onDone: () => v.renderQuizList() }, stop);
    });
}

/** 视图访问三元组（QuizView 三个箭头属性一处分派，实现体留在本模块）。 */
export interface BadMarkViewAccess {
    previewingOf(): boolean;
    badMarkCountOf(): number;
    regenBadMarked(): void;
}

/** 构造 QuizView 的三个「标记为错题」访问器（渲染闸/徽标/批量重转）。 */
export function badMarkAccess(v: QuizView): BadMarkViewAccess {
    return {
        previewingOf: () => v.mode === "preview",
        badMarkCountOf: () => countBadMarked(v.bankStore()?.peek()),
        regenBadMarked: () => regenBadMarkedFor(v),
    };
}
