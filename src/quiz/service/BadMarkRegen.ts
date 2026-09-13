import type { QuizView } from "../index";
import { badMarkCount } from "../../bank/data/BadMark";
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

/** 起步批量重转（视图入口：QuizView.badMark.regen()）。
 *
 *  ⚠️ 刷新走**整卷重载**（reloadView）而非仅重渲染：题表是装载期解析出
 *  的快照（setQuestions 产 ParsedQuestion），重转只换了题库记录的 kramdown
 *  ——不重载就还是旧题干（Issue #46 验收 5）。单题「重新生成」的 onDone
 *  也走同一条整卷重载（ViewBindings 的 reload），口径一致。 */
export function regenBadMarkedFor(v: QuizView): void {
    const bank = v.bankStore();
    if (!bank) return;
    launchAiFlow(async (stop) => {
        await regenBadMarkedRecords({ t: v.t, bank, modelId: v.aiModelId(), onDone: () => void v.reloadView() }, stop);
    });
}

/** 「标记为错题」视图访问器（QuizView 持一份，渲染闸/徽标/批量重转三合一
 *  ——集中一处分派保 index.ts 不再净增）。 */
export interface BadMarkViewAccess {
    /** 预览模式（顶部批量重转钮的渲染闸；做题模式不出此钮）。 */
    previewing(): boolean;
    /** 跨卷全局标记数（同步读题库快照；0=不出钮）。 */
    count(): number;
    /** 批量重转全部标记题（点击即关/后台流，终态走通知）。 */
    regen(): void;
}

/** 构造 QuizView 的「标记为错题」访问器。 */
export function badMarkAccess(v: QuizView): BadMarkViewAccess {
    return {
        previewing: () => v.mode === "preview",
        count: () => badMarkCount(v.bankStore()?.peek()),
        regen: () => regenBadMarkedFor(v),
    };
}
