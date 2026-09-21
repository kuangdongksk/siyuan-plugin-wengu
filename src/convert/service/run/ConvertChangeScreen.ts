/**
 * 增量「变更块实质判定」的**编排侧收口**（Issue #186 A3）：
 * 「省费模式一刀切保留旧题」→「实质变更才重转」这条决策链的**唯一组装点**。
 *
 * 三块职责：
 *  1. {@link changeItemsOf}：把 `IncrementPlan.changed` 组装成判定原料
 *     （新源文 + 旧题 kramdown——**旧源文没有留存**，见 `ai/jev/changeJudge.ts`
 *     头注的实测口径）；
 *  2. {@link refineKeepOldChoice}：跑判定并重写选择（实质块从「保留旧题」
 *     挪到「删旧题 + 重转」）；
 *  3. 计数收口：判定成功的块数与判为实质的块数（报告行用）。
 *
 * 三条硬口径：
 *  - **只决定转不转**：`srcKey`/`hash`/切块一律不碰（冻结清单）；
 *  - **失败/低置信不改变现状**：`judgeChanges` 内部对「不确定」按**实质**
 *    回落（宁可多转不漏转）；本模块对「判定层整体抛错」按**原选择**收口
 *    （保留旧题＝改造前行为），两条各管一段、都以「不静默丢数据」为准；
 *  - **判定不落盘**：清单只挂在这次运行的返回值上。
 */
import { judgeChanges, type ChangeItem, type ChangeOutcome } from "../../../ai/jev/changeJudge";
import type { JevTransportFn } from "../../../ai/jev/transport";
import type { IncrementPlan } from "../source/SrcChunk";
import type { IncrementChoice } from "../../ui/IncrementDialog";

/** 组装判定原料时读旧题的接缝（`bank` 记录 → kramdown；单测可注入）。 */
export type OldQuestionsOf = (blocks: string[]) => Promise<string>;

/** 判定合计（报告行用；不落盘）。 */
export interface ChangeScreenSummary {
    /** 判定成功的块数（含判为措辞的块）。 */
    checked: number;
    /** 判为实质（含低置信回落成实质）而**被改判为重转**的块数。 */
    substantive: number;
}

/**
 * 变更块 → 判定原料（**每个变更块都在列**，含旧题读不到的）。
 *
 * ⚠️ **不许在这里过滤**：旧题读不到（记录已被删/无 kramdown）的块若被
 * 剔出清单，它在选择里就没人改判 ⇒ 默认落回「保留旧题」——那是**静默漏转**
 * （源变了却留着旧题），与 A3「宁可多转不漏转」的口径相反。
 * 一律交给 `judgeChanges`：它把这类块（以及两侧都空的块）按**实质**处置，
 * 且不会为它们多发一次占位请求（见 `ai/jev/changeJudge.ts` 的 `usable`）。
 */
export async function changeItemsOf(plan: IncrementPlan, readOld: OldQuestionsOf): Promise<ChangeItem[]> {
    const items: ChangeItem[] = [];
    for (const c of plan.changed) {
        const oldQuestions = (await readOld(c.old.blocks)).trim();
        items.push({ key: c.chunk.key, oldQuestions, newText: c.chunk.text.trim() });
    }
    return items;
}

/** {@link refineKeepOldChoice} 的入参。 */
export interface RefineOpts {
    /** 旧题正文读取（`bank` 侧；缺省/读失败按空串＝该块不进判定＝保守重转）。 */
    readOldQuestions: OldQuestionsOf;
    /** Jev key（空 = 未配置 → 判定层原样返回「全部实质」，见上）。 */
    apiKey?: string;
    /** 判定传输注入（单测 mock）。 */
    transport?: JevTransportFn;
    sleep?: (ms: number) => Promise<void>;
}

/**
 * 省费模式选择的精修（**唯一入口**）：把「实质变更」的块从「保留旧题」
 * 改判成「重转」（删旧题 + 生成新题）。
 *
 * 失败/无 key 时的行为**刻意不同**于 A2：`judgeChanges` 遇「不确定」按
 * 实质回落 ⇒ 这里会把全部变更块推去重转（宁可多转不漏转，Issue #186
 * 需求 2 明写）；只有判定层**整体抛错**才保持原选择（保留旧题＝现状）。
 */
export async function refineKeepOldChoice(
    plan: IncrementPlan,
    choice: IncrementChoice,
    opts: RefineOpts
): Promise<{ choice: IncrementChoice; summary: ChangeScreenSummary }> {
    const none: ChangeScreenSummary = { checked: 0, substantive: 0 };
    let items: ChangeItem[];
    try {
        items = await changeItemsOf(plan, opts.readOldQuestions);
    } catch (_) {
        return { choice, summary: none }; // 读旧题失败：原选择原样（保守）
    }
    if (items.length === 0) return { choice, summary: none };

    let out: ChangeOutcome;
    try {
        out = await judgeChanges(items, {
            apiKey: opts.apiKey,
            ...(opts.transport ? { transport: opts.transport } : {}),
            ...(opts.sleep ? { sleep: opts.sleep } : {}),
        });
    } catch (_) {
        return { choice, summary: none }; // 判定层抛错（理论不可达）：保持原选择
    }

    // 判为实质的块：从「保留旧题」挪到「重转」（块进生成、旧记录进删除）
    const byKey = new Map(plan.changed.map((c) => [c.chunk.key, c]));
    const rerun = new Set(out.verdicts.filter((v) => v.substantive).map((v) => v.key));
    const chunks = [...choice.chunks];
    const deleteQids = [...choice.deleteQids];
    const staleQids = choice.staleQids.filter((qid) => {
        const c = plan.changed.find((x) => x.old.blocks.includes(qid));
        if (!c || !rerun.has(c.chunk.key)) return true; // 措辞级/未知块：照旧保留
        return false;
    });
    for (const key of rerun) {
        const c = byKey.get(key);
        if (!c) continue;
        chunks.push(c.chunk);
        deleteQids.push(...c.old.blocks);
    }
    return {
        choice: { chunks, deleteQids, staleQids },
        summary: { checked: out.checked, substantive: out.substantiveCount },
    };
}
