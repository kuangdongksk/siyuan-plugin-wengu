/**
 * 增量变更「值不值得重转」（Issue #186，规划稿 A3）：省费模式下，变更块
 * 原本**一刀切保留旧题**（`keepOldChoice`）——改个错别字和改道例题待遇
 * 一样。本模块逐块问 Jev 一句：「这次修改是否实质影响可出题内容？」
 *
 * ⚠️ **输入取「旧题 + 新源文」，不是「旧源文 + 新源文」**（与规划稿 §三 A3
 * 的措辞不同，是实现层核对后的修正，见 PR 描述）：
 * 规划稿假定「新旧两段文本代码手里都有」，但**旧源文根本没有留存**——
 * 题库只存 `srcKey` / `srcHash`（指纹）与**由旧源文出的题**（`record.kramdown`），
 * 源文档一改，旧源文即不可复原（冻结清单禁改存储格式，不可能为此新增字段）。
 * 因此判定拿旧题当「旧内容」的代表：旧题恰恰是「上次从那段源文里提出的
 * 东西」，问「新源文相对这些旧题是否有实质变化」比问「两段文本差异大小」
 * 更贴本落点的真实决策（**值不值得重转 = 旧题还准不准、够不够**）。
 *
 * 两档决策（Issue #186 需求 1）：
 *  - **实质**（新增知识点/改数值/改结论…）→ 重转该块（删旧题 + 生成新题）；
 *  - **措辞**（错别字/排版/同义改写…）→ 保留旧题（打 src-stale 标记）。
 *
 * 三条硬口径（与 A2 同源）：
 *  - **低置信当实质**（需求 2）：判定为「不确定」（noul 落 0.2~0.8）、
 *    缺值、抛错、无 key —— 一律**当实质变化**（宁可多转不漏转）；
 *    这是 A3 与 A2/A1「低置信回落现状」方向**相反**的一个落点，刻意如此；
 *  - **只决定转不转**：指纹（`questionHash`）、`srcKey`、切块一律不碰；
 *  - **判定不落盘**：重跑重判无害（最多多转一次）。
 *
 * 一次请求问完一批变更块（纪律 5）：`state` 里新旧文本交替编号，每块一项
 * noul 问题，同一批独立问题一次发出去——**不逐块发请求**。
 *
 * 本模块是**纯判定层**：不 import convert 域类型，输入是纯数据（可直测）。
 */
import { judgeJev, type JevAnswer, type JevQuestion } from "./client";
import { changeIsWordingLevel } from "./policy";
import type { JevTransportFn } from "./transport";
import type { JevTrack } from "./track";

/* ── 输入形状 ── */

/** 一个变更块的判定原料（`key` 只用于回填定位）。 */
export interface ChangeItem {
    key: string;
    /** 旧内容代表：**该块已出的旧题**（记录 kramdown，题集侧现读；见文件头）。 */
    oldQuestions: string;
    /** 新文本（源文档改动后那段的新源文）。 */
    newText: string;
}

/* ── 判定结果 ── */

/** 一个变更块的结论。 */
export interface ChangeVerdict {
    key: string;
    /** 当实质变化处理（→ 重转该块）。低置信/失败也在这一档（见文件头）。 */
    substantive: boolean;
    /** 判定成功（拿到了可用的概率）。 */
    judged: boolean;
}

/** 一批变更判定的合计（内存态，不落盘）。 */
export interface ChangeOutcome {
    verdicts: ChangeVerdict[];
    /** 判定成功的块数——与 `substantive` 计数分账。 */
    checked: number;
    /** 判为实质（含低置信回落成实质）的块数。 */
    substantiveCount: number;
}

/** 单片问题的措辞（**唯一落点**）。 */
const QUESTION =
    "修改后的内容相对这些旧题，是否实质影响已出的题？新内容带来新知识点/新数值/新结论、" +
    "或使旧题答案不再成立、需要补充新题 = 实质；旧题在新内容下依然准确且覆盖完整、" +
    "差异仅是措辞、语序、排版、标点、错别字、同义替换 = 不实质。";

/** 一批的 `state`：旧题 + 新源文成对编号（序号与答案位序对应）。 */
export function buildChangeState(items: ChangeItem[]): string {
    return items
        .map(
            (it, i) =>
                `【第 ${i + 1} 处修改】\n旧题：\n${it.oldQuestions.trim()}\n\n修改后的源文：\n${it.newText.trim()}`
        )
        .join("\n\n");
}

/** 响应可用性：每块恰好一项 noul 答案，且概率是真数（口径同 chunkScreen）。 */
function answersUsable(answers: JevAnswer[], n: number): boolean {
    if (answers.length !== n) return false;
    return answers.every((a) => a.kind === "noul" && Number.isFinite((a as { noul?: number }).noul));
}

/* ── 主入口 ── */

/** 判定入参（`apiKey` 空 = 未配置 → **全部按实质**，见文件头）。 */
export interface ChangeOpts {
    apiKey?: string;
    transport?: JevTransportFn;
    sleep?: (ms: number) => Promise<void>;
    /** 会话登记（Issue #201，可选）：本批判定落一条记录。 */
    track?: JevTrack;
}

/** 「全部当实质」的结果（未判定/失败时的统一形态）。 */
function allSubstantive(items: ChangeItem[]): ChangeOutcome {
    return {
        verdicts: items.map((it) => ({ key: it.key, substantive: true, judged: false })),
        checked: 0,
        substantiveCount: items.length,
    };
}

/**
 * 一批变更块的判定（**一次请求问完一批**）。
 *
 * 返回「全部当实质」的情形：无 key / 无块 / `judgeJev` 抛错 / 响应缺值
 * ——一律宁可多转不漏转（需求 2），调用方不必 try/catch。
 */
export async function judgeChanges(items: ChangeItem[], opts: ChangeOpts): Promise<ChangeOutcome> {
    const key = (opts.apiKey ?? "").trim();
    if (!key || items.length === 0) return allSubstantive(items);
    // 两侧都空/只有新源文（旧题缺失）的块无从判：直接按实质（保守）
    const usable = items.filter((it) => it.oldQuestions.trim().length > 0 && it.newText.trim().length > 0);
    if (usable.length === 0) return allSubstantive(items);

    let answers: JevAnswer[];
    try {
        answers = await judgeJev({
            state: buildChangeState(usable),
            questions: usable.map((): JevQuestion => ({ kind: "noul", question: QUESTION })),
            apiKey: key,
            ...(opts.transport ? { transport: opts.transport } : {}),
            ...(opts.sleep ? { sleep: opts.sleep } : {}),
            ...(opts.track ? { track: opts.track } : {}),
        });
    } catch (_) {
        return allSubstantive(items);
    }
    if (!answersUsable(answers, usable.length)) return allSubstantive(items);

    const byKey = new Map<string, ChangeVerdict>();
    let checked = 0;
    let substantiveCount = 0;
    const blank = items.filter((it) => it.oldQuestions.trim().length === 0 || it.newText.trim().length === 0);
    for (const it of blank) byKey.set(it.key, { key: it.key, substantive: true, judged: false });
    usable.forEach((it, i) => {
        const p = (answers[i] as { noul?: number }).noul;
        // ⚠️ 方向与 A1/A2 相反：**只有明确为「否」才当措辞**，其余（不确定/缺值）
        // 一律当实质——低置信当实质是本落点的硬口径（需求 2）。
        const substantive = !changeIsWordingLevel(p);
        checked++;
        if (substantive) substantiveCount++;
        byKey.set(it.key, { key: it.key, substantive, judged: true });
    });
    return {
        verdicts: items.map((it) => byKey.get(it.key) ?? { key: it.key, substantive: true, judged: false }),
        checked,
        substantiveCount,
    };
}
