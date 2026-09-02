import { buildPrompt } from "./ConvertService";
import { buildKnowledgeIndex, makeKnowAwareAi } from "./KnowledgeLink";
import { applyKnowDrafts, parseDrafts } from "./QuestionDraft";
import { isHeadingOnlyChunk, structuralChunks, type StructChunk } from "./SrcChunk";
import { shuffleDraftOptions } from "./OptionShuffle";
import { SetWriter } from "./SetWriter";
import { removeRecords, staleRecords } from "../../bank/data/BankSets";
import type { QuestionBank } from "../../bank/data/QuestionBank";
import { newAiGroupId, type AiSessionGroup } from "../../ai/client";
import { KernelBlock } from "../../siyuan/block";
import type { KnowSection, KnowledgeIndex } from "./KnowledgeLink";

/**
 * 增量重转换执行（增量哈希二期，docs/incremental-hash-plan.md §二）：
 * 重新导入入口把源文档重新结构切块、与题集记录已存的 srcKey/srcHash
 * （20260903 起指纹存 BankRecord 字段，不再查文档 IAL）比对三态分类后，
 * 本模块执行「删除/标记/补生成」的题库侧——删除选择重生成或已消失的
 * 旧记录、给选择保留的旧记录打 src-stale 标记、对新增与重生成块逐块
 * 走与整卷转换同款的「路由+生成」（每块独立会话、串行入库），产物携带
 * 该块的键与指纹追加到**既有**题集（不删旧重建——未变记录的原题与
 * 刷题统计原样保留）。
 *
 * 自愈性：中止后已入库的记录自带指纹，下次重跑分类即「相同」跳过，
 * 不需要续跑记录。
 */

/** 源文档 kramdown → 结构切块（剥块 id IAL 行，与整卷转换同款预处理）。 */
export async function sourceChunksOf(srcDocId: string): Promise<StructChunk[]> {
    const kd = await KernelBlock.kramdown(srcDocId);
    const text = String((kd.data as { kramdown?: string } | null)?.kramdown ?? "").replace(
        /^\s*(?:>\s*)?\{:[^}\n]*\bid="[^"]*"[^\n]*$/gm,
        ""
    );
    return structuralChunks(text);
}

/** 增量执行的入参（DocOps 组装：分类结果 + 弹窗逐块选择）。 */
export interface IncrementRun {
    /** 待删除的旧记录（选择重生成的变更块 + 选择删除的消失块）。 */
    deleteQids: string[];
    /** 保留但源已更新的旧记录（打 src-stale 标记）。 */
    staleQids: string[];
    /** 待生成的新块（新增 + 选择重生成的变更块）。 */
    chunks: StructChunk[];
    /** 追加目标：既有题集 id。 */
    setId: string;
    /** 题库（删/标/追加的唯一通道）。 */
    bank: QuestionBank;
    /** 题集标题（AI 会话组登记用；组 id 本流程自生成，一次执行=一组）。 */
    title?: string;
    modelId: string;
    fillToChoice: boolean;
    bigToSteps: boolean;
    knowRoots?: string[];
    signal?: AbortSignal;
    /** 逐块进度（done=已完成块数，count=已生成题数）。 */
    onProgress?(p: { done: number; total: number; count: number }): void;
}

/** 增量执行结果。aborted=中途终止（已入库部分保留，自愈见文件头）。 */
export interface IncrementOutcome {
    aborted: boolean;
    /** 生成追加的题目数（不含材料）。 */
    added: number;
    /** 删除的记录数。 */
    deleted: number;
    /** 打了 src-stale 的记录数。 */
    staled: number;
    /** 知识点反链挂上的题数。 */
    knowLinked: number;
}

/** 执行增量：删旧 → 标记 → 逐块生成入库（串行；AI 走独立会话）。 */
export async function convertIncremental(run: IncrementRun): Promise<IncrementOutcome> {
    const out: IncrementOutcome = { aborted: false, added: 0, deleted: 0, staled: 0, knowLinked: 0 };
    if (run.signal?.aborted) {
        out.aborted = true;
        return out;
    }
    if (run.deleteQids.length > 0) {
        const data = await run.bank.all();
        out.deleted = run.deleteQids.filter((qid) => !!data.records[qid]).length;
        await removeRecords(run.bank, run.deleteQids);
    }
    if (run.staleQids.length > 0) {
        await staleRecords(run.bank, run.staleQids);
        const data = await run.bank.all();
        out.staled = run.staleQids.filter((qid) => data.records[qid]?.srcStale === "1").length;
    }
    if (run.chunks.length === 0) {
        await run.bank.flush();
        return out;
    }

    let knowIndex: KnowledgeIndex | undefined;
    if (run.knowRoots?.length) {
        knowIndex = await buildKnowledgeIndex(run.knowRoots).catch((): undefined => undefined);
    }
    // 动作分组（AI 会话面板树归并）：一次增量执行的路由/生成挂同组；
    // 标题带题集名，标题缺失退化用块数
    const label = run.title ?? `${run.chunks.length} 块`;
    const group: AiSessionGroup = { id: newAiGroupId(), title: `增量补生成 · ${label}` };
    const callAi = makeKnowAwareAi({
        modelId: run.modelId,
        signal: run.signal ?? new AbortController().signal,
        knowIndex,
        label,
        group,
        buildPrompt: (source, rule, list) => buildPrompt(source, run.fillToChoice, run.bigToSteps, rule, list),
    });
    const writer = new SetWriter(run.bank);
    for (let i = 0; i < run.chunks.length; i++) {
        if (run.signal?.aborted) {
            out.aborted = true;
            break;
        }
        const chunk = run.chunks[i];
        // 纯标题块零内容：不发 AI，无产物（断点自愈不受影响）
        if (isHeadingOnlyChunk(chunk.text)) continue;
        run.onProgress?.({ done: i, total: run.chunks.length, count: out.added });
        let gen: { reply: string; byAlias?: Map<string, KnowSection> };
        try {
            gen = await callAi(chunk.text);
        } catch (e) {
            if (run.signal?.aborted) {
                out.aborted = true;
                break;
            }
            throw e; // 单块 AI 失败整体收口（已入库部分保留，重跑自愈）
        }
        const drafts = parseDrafts(gen.reply);
        drafts.forEach(shuffleDraftOptions);
        if (gen.byAlias && drafts.length > 0) out.knowLinked += applyKnowDrafts(drafts, gen.byAlias);
        const res = await writer.append(
            run.setId,
            drafts.map((d) => ({ draft: d, srcKey: chunk.key, srcHash: chunk.hash }))
        );
        out.added += res.questions.length;
        await run.bank.flush(); // 逐块落盘（中止自愈建立在已入库上）
    }
    run.onProgress?.({ done: run.chunks.length, total: run.chunks.length, count: out.added });
    await run.bank.flush();
    return out;
}
