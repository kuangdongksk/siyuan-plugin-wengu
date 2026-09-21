import { candidatePool, judgeSynonyms, pendingPairs } from "../data/KnowSynJudge";
import { judgeSynonymsJev } from "../data/KnowSynJev";
import { applyRefsToRecord, textRefsFor, type LexSectionMap } from "../data/KnowLinkText";
import { knowSynonyms } from "../data/KnowSynonyms";
import { isJevEnabled } from "../../ai/jev/enabled";
import type { BankRecord, QuestionBank } from "../data/QuestionBank";

/**
 * 同义判定相（Issue #3）的编排：**先跑零 AI 文本层**（标签 ↔ 小节标题
 * 归一匹配，含同义表前置层），剩下的词对（按 synKey 去重、跳过表里已
 * 判定的）按批 AI 判同义 → 判定写回同义表 + 当轮挂引用。三个入口（批量
 * 关联 / 生成标签核对 / 匹配）共用这一份，**不复制第二份**——差异只在
 * 「拿哪些记录来跑」与成败如何并入各自的汇总文案。
 *
 * 文本层放在相内而不是只交给调用方：匹配（MatchDialog）原先直接进 AI
 * 路由，没有零 AI 文本层；相内统一跑一遍，三个入口口径才一致（调用方
 * 已跑过文本层的，传进来的都是 missed，这一遍自然空转）。
 *
 * 幂等：判定写回表后，第二轮同词对 `pendingPairs` 直接过滤掉，零 AI。
 *
 * **判定供给可插拔**（Issue #188，规划稿 §三 B2）：配了 Jev key 且总闸未关
 * → 逐对走 `judgeSynonymsJev`（choice 三档、一批一请求）；否则照旧走
 * `judgeSynonyms`（生成式 + 编号行协议）。分流只此一处，两个通道**共用同一
 * 个 `pendingPairs` 队列与写回侧 `putMany`**，存储结构与缓存口径零变化。
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
    /** 词表是否全库口径（lexiconOfRoots）：只有它才允许把「不同义」落表
     *  ——匹配入口的词表只含选中文档，那里的否换个文档就会翻案。 */
    completeLibrary?: boolean;
    /** 设置面（只读 `jevKey` / `jevEnabled`）：有 key 且未关总闸 → 判定供给
     *  换 Jev（Issue #188）；未配 → 现状生成式通道，行为零变化。
     *  缺省 = 未配置 = 走现状（线上不会缺省，测试与存量调用点友好）。 */
    settings?: { jevKey?: string; jevEnabled?: boolean };
}

/** 执行结果：文本层挂上数 + 同义层挂上数 + 仍未命中的记录（交给下一相）。 */
export interface SynPhaseResult {
    textHit: number;
    synHit: number;
    rest: BankRecord[];
}

/** 全流程（零 AI 文本层 + AI 判定 + 落库 + 同步表）。store 未接线
 *  （测试环境）时不跑 AI，但文本层照跑——与改造前调用方口径一致。 */
export async function runSynonymPhase(deps: SynPhaseDeps): Promise<SynPhaseResult> {
    const store = knowSynonyms();
    // 等装载完成再取表（重载后 peek 尚为空表，会漏掉存量判定）
    const table = store ? await store.snapshot() : undefined;
    const rest: BankRecord[] = [];
    let textHit = 0;
    for (const r of deps.records) {
        if (deps.stop.signal.aborted) {
            rest.push(r);
            continue;
        }
        const refs = r.knowledge ? textRefsFor(r.knowledge, deps.lex, table) : [];
        if (refs.length > 0 && (await applyRefsToRecord(deps.bank, r, refs))) textHit++;
        else rest.push(r);
    }
    if (!store || rest.length === 0 || deps.lex.size === 0) return { textHit, synHit: 0, rest };
    const pairs = pendingPairs(rest, deps.lex, new Map(Object.entries(table!.entries)));
    if (pairs.length === 0) return { textHit, synHit: 0, rest };
    const pool = candidatePool(deps.lex);
    if (pool.length === 0) return { textHit, synHit: 0, rest };
    const onFail = deps.onFail;
    if (isJevEnabled(deps.settings)) {
        // Jev 通道（Issue #188）：逐对 choice 三档、一批一请求；失败/低置信
        // 一律不落表（下次重问），不做二次采购、不新增弹窗（需求 4）
        await judgeSynonymsJev({
            pairs,
            pool,
            store,
            apiKey: deps.settings!.jevKey!.trim(),
            signal: deps.stop.signal,
            onFail,
            // 会话登记（Issue #201）：本相各批判定挂调用方给的组（与生成式
            // 通道同一组 id：面板树上「一次匹配/批量关联」的记录同树归并）
            ...(deps.group ? { group: deps.group } : {}),
        });
    } else {
        // 现状生成式通道（无 key / 总闸关）：逐字节等同改造前行为
        await judgeSynonyms({
            pairs,
            pool,
            modelId: deps.modelId,
            signal: deps.stop.signal,
            store,
            group: deps.group,
            onSid: deps.stop.onSid,
            onFail,
            persistDeny: deps.completeLibrary ?? false,
        });
    }
    // 挂引用：判定的规范词已写回表，重跑文本层口径即得命中小节
    const judged = await store.snapshot();
    let synHit = 0;
    const left: BankRecord[] = [];
    for (const r of rest) {
        if (deps.stop.signal.aborted) {
            left.push(r);
            continue;
        }
        const refs = r.knowledge ? textRefsFor(r.knowledge, deps.lex, judged) : [];
        if (refs.length > 0 && (await applyRefsToRecord(deps.bank, r, refs))) synHit++;
        else left.push(r);
    }
    return { textHit, synHit, rest: left };
}
