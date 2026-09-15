import { agentChatOnce } from "../../ai/client";
import { aiTitle } from "../../ui/shared";
import { tKey } from "../../ui/Notify";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { synJudgePrompt, parseSynReply, SYN_BATCH_SIZE, SYN_LIST_CHARS } from "../../ai/prompts/synonyms";
import type { BankRecord } from "./QuestionBank";
import type { KnowSynonymEntry, KnowSynonymsStore } from "./KnowSynonyms";
import { synKey } from "./KnowSynonyms";
import { textRefsFor, type LexSection, type LexSectionMap } from "./KnowLinkText";

/**
 * 同义判定兜底层（20260910，Issue #3）：文本精确层未命中的题（`missed`）
 * 按批送 AI 判「knowledge 标签 ↔ 小节标题」是否同义，命中即**写回同义
 * 表**（KnowSynonyms）并当轮挂引用。下一轮同对词查表零 AI。
 *
 * **清单协议与 route 同源**（20260910 审查修复）：一批共用**一份编号
 * 小节清单**（{@link candidateList}，按字符预算截断、标签的近邻标题优先
 * 入清单），AI 逐行回「标签编号|小节编号」——不再给每对词塞 4 条候选。
 * 旧「每对只给少数候选」的写法让跨语言对（「洛必达」↔「L'Hôpital 法则」）
 * 看不到正确项，AI 只能答「-」，而答「-」会被当判定结果**永久落表为
 * 不同义**——一次采购就把该对词判死，第二轮零 AI 却永远不命中。
 *
 * 判定是**受控**的：AI 只能回清单里的**编号**（容错也接受逐字抄写的
 * 标题），规范词一律取清单侧小节标题原文——不让 AI 造词。队列按 synKey
 * 去重，只跑「表里还没判过」的词对。
 *
 * **三态判定**（防固化错判）：`-`=明确不同义（落表记否，防重问）；
 * 编号/标题=命中（落表 + 当轮挂引用）；**答非所问（说不清、给了清单外
 * 的写法）= 本对不落表**，下次重问——「一次错判被永久固化」的口子就堵在
 * 这里。
 *
 * **判否要连「AI 看得全不全」一起看**（20260910 审查修复）：否是相对
 * 当时那份清单做出的结论，表却是全局的。两处收口：
 *  - `persistDeny`（调用方给）：**只有词表是全库口径**（批量关联/生成标签）
 *    才落「否」；匹配入口的清单只含**选中的那一篇**知识文档，那里的「否」
 *    换个文档就可能翻案，落了表就会永久挡住合法匹配 → 不落表，下次重问。
 *  - `truncated`（清单被预算截断，仅病态大词表）：正确项可能正落在截掉的
 *    部分，那次「不同义」不是有效判定 → 不落表。
 *
 * AI 调用走 agentChatOnce + track（kind="route"，批量路由同族）；失败
 * 只上报不中断（下一批继续），**失败批次不落表**——重跑再试。
 */

/** 一个待判定词对（当前只带标签原文；候选清单按批共用）。 */
export interface SynPair {
    /** 标签原文（写回同义表的 raw）。 */
    raw: string;
}

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
        out.push({ raw });
    }
    return out;
}

/** 全部候选小节（词表白名单）：AI 判同义时的规范词来源，按标题去重。 */
export function candidatePool(lex: LexSectionMap): LexSection[] {
    const out: LexSection[] = [];
    const seen = new Set<string>();
    for (const list of lex.values()) {
        for (const s of list) {
            if (seen.has(s.title)) continue;
            seen.add(s.title);
            out.push(s);
        }
    }
    return out;
}

/** 一批共用的小节编号清单（与 route 的 buildSectionList 同思路）：
 *  **标签的近邻标题优先**（标题与任一标签互为包含——同语言换写法几乎
 *  全在这一档），其余按词表序补足，按字符预算（{@link SYN_LIST_CHARS}）
 *  截断；`truncated`=有条目被截掉（截断时「不定」判定不落表，见文件头）。
 *  近邻优先保证同语言对必见正确项；跨语言对靠清单整体覆盖（预算内装下
 *  的标题越多，跨语言对越可能命中）。纯函数。 */
export function candidateList(
    pool: LexSection[],
    labels: string[]
): { kept: LexSection[]; list2: string; truncated: boolean } {
    const keys = labels.map((l) => synKey(l)).filter((k) => k.length > 0);
    const near = pool.filter((s) => {
        const k = synKey(s.title);
        return keys.some((key) => k.includes(key) || key.includes(k));
    });
    const nearSet = new Set(near);
    const ordered = [...near, ...pool.filter((s) => !nearSet.has(s))];
    const kept: LexSection[] = [];
    let chars = 0;
    for (const s of ordered) {
        if (chars + s.title.length > SYN_LIST_CHARS) continue;
        chars += s.title.length + 4; // 编号与分隔符的固定开销
        kept.push(s);
    }
    return {
        kept,
        list2: kept.map((s, i) => `${i + 1}|${s.title}`).join("\n"),
        truncated: kept.length < ordered.length,
    };
}

/** 一行判定 → 命中小节（纯函数）：先按清单编号取，容错也接受逐字抄写的
 *  标题（AI 偶尔不守编号协议但抄对了写法）。取不到返回 undefined。 */
function resolveHit(verdict: string, kept: LexSection[]): LexSection | undefined {
    if (!verdict || verdict === DENY) return undefined;
    if (/^\d+$/.test(verdict)) return kept[Number(verdict) - 1];
    return kept.find((s) => s.title === verdict) ?? kept.find((s) => synKey(s.title) === synKey(verdict));
}

/** 明确不同义的判定字面量（三态里唯一该落表记否的一态）。 */
const DENY = "-";

/**
 * 按批判定同义词对：每批一次 AI 调用（一次带全批标签 + 共用编号清单），
 * 回来**批量写回同义表**并返回逐对命中的小节（供当轮挂引用）。返回键 =
 * `synKey(标签)`。
 *
 * 落表口径见文件头三态说明：命中与明确否落表，说不清/清单外写法不落表
 * （下次重问）；清单被截断时连明确否也不落表。`onFail` 上报失败批次
 * （失败不落表，重跑再试）；`signal` 中止时批间停手，已判定的照常返回。
 */
export async function judgeSynonyms(opts: {
    pairs: SynPair[];
    /** 全部候选小节（词表白名单）；每批按预算截成共用清单。 */
    pool: LexSection[];
    modelId: string;
    signal: AbortSignal;
    store: KnowSynonymsStore;
    group?: { id: string; title: string };
    onSid?: (sid: string) => void;
    onFail?: (e: Error) => void;
    /** 词表是否为**全库口径**：只有它才落「不同义」（见文件头判否口径）。 */
    persistDeny: boolean;
}): Promise<Map<string, LexSection[]>> {
    const hits = new Map<string, LexSection[]>();
    if (opts.pairs.length === 0 || opts.pool.length === 0) return hits;
    for (let base = 0; base < opts.pairs.length; base += SYN_BATCH_SIZE) {
        if (opts.signal.aborted) break;
        const batch = opts.pairs.slice(base, base + SYN_BATCH_SIZE);
        const { kept, list2, truncated } = candidateList(
            opts.pool,
            batch.map((p) => p.raw)
        );
        if (kept.length === 0) continue;
        const prompt = synJudgePrompt(
            batch.map((p) => ({ label: p.raw })),
            list2,
            "知识点小节清单（编号|写法，候选写法）"
        );
        let reply: string;
        try {
            reply = await agentChatOnce(prompt, opts.modelId, AI_TIMEOUT.quick, opts.signal, {
                kind: "route",
                title: aiTitle(tKey, "aiTitleSameJudgePairs", { n: String(batch.length) }),
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
            if (v === undefined || v === "") continue; // 缺行/说不清=未判定，不落表（下次重问）
            const hit = resolveHit(v, kept);
            if (!hit) {
                // 明确否「清单全库口径 + 未被截断」才记否防重问；否则一律
                // 不落表——防止一次结论（换个清单就会翻案）被永久固化
                if (v === DENY && !truncated && opts.persistDeny) {
                    writes.push({ raw: batch[i].raw, canonical: "" });
                }
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
