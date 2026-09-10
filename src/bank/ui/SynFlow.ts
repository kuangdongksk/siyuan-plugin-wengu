import { candidatePool, judgeSynonyms, pendingPairs } from "../data/KnowSynJudge";
import { applyRefsToRecord, textRefsFor, type LexSectionMap } from "../data/KnowLinkText";
import { knowSynonyms } from "../data/KnowSynonyms";
import type { BankRecord, QuestionBank } from "../data/QuestionBank";

/**
 * 同义判定相（Issue #3）的编排：文本层未命中的记录 → 词对（按 synKey
 * 去重、跳过表里已判定）→ 按批 AI 判定 → 写回同义表 + 当轮挂引用。
 * 三个入口（批量关联 / 生成标签核对 / 匹配）共用这一份，**不复制第二份**
 * ——差异只在「拿哪些记录来跑」与成败如何并入各自的汇总文案。
 *
 * 幂等：判定写回表后，第二轮同词对 `pendingPairs` 直接过滤掉，零 AI。
 */

/** 同义相的执行输入。 */
export interface SynPhaseDeps {
    bank: QuestionBank;
    lex: LexSectionMap;
    records: BankRecord[];
    modelId: string;
    stop: { signal: AbortSignal; onSid?: (sid: string) => void };
    group?: { id: string; title: string };
    onFail?: (e: Error) => void;
}

/** 执行结果：命中挂上的题数 + 仍未命中的记录（交给下一相）。 */
export interface SynPhaseResult {
    hit: number;
    rest: BankRecord[];
}

/** 全流程（AI 判定 + 落库 + 同步表）。store 未接线（测试环境）时直通
 *  返回，不产生任何副作用——调用方行为与改造前一致。 */
export async function runSynonymPhase(deps: SynPhaseDeps): Promise<SynPhaseResult> {
    const store = knowSynonyms();
    if (!store) return { hit: 0, rest: deps.records };
    const snap = store.peek();
    const pairs = pendingPairs(deps.records, deps.lex, new Map(Object.entries(snap.entries)));
    if (pairs.length === 0) return { hit: 0, rest: deps.records };
    const pool = candidatePool(deps.lex);
    if (pool.length === 0) return { hit: 0, rest: deps.records };
    const hits = await judgeSynonyms({
        pairs,
        pool,
        modelId: deps.modelId,
        signal: deps.stop.signal,
        store,
        group: deps.group,
        onSid: deps.stop.onSid,
        onFail: deps.onFail,
    });
    if (hits.size === 0) return { hit: 0, rest: deps.records };
    // 挂引用：命中的标签走同义表查表口径（table 里的规范词已被表同步）
    const table = store.peek();
    let hit = 0;
    const rest: BankRecord[] = [];
    for (const r of deps.records) {
        if (deps.stop.signal.aborted) {
            rest.push(r);
            continue;
        }
        const refs = r.knowledge ? textRefsFor(r.knowledge, deps.lex, table) : [];
        if (refs.length > 0 && (await applyRefsToRecord(deps.bank, r, refs))) hit++;
        else rest.push(r);
    }
    return { hit, rest };
}
