/**
 * 知识点同义词判定的 **Jev 通道**（Issue #188，规划稿 §三 B2 单 6）。
 *
 * `KnowSynJudge` 把「挂不上的标签 × 候选小节」批量送**生成式**对话 AI，
 * 回来还要按编号行协议解析文本——格式歪一点整批作废。本模块是那条腿的
 * **可插拔替换**：同一个 `pendingPairs` 队列、同一个写回侧
 * `store.putMany(writes,"ai")`——存储结构、synKey、缓存口径零变化。
 *
 * **问法（逐对问，与 Issue 需求 1 逐字对齐）**：一对**（标签，候选小节标题）**
 * 一个问题，choice 三档（{@link SYN_OPTIONS}：same / related / different），
 * 一批一请求（纪律 5「一次请求问完」）。选中 `same` 时规范词就是**那个候选
 * 小节标题原文**（不是模型造的词）——旧生成式通道靠「AI 只准回清单编号」
 * 达成的约束，这里由选项本身承担，比编号协议更硬。
 *
 * 逐对问对候选数敏感，故按 {@link SYN_JEV_MAX_CANDIDATES} 截候选：**近邻标题
 * 优先**（`candidateList` 的排序口径——同语言换写法几乎全在这一档），其余按
 * 词表序补足。跨语言对靠清单整体覆盖，与生成式通道同源口径。
 *
 * **分流口径（零行为变化是硬验收）**：判定入口只在 `isJevEnabled(settings)`
 * 为真时被 `SynFlow` 调起；没 key / 总开关关 → 走 `KnowSynJudge.judgeSynonyms`
 * 的现状通道，逐字节等同改造前。
 *
 * **分批按标签成组（歧义口径的前提）**：一个标签的全部候选**必须落在同一
 * 批**——否则「同一标签多个 same 候选」的歧义判定会被批界切开，两批各判中
 * 一个候选、后批覆盖前批，落一个错词（正是本口径要防的）。故批界只落在
 * 标签之间，且由 {@link SYN_JEV_MAX_CANDIDATES} ≤ {@link SYN_JEV_BATCH}
 * 保证「单组不超批」——两个常量的相对大小是**不变量**，单测钉着。
 *
 * **回落口径（纪律 2）**：判定失败（网络/协议/鉴权）、choice 低置信
 * （`choiceLowConfidence`，<0.5）、命中「同一标签 → 多个 same 候选」的歧义——
 * 一律**不落表**（下次重问），不做「本批整体回落生成式」的二次采购。
 * `related` / `different` **一律不落表**：旧生成式 prompt 只把「同义」写进表，
 * 「非等同」一律写 `-`（不落表、下次重问）——维持旧入表口径，不静默放宽
 * （Issue 需求 3）。
 *
 * **会话登记**（Issue #201，推翻 #183 的「不登记」决策）：逐批判定落「AI 会话」
 * 面板（kind 固定 `"jev"`，标题带对数），由调用方经 `deps.track` 给动作组
 * ——同一轮同义判定的一批记录在树上归并成一棵子树。**不走全局在途闸**这条
 * 红线不变（判定请求短、各落点自带回落）。
 */

import { judgeJev, type JevAnswer, type JevChoiceAnswer, type JevQuestion } from "../../ai/jev/client";
import type { AiSessionGroup } from "../../ai/data/AiSessions";
import { aiTitle } from "../../ui/shared";
import { tKey } from "../../ui/Notify";
import type { JudgeJevOpts } from "../../ai/jev/client";
import { SYN_OPTIONS, SYN_VERDICTS, synVerdictEntersTable, choiceLowConfidence } from "../../ai/jev/policy";
import { candidateList, type SynPair } from "./KnowSynJudge";
import { synKey, type KnowSynonymsStore } from "./KnowSynonyms";
import type { LexSection } from "./KnowLinkText";

/** 一次请求最多问多少个「词对 × 候选」问题：Jev 的形态是**同一段 state 上
 *  并行问多问**，批发比单发省 state；给 60（判定模型短答案，批大不增漏判
 *  风险，只增单次请求体量）。 */
export const SYN_JEV_BATCH = 60;

/** 每个标签最多比几个候选小节（近邻优先）。逐对问的成本 = 候选数，故必须
 *  有上限；30 足以覆盖「同语言换写法（近邻档）」+ 常见跨语言对。 */
export const SYN_JEV_MAX_CANDIDATES = 30;

/** 一个问题：标签 vs 一个候选小节标题，choice 三档。 */
export function synPairQuestion(label: string, candidate: string): string {
    return [
        `知识点标签：「${label}」`,
        `候选小节写法：「${candidate}」`,
        "这两个写法在知识文档的语境下是不是**同一个知识点**？",
        `${SYN_VERDICTS.same} = 同一概念（含跨语言/简称全称/换写法，如「洛必达」与「L'Hôpital 法则」）；`,
        `${SYN_VERDICTS.related} = 相关但不是同一个知识点（父概念/子概念/相邻章节）；`,
        `${SYN_VERDICTS.different} = 无关。`,
        `拿不准选 ${SYN_VERDICTS.related}——本插件宁可漏挂引用，也不误挂。`,
    ].join("\n");
}

/** 一个待问问题 + 它对应的小节（答案与问题按位序一一对应，见 `judgeJev`）。 */
export interface SynJevItem {
    pair: SynPair;
    section: LexSection;
}

/** 该批的问题清单（位序 = items 位序；state 只放共用材料，逐对材料进问题正文）。 */
export function synQuestions(items: SynJevItem[]): JevQuestion[] {
    return items.map((it) => ({
        kind: "choice",
        question: synPairQuestion(it.pair.raw, it.section.title),
        options: SYN_OPTIONS,
    }));
}

/** state（共用材料）：本批标签清单 + 用途说明——逐对材料已在问题正文里，
 *  这里只给模型一点批量上下文（同一批一请求，纪律 5）。 */
export function synState(labels: string[]): string {
    const uniq = [...new Set(labels)];
    return [
        "知识点术语对齐：判断一批题目知识点标签与知识文档小节标题是否为同一概念。",
        `本批标签（共 ${uniq.length} 个）：${uniq.join("、")}`,
    ].join("\n");
}

/**
 * 词对 × 候选 → 待问问题清单（纯函数）。
 *
 * 候选按 `candidateList` 的**近邻优先**排序（标题与标签互为包含者在前），
 * 截 {@link SYN_JEV_MAX_CANDIDATES} 个；`pairs` 与 `candidateList` 的调用
 * 口径与生成式通道一致（同一份清单算法，不另造一份）。
 */
export function synItems(pairs: SynPair[], pool: LexSection[]): SynJevItem[] {
    const items: SynJevItem[] = [];
    for (const p of pairs) {
        const { kept } = candidateList(pool, [p.raw]);
        for (const s of kept.slice(0, SYN_JEV_MAX_CANDIDATES)) items.push({ pair: p, section: s });
    }
    return items;
}

/**
 * 问题清单 → **按标签成组的批次**（纯函数）。
 *
 * 批界只落在标签之间：一个标签的候选永不被拆到两批（歧义口径的前提，见
 * 文件头）。`SYN_JEV_MAX_CANDIDATES` ≤ `SYN_JEV_BATCH` 时单组必能整组装进
 * 一批；万一将来常量被改成反的（单组 > 批上限），该组**独占一批**（宁可
 * 单批超限，也不拆开歧义判据）。
 */
export function synBatches(pairs: SynPair[], pool: LexSection[], limit: number = SYN_JEV_BATCH): SynJevItem[][] {
    const batches: SynJevItem[][] = [];
    let cur: SynJevItem[] = [];
    for (const p of pairs) {
        const group = synItems([p], pool);
        if (group.length === 0) continue;
        if (cur.length > 0 && cur.length + group.length > limit) {
            batches.push(cur);
            cur = [];
        }
        cur.push(...group);
        if (cur.length >= limit) {
            batches.push(cur);
            cur = [];
        }
    }
    if (cur.length > 0) batches.push(cur);
    return batches;
}

/** 一批答案 → 落表条目（纯函数）：答案与 `items` 按位序对应。
 *
 *  三条口径（与旧生成式通道对齐，见文件头）：
 *  - 低置信（<0.5）→ 该对的这一问不算数；
 *  - 选中 `same` → 该问的候选标题当规范词；**同一标签多个 same 候选 = 歧义**
 *    → 整对不落表（挂引用侧本来也要求唯一命中，见 `textRefsFor`，但表里
 *    落一个错词比不落更糟）；
 *  - `related` / `different` → 不落表（旧通道只落「同义」，非等同下次重问）。
 */
export function answersToWrites(
    items: SynJevItem[],
    answers: (JevAnswer | undefined)[]
): { raw: string; canonical: string }[] {
    const sameByLabel = new Map<string, Set<string>>();
    items.forEach((it, i) => {
        if (!verdictEntersTable(answers[i])) return;
        const key = synKey(it.pair.raw);
        const set = sameByLabel.get(key) ?? new Set<string>();
        set.add(it.section.title);
        sameByLabel.set(key, set);
    });
    const writes: { raw: string; canonical: string }[] = [];
    const emitted = new Set<string>();
    for (const it of items) {
        const key = synKey(it.pair.raw);
        if (emitted.has(key)) continue;
        const hits = sameByLabel.get(key);
        if (!hits || hits.size !== 1) continue; // 无命中或歧义（多个 same 候选）
        emitted.add(key);
        writes.push({ raw: it.pair.raw, canonical: [...hits][0] });
    }
    return writes;
}

/** 单条答案是否「明确同义」（类型收窄 + 置信 + 选项三关）。 */
function verdictEntersTable(a: JevAnswer | undefined): boolean {
    if (!a || a.kind !== "choice") return false;
    const c: JevChoiceAnswer = a;
    if (choiceLowConfidence(c.confidence)) return false;
    return synVerdictEntersTable(c.choice);
}

/** 判定依赖：`judge` 可注入（单测 mock），缺省走真客户端。 */
export interface KnowSynJevDeps {
    pairs: SynPair[];
    /** 全部候选小节（词表白名单）。 */
    pool: LexSection[];
    store: KnowSynonymsStore;
    apiKey: string;
    signal: AbortSignal;
    onFail?: (e: Error) => void;
    /** 判定调用（单测注入 mock）；缺省 `judgeJev`。 */
    judge?: (opts: JudgeJevOpts) => Promise<JevAnswer[]>;
    /** 会话登记上下文（Issue #201）：标题由本模块按批大小生成，调用方只给
     *  动作组（一次判定的各批挂同组）；缺省=不分组（仍逐批登记）。 */
    group?: AiSessionGroup;
}

/**
 * 按批判定同义词对（Jev 版）：`SYN_JEV_BATCH` 个问题一批、**一批一请求**，
 * 回来**批量写回同义表**（`putMany(writes,"ai")`）。
 *
 * 失败（整批）只 `onFail` 上报、不落表（重跑再试）；`signal` 中止时批间
 * 停手，已判定的照常写回。返回键 = `synKey(标签)`（仅 same 且唯一的对）。
 */
export async function judgeSynonymsJev(deps: KnowSynJevDeps): Promise<Map<string, LexSection[]>> {
    const hits = new Map<string, LexSection[]>();
    if (deps.pairs.length === 0 || deps.pool.length === 0) return hits;
    const judge = deps.judge ?? judgeJev;
    const batches = synBatches(deps.pairs, deps.pool);
    const byTitle = new Map<string, LexSection[]>();
    for (const s of deps.pool) {
        const arr = byTitle.get(s.title) ?? [];
        arr.push(s);
        byTitle.set(s.title, arr);
    }
    for (const batch of batches) {
        if (deps.signal.aborted) break;
        let answers: JevAnswer[];
        try {
            answers = await judge({
                state: synState(batch.map((it) => it.pair.raw)),
                questions: synQuestions(batch),
                apiKey: deps.apiKey,
                // 登记（Issue #201）：一批一次判定 → 一条记录；调用方给的组
                // 把一次动作的各批归并成一棵子树
                track: {
                    title: aiTitle(tKey, "aiTitleJevSyn", { n: String(batch.length) }),
                    ...(deps.group ? { group: deps.group } : {}),
                },
            });
        } catch (e) {
            deps.onFail?.(e as Error);
            continue; // 本批失败跳过；失败不落表（重跑再试）
        }
        const writes = answersToWrites(batch, answers);
        for (const w of writes) {
            for (const s of byTitle.get(w.canonical) ?? []) {
                hits.set(synKey(w.raw), [{ ...s }]);
            }
        }
        await deps.store.putMany(writes, "ai");
    }
    await deps.store.flush();
    return hits;
}
