import { agentChatOnce } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { SYN_BATCH_SIZE, synJudgePrompt } from "../../ai/prompts/synonyms";
import { parseSynReply } from "../../ai/prompts/synonyms";
import type { BankRecord } from "./QuestionBank";
import type { KnowSynonymEntry, KnowSynonymsStore } from "./KnowSynonyms";
import { synKey } from "./KnowSynonyms";
import { textRefsFor, type LexSection, type LexSectionMap } from "./KnowLinkText";

/**
 * 同义判定兜底层（20260910，Issue #3）：文本精确层未命中的题（`missed`）
 * 按批送 AI 判「knowledge 标签 ↔ 小节标题」是否同义，命中即**写回同义
 * 表**（KnowSynonyms）并当轮挂引用。下一轮同对词查表零 AI。
 *
 * 判定是**受控**的：AI 只回答「同义 / 不同义」（或逐字抄写候选清单里
 * 的写法），规范词一律取清单侧小节标题原文——不让 AI 造词，与 gen 的
 * 「标签=命中小节标题」同口径。队列按 synKey 去重，只跑「表里还没判过」
 * 的词对；判过的（含判否的空串）不重问。
 *
 * AI 调用走 agentChatOnce + track（kind="route"，批量路由同族）；失败
 * 只上报不中断（下一批继续），**失败批次不落表**——重跑再试。
 */

/** 一个待判定词对（标签原文 + 本轮可见的候选小节清单）。 */
export interface SynPair {
    /** 标签原文（写回同义表的 raw）。 */
    raw: string;
    /** 候选小节（清单里按标题相似度挑出的少数几条；AI 只能在其中选）。 */
    candidates: LexSection[];
}

/** 每对词带的候选上限（清单小=漏判少；跨语言对靠公共清单兜底）。 */
const CAND_PER_PAIR = 4;

/** 候选小节总上限（清单文本预算，与 route 的字符预算同思路）。 */
const CAND_POOL_MAX = 80;

/** 表里是否已判定过：查得到即不再问 AI（含判否的空串）。 */
export function isJudged(entries: Map<string, KnowSynonymEntry>, raw: string): boolean {
    return entries.has(synKey(raw));
}

/** 按 synKey 去重挑待判定词对（纯函数）：只收带 knowledge、长度 ≥2、
 *  表里没有、且文本层**完全挂不上**的记录——已有唯一候选=文本层自己
 *  能命中（走到这里必是歧义或无可比候选，歧义不挂，AI 也不该越过
 *  「宁漏勿错」）。 */
export function pendingPairs(
    records: BankRecord[],
    lex: LexSectionMap,
    entries: Map<string, KnowSynonymEntry>
): SynPair[] {
    const seen = new Set<string>();
    const out: SynPair[] = [];
    for (const r of records) {
        const raw = (r.knowledge ?? "").trim();
        if (!raw) continue;
        const key = synKey(raw);
        if (!key || key.length < 2 || seen.has(key) || isJudged(entries, raw)) continue;
        seen.add(key);
        if (textRefsFor(raw, lex).length > 0) continue;
        out.push({ raw, candidates: [] });
    }
    return out;
}

/** 全部候选小节（词表白名单）：AI 判同义时的规范词来源，按标题去重
 *  截到 {@link CAND_POOL_MAX} 条（宁漏勿错，清单小=错并少）。 */
export function candidatePool(lex: LexSectionMap): LexSection[] {
    const out: LexSection[] = [];
    const seen = new Set<string>();
    for (const list of lex.values()) {
        for (const s of list) {
            if (seen.has(s.title)) continue;
            seen.add(s.title);
            out.push(s);
            if (out.length >= CAND_POOL_MAX) return out;
        }
    }
    return out;
}

/** 逐对候选：标题与标签互为包含（「洛必达」↔「洛必达法则」）时取这几条，
 *  跨语言（「洛必达」↔「L'Hôpital 法则」）取不到就带公共清单头部 N 条
 *  ——仍由 AI 判、仍受清单约束。 */
function pickCandidates(raw: string, pool: LexSection[], max: number): LexSection[] {
    const key = synKey(raw);
    const near = pool.filter((s) => {
        const k = synKey(s.title);
        return k.includes(key) || key.includes(k);
    });
    return (near.length > 0 ? near : []).slice(0, max);
}

/**
 * 按批判定同义词对：每批一次 AI 调用，回来**批量写回同义表**并返回
 * 逐对命中的小节（供当轮挂引用）。返回键 = `synKey(标签)`。
 * `onFail` 上报失败批次（失败不落表，重跑再试）；`signal` 中止时批间
 * 停手，已判定的照常返回。
 */
export async function judgeSynonyms(opts: {
    pairs: SynPair[];
    /** 全部候选小节（词表白名单）。 */
    pool: LexSection[];
    modelId: string;
    signal: AbortSignal;
    store: KnowSynonymsStore;
    group?: { id: string; title: string };
    onSid?: (sid: string) => void;
    onFail?: (e: Error) => void;
}): Promise<Map<string, LexSection[]>> {
    const hits = new Map<string, LexSection[]>();
    if (opts.pairs.length === 0 || opts.pool.length === 0) return hits;
    for (let base = 0; base < opts.pairs.length; base += SYN_BATCH_SIZE) {
        if (opts.signal.aborted) break;
        const batch = opts.pairs.slice(base, base + SYN_BATCH_SIZE);
        const perQ = batch.map((p) => {
            const cands = pickCandidates(p.raw, opts.pool, CAND_PER_PAIR);
            return cands.length > 0 ? cands : opts.pool.slice(0, CAND_PER_PAIR);
        });
        const prompt = synJudgePrompt(
            batch.map((p, i) => ({ label: p.raw, titles: perQ[i].map((s) => s.title).join(" / ") }))
        );
        let reply: string;
        try {
            reply = await agentChatOnce(prompt, opts.modelId, AI_TIMEOUT.quick, opts.signal, {
                kind: "route",
                title: `同义判定 · ${batch.length} 对`,
                group: opts.group,
                onSid: opts.onSid,
            });
        } catch (e) {
            opts.onFail?.(e as Error);
            continue; // 本批失败跳过；失败不落表
        }
        const verdicts = parseSynReply(reply);
        const writes: { raw: string; canonical: string }[] = [];
        for (let i = 0; i < batch.length; i++) {
            const v = verdicts.get(i + 1);
            if (v === undefined) continue; // 缺行=未判定，不落表
            const hit = v
                ? (perQ[i].find((s) => s.title === v) ?? perQ[i].find((s) => synKey(s.title) === synKey(v)))
                : undefined;
            if (!hit) {
                writes.push({ raw: batch[i].raw, canonical: "" }); // 明确否 / 抄了清单外的词：记否防重问
                continue;
            }
            writes.push({ raw: batch[i].raw, canonical: hit.title });
            hits.set(synKey(batch[i].raw), [hit]);
        }
        await opts.store.putMany(writes, "ai");
    }
    await opts.store.flush();
    return hits;
}
