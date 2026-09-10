import { expandKnowDocs } from "../../convert/service/knowledge/KnowledgeLink";
import { injectKnowledgeRefs, stripKnowledgeRefs } from "../../convert/service/knowledge/KnowRef";
import { normalizeKnowledge } from "./KnowledgeNorm";
import { peekSynonyms, synonymNormalize, type KnowSynonymsData } from "./KnowSynonyms";
import { mergeRecordKpRefs } from "./KnowRoots";
import type { KnowTreesMap } from "./KnowTrees";
import type { BankRecord, QuestionBank } from "./QuestionBank";
import { replaceRecordKramdown } from "./BankRegen";

/**
 * 知识点文本关联（2026-08-31）：题库记录上的 knowledge 标签（AI 出题时
 * 裸写）与知识文档小节标题本是同一份真相的两个措辞——归一化（剥命名
 * 性后缀）后精确相等即可**确定性挂引用**，零 AI、瞬时、无误伤。这是
 * 「导入知识文档即关联已有习题」与「批量关联」的第一级；AI 两级路由
 * （MatchDialog 同款）只兜文本未命中的题。
 *
 * 歧义策略同 KnowledgeNorm 的取舍：**宁漏勿错**——归一键命中多个小节
 * （同名校节）不挂，过短（<2 字）不挂。
 *
 * 20260910（Issue #3）起归一链前挂一层**同义表**（KnowSynonyms）：
 * 原文 → 查表（零 AI）→ normalizeKnowledge 剥后缀 → 精确相等。表由
 * AI 兜底层（KnowSynJudge）喂、UI 可查看/清空；表未接线/为空时逐字节
 * 等同改造前行为。
 */

/** 词表小节（标题块 id + 标题）。 */
export interface LexSection {
    id: string;
    title: string;
}

/** 归一键 → 小节列表（词表形态，buildSectionLexicon 的产物）。 */
export type LexSectionMap = Map<string, LexSection[]>;

/** 小节清单 → 词表（归一键 → 小节列表）。标题两侧同走归一链（含同义
 *  表前置层）：表里收到「L'Hôpital 法则 → 洛必达」时，同义写法的小节
 *  与标签落同键。 */
export function buildSectionLexicon(sections: LexSection[], syn?: KnowSynonymsData): LexSectionMap {
    const lex = new Map<string, LexSection[]>();
    for (const s of sections) {
        const key = syn ? synonymNormalize(s.title, syn, normalizeKnowledge) : normalizeKnowledge(s.title);
        if (!key || key.length < 2) continue;
        const arr = lex.get(key) ?? [];
        arr.push(s);
        lex.set(key, arr);
    }
    return lex;
}

/** 确定性文本匹配：knowledge 文本 → 小节引用。归一键**唯一**命中才挂
 *  （歧义/过短返回空）。syn（同义表数据）可选——传了就先进前置层
 *  （查表得规范词 → normalizeKnowledge 剥后缀），不传=改造前口径。 */
export function textRefsFor(knowledge: string, lex: LexSectionMap, syn?: KnowSynonymsData): LexSection[] {
    const key = syn ? synonymNormalize(knowledge, syn, normalizeKnowledge) : normalizeKnowledge(knowledge);
    if (!key || key.length < 2) return [];
    const hits = lex.get(key);
    return hits && hits.length === 1 ? [{ ...hits[0] }] : [];
}

/** 登记根 → 词表：expandKnowDocs 递归展开全部后代文档的层级树小节
 *  （含中间层文档——任何标题块都是合法引用目标）。根已删/拉取失败跳过。
 *  trees=内部知识树（命中文档的小节整体替换为树节点）。 */
export async function lexiconOfRoots(rootIds: string[], trees?: KnowTreesMap): Promise<Map<string, LexSection[]>> {
    const sections: LexSection[] = [];
    for (const rid of rootIds) {
        let docs: Awaited<ReturnType<typeof expandKnowDocs>> = [];
        try {
            docs = await expandKnowDocs(rid, trees);
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

/** 把引用落进一条题库记录（strip+inject 替换语义 + kpRefs 合并；题库
 *  即唯一真相，无文档同步半边）；返回是否有改动。MatchDialog 与批量
 *  关联共用。 */
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
    await replaceRecordKramdown(bank, r.qid, next);
    await mergeRecordKpRefs(bank, r.qid, refs);
    return true;
}

/** 容器 IAL 上写/改 knowledge 属性（纯函数）：已有则替换值，没有则在
 *  容器属性行（custom-plugin-wengu-q 所在行）末尾追加。值里的引号/反
 *  斜杠剥掉（属性值不该含）。 */
export function setKnowledgeAttr(kd: string, knowledge: string): string {
    const attr = "custom-plugin-wengu-knowledge";
    const val = knowledge.replace(/["\\]/g, "").trim();
    if (!val) return kd;
    if (kd.includes(`${attr}="`)) return kd.replace(new RegExp(`${attr}="[^"]*"`), `${attr}="${val}"`);
    return kd.replace(
        /\{:[^\n]*custom-plugin-wengu-q="[^"]*"[^\n]*\}/,
        (ial: string) => ial.slice(0, -1) + ` ${attr}="${val}"}`
    );
}

/** 标签生成结果的落库：写 knowledge 属性（IAL + 记录字段）并挂引用。
 *  r 是题库里的活引用（recordsOfDoc/values 直出），knowledge 字段就地
 *  更新后 markDirty。返回是否有改动。 */
export async function applyTagToRecord(
    bank: QuestionBank,
    r: BankRecord,
    knowledge: string,
    refs: { id: string; title: string }[]
): Promise<boolean> {
    const tagged = setKnowledgeAttr(r.kramdown, knowledge);
    const merged = [...r.kpRefs];
    for (const x of refs) {
        if (!merged.some((m) => m.id === x.id)) merged.push(x);
    }
    const next = injectKnowledgeRefs(stripKnowledgeRefs(tagged), merged);
    if (next !== r.kramdown) {
        await replaceRecordKramdown(bank, r.qid, next);
        await mergeRecordKpRefs(bank, r.qid, refs);
    }
    let changed = next !== r.kramdown;
    if (r.knowledge !== knowledge) {
        r.knowledge = knowledge;
        changed = true;
    }
    if (changed && next === r.kramdown) bank.markDirty();
    return changed;
}

/** AI 自由标签输出解析（纯函数）：`N|标签` 行 → qid 无关的编号→标签
 *  映射；`N|-` 表示该题无合适标签（跳过）。标签截 24 字防跑飞。 */
export function parseFreeTags(reply: string): Map<number, string> {
    const out = new Map<number, string>();
    for (const m of reply.matchAll(/^\s*(\d+)\s*[|｜:：]\s*(.+?)\s*$/gm)) {
        const n = Number(m[1]);
        const tag = m[2].trim();
        if (!Number.isFinite(n) || n < 1) continue;
        if (tag === "-" || tag === "－") continue;
        out.set(n, tag.slice(0, 24));
    }
    return out;
}

/** 记录集的文本关联（核对/批量共用原语）：带 knowledge 标签且（默认）
 *  未挂引用的题走确定性匹配（**先过同义表**）。返回计数与未命中的记录
 *  ——missed 是 AI 兜底层（KnowSynJudge）的输入：它的 knowledge 尚在
 *  词表里找不到任何小节，才值得花 AI 判一次同义。 */
export async function linkRecordsByText(
    bank: QuestionBank,
    lex: Map<string, LexSection[]>,
    records: BankRecord[],
    opts: { skipLinked?: boolean; signal?: AbortSignal } = {}
): Promise<{ hit: number; miss: number; skip: number; missed: BankRecord[] }> {
    const skipLinked = opts.skipLinked ?? true;
    const syn = peekSynonyms(); // 同义表快照：本轮内不变（AI 判定的写回走下一轮）
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
        const refs = r.knowledge ? textRefsFor(r.knowledge, lex, syn) : [];
        if (refs.length > 0 && (await applyRefsToRecord(bank, r, refs))) hit++;
        else {
            miss++;
            missed.push(r);
        }
    }
    return { hit, miss, skip, missed };
}

/** 全库文本关联（导入即关联 / 批量关联 phase1）。 */
export async function linkBankByText(
    bank: QuestionBank,
    lex: Map<string, LexSection[]>,
    opts: { skipLinked?: boolean; signal?: AbortSignal } = {}
): Promise<{ hit: number; miss: number; skip: number; missed: BankRecord[] }> {
    const data = await bank.all();
    const records = Object.values(data.records).sort((a, b) => a.qid.localeCompare(b.qid));
    return linkRecordsByText(bank, lex, records, opts);
}
