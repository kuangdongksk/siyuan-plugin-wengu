import { Attr } from "../../siyuan/attrs";
import { KernelBlock } from "../../siyuan/block";
import { KernelQuery } from "../../siyuan/query";
import { appendBlockToDoc, buildPrompt, extractBatchQuestions } from "./ConvertService";
import { buildKnowledgeIndex, makeKnowAwareAi } from "./KnowledgeLink";
import { applyKnowLinks } from "./KnowRef";
import type { KnowSection, KnowledgeIndex } from "./KnowledgeLink";
import { structuralChunks, withSrcAttrs, type StructChunk, type SrcGroup } from "./SrcChunk";

/**
 * 增量重转换执行（增量哈希二期，docs/incremental-hash-plan.md §二）：
 * 重新导入入口把源文档重新结构切块、与题集已存的 src-key/src-hash
 * 比对三态分类后，本模块执行「删除/标记/补生成」的落盘侧——删除选择
 * 重生成或已消失的旧块、给选择保留的旧块打 src-stale 标记、对新增与
 * 重生成块逐块走与整卷转换同款的「路由+生成」（每块独立会话、串行
 * 追加一次一块），产物携带该块的键与指纹追加到**既有**题集文档末尾
 * （不删旧重建——未变块的原题与刷题统计原样保留）。
 *
 * 自愈性：中止后已追加的块自带指纹，下次重跑分类即「相同」跳过，
 * 不需要续跑记录。内核调用全程串行（fetchSyncPost 并发互吞）。
 */

/** 读题集文档里已落盘的源块分组（attributes 按 root_id 全量分页查，
 *  同一 src-hash 的题目/材料容器块归一组；查不到 src-hash 返回空=
 *  旧版题集，调用方回落整卷重转）。 */
export async function readSrcGroups(quizDocId: string): Promise<SrcGroup[]> {
    if (!/^[\w-]+$/.test(quizDocId)) return [];
    const hashes = await KernelQuery.rowsAll<{ id?: string; hash?: string }>(
        `SELECT block_id AS id, value AS hash FROM attributes WHERE root_id = '${quizDocId}' AND name = '${Attr.srcHash}'`
    );
    const keys = new Map(
        (
            await KernelQuery.rowsAll<{ id?: string; key?: string }>(
                `SELECT block_id AS id, value AS key FROM attributes WHERE root_id = '${quizDocId}' AND name = '${Attr.srcKey}'`
            )
        )
            .filter((r) => r.id && r.key)
            .map((r) => [r.id as string, r.key as string])
    );
    const byHash = new Map<string, SrcGroup>();
    for (const r of hashes) {
        if (!r.id || !r.hash) continue;
        let g = byHash.get(r.hash);
        if (!g) {
            g = { key: "", hash: r.hash, blocks: [] };
            byHash.set(r.hash, g);
        }
        if (!g.blocks.includes(r.id)) g.blocks.push(r.id);
        if (!g.key && keys.get(r.id)) g.key = keys.get(r.id) as string;
    }
    return [...byHash.values()];
}

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
    /** 待删除的旧容器块（选择重生成的变更块 + 选择删除的消失块）。 */
    deleteBlockIds: string[];
    /** 保留但源已更新的旧块（打 src-stale 标记）。 */
    staleBlockIds: string[];
    /** 待生成的新块（新增 + 选择重生成的变更块）。 */
    chunks: StructChunk[];
    /** 追加目标：既有题集文档 id。 */
    quizDocId: string;
    modelId: string;
    fillToChoice: boolean;
    bigToSteps: boolean;
    knowRoots?: string[];
    signal?: AbortSignal;
    /** 逐块进度（done=已完成块数，count=已生成题数）。 */
    onProgress?(p: { done: number; total: number; count: number }): void;
}

/** 增量执行结果。aborted=中途终止（已追加部分保留，自愈见文件头）。 */
export interface IncrementOutcome {
    aborted: boolean;
    /** 生成追加的题目数（不含材料块）。 */
    added: number;
    /** 删除的容器块数。 */
    deleted: number;
    /** 打了 src-stale 的块数。 */
    staled: number;
    /** 知识点反链挂上的题数。 */
    knowLinked: number;
}

/** 执行增量：删旧 → 标记 → 逐块生成追加（串行；AI 走独立会话）。 */
export async function convertIncremental(run: IncrementRun): Promise<IncrementOutcome> {
    const out: IncrementOutcome = { aborted: false, added: 0, deleted: 0, staled: 0, knowLinked: 0 };
    for (const id of run.deleteBlockIds) {
        if (run.signal?.aborted) {
            out.aborted = true;
            return out;
        }
        try {
            const res = await KernelBlock.remove(id);
            if (res.code === 0) out.deleted++;
        } catch (_) {
            // 单块删除失败不阻断（下次重跑分类仍会列出）
        }
    }
    for (const id of run.staleBlockIds) {
        try {
            const res = await KernelBlock.setAttrs(id, { [Attr.srcStale]: "1" });
            if (res.code === 0) out.staled++;
        } catch (_) {
            // 标记失败同样不阻断
        }
    }
    if (run.chunks.length === 0) return out;

    let knowIndex: KnowledgeIndex | undefined;
    if (run.knowRoots?.length) {
        knowIndex = await buildKnowledgeIndex(run.knowRoots).catch((): undefined => undefined);
    }
    const callAi = makeKnowAwareAi({
        modelId: run.modelId,
        signal: run.signal ?? new AbortController().signal,
        knowIndex,
        buildPrompt: (source, rule, list) => buildPrompt(source, run.fillToChoice, run.bigToSteps, rule, list),
    });
    for (let i = 0; i < run.chunks.length; i++) {
        if (run.signal?.aborted) {
            out.aborted = true;
            break;
        }
        const chunk = run.chunks[i];
        run.onProgress?.({ done: i, total: run.chunks.length, count: out.added });
        let gen: { reply: string; byAlias?: Map<string, KnowSection> };
        try {
            gen = await callAi(chunk.text);
        } catch (e) {
            if (run.signal?.aborted) {
                out.aborted = true;
                break;
            }
            throw e; // 单块 AI 失败整体收口（已追加部分保留，重跑自愈）
        }
        let qs = extractBatchQuestions(gen.reply);
        if (gen.byAlias && qs.length > 0) {
            const applied = applyKnowLinks(qs, gen.byAlias);
            qs = applied.out;
            out.knowLinked += applied.linked;
        }
        for (const unit of qs) {
            await appendBlockToDoc(run.quizDocId, withSrcAttrs(unit, chunk.key, chunk.hash));
            if (!unit.includes("custom-plugin-wengu-material=")) out.added++;
        }
    }
    run.onProgress?.({ done: run.chunks.length, total: run.chunks.length, count: out.added });
    return out;
}
