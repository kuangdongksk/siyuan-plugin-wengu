import { expandKnowDocs, injectKnowledgeRefs, stripKnowledgeRefs } from "../../convert/service/KnowledgeLink";
import { KernelBlock } from "../../siyuan/block";
import { normalizeKnowledge } from "./KnowledgeNorm";
import { mergeRecordKpRefs } from "./KnowRoots";
import type { BankRecord, QuestionBank } from "./QuestionBank";

/**
 * 知识点文本关联（2026-08-31）：题库记录上的 knowledge 标签（AI 出题时
 * 裸写）与知识文档小节标题本是同一份真相的两个措辞——归一化（剥命名
 * 性后缀）后精确相等即可**确定性挂引用**，零 AI、瞬时、无误伤。这是
 * 「导入知识文档即关联已有习题」与「批量关联」的第一级；AI 两级路由
 * （MatchDialog 同款）只兜文本未命中的题。
 *
 * 歧义策略同 KnowledgeNorm 的取舍：**宁漏勿错**——归一键命中多个小节
 * （同名校节）不挂，过短（<2 字）不挂。
 */

/** 词表小节（标题块 id + 标题）。 */
export interface LexSection {
    id: string;
    title: string;
}

/** 小节清单 → 词表（归一键 → 小节列表）。标题两侧同走 normalizeKnowledge：
 *  「洛必达法则」小节与「洛必达」标签落同键。 */
export function buildSectionLexicon(sections: LexSection[]): Map<string, LexSection[]> {
    const lex = new Map<string, LexSection[]>();
    for (const s of sections) {
        const key = normalizeKnowledge(s.title);
        if (!key || key.length < 2) continue;
        const arr = lex.get(key) ?? [];
        arr.push(s);
        lex.set(key, arr);
    }
    return lex;
}

/** 确定性文本匹配：knowledge 文本 → 小节引用。归一键**唯一**命中才挂
 *  （歧义/过短返回空）。 */
export function textRefsFor(knowledge: string, lex: Map<string, LexSection[]>): LexSection[] {
    const key = normalizeKnowledge(knowledge);
    if (!key || key.length < 2) return [];
    const hits = lex.get(key);
    return hits && hits.length === 1 ? [{ ...hits[0] }] : [];
}

/** 登记根 → 词表：expandKnowDocs 递归展开全部后代文档的层级树小节
 *  （含中间层文档——任何标题块都是合法引用目标）。根已删/拉取失败跳过。 */
export async function lexiconOfRoots(rootIds: string[]): Promise<Map<string, LexSection[]>> {
    const sections: LexSection[] = [];
    for (const rid of rootIds) {
        let docs: Awaited<ReturnType<typeof expandKnowDocs>> = [];
        try {
            docs = await expandKnowDocs(rid);
        } catch (_) {
            // 单根失败跳过，别的根照常
        }
        const walk = (nodes: { id: string; title: string; children: unknown[] }[]): void => {
            for (const n of nodes) {
                sections.push({ id: n.id, title: n.title });
                walk(n.children as { id: string; title: string; children: unknown[] }[]);
            }
        };
        for (const d of docs) walk(d.sectionTree);
    }
    return buildSectionLexicon(sections);
}

/** 把引用落进一条题库记录（strip+inject 替换语义 + kpRefs 合并 + 源块
 *  尽力同步，题库为主记录）；返回是否有改动。MatchDialog 与批量关联共用。 */
export async function applyRefsToRecord(
    bank: QuestionBank,
    r: BankRecord,
    refs: { id: string; title: string }[]
): Promise<boolean> {
    const merged = [...r.kpRefs];
    for (const x of refs) {
        if (!merged.some((m) => m.id === x.id)) merged.push(x);
    }
    const next = injectKnowledgeRefs(stripKnowledgeRefs(r.kramdown), merged);
    if (next === r.kramdown) return false;
    await bank.replaceRecordKramdown(r.qid, next);
    await mergeRecordKpRefs(bank, r.qid, refs);
    try {
        await KernelBlock.update({ id: r.qid, dataType: "markdown", data: next });
    } catch (_) {
        // 源块同步失败：题库已是主记录（gen- 生成题无源块也走这里）
    }
    return true;
}

/** 全库文本关联（导入即关联 / 批量关联 phase1）：遍历题库记录，带
 *  knowledge 标签且（默认）未挂引用的题走确定性匹配。返回计数与
 *  未命中的记录（供 AI 兜底层接着跑）。 */
export async function linkBankByText(
    bank: QuestionBank,
    lex: Map<string, LexSection[]>,
    opts: { skipLinked?: boolean; signal?: AbortSignal } = {}
): Promise<{ hit: number; miss: number; skip: number; missed: BankRecord[] }> {
    const skipLinked = opts.skipLinked ?? true;
    const data = await bank.all();
    const records = Object.values(data.records).sort((a, b) => a.qid.localeCompare(b.qid));
    let hit = 0;
    let miss = 0;
    let skip = 0;
    const missed: BankRecord[] = [];
    for (const r of records) {
        if (opts.signal?.aborted) break;
        if (skipLinked && r.kpRefs.length > 0) {
            skip++;
            continue;
        }
        const refs = r.knowledge ? textRefsFor(r.knowledge, lex) : [];
        if (refs.length > 0 && (await applyRefsToRecord(bank, r, refs))) hit++;
        else {
            miss++;
            missed.push(r);
        }
    }
    return { hit, miss, skip, missed };
}
