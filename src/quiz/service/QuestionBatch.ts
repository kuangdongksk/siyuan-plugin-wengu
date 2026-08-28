import { Attr } from "../../siyuan/attrs";
import { KernelBlock } from "../../siyuan/block";
import { KernelQuery } from "../../siyuan/query";
import type { WenguQuestion } from "../../types";
import { assembleQuestion, type ChildBlock, type StemRewrite } from "./QuestionService";
import { flushStemRewrites } from "./QuestionService";

/**
 * 批量题目装载（长卷性能，2026-08-26）：整卷子块+part 属性用一条
 * JOIN SQL 分页拉全（~每 512 行一次请求），替代逐题
 * getChildBlocks+SQL 的 2×N 次串行往返——193 题的卷子从 ~390 次
 * 降到 ~4 次。请求仍全程串行（内核并发互吞，真机约束）。
 *
 * 排序口径：子块按 id 字典序——生成文档顺序追加写入，同容器内
 * id 序 == 文档序（手工重排块的小概率乱序不追求，单题 hydrate
 * 仍走 getChildBlocks 保序，复习详情等小场景不受影响）。
 */

/** 题容器 id 分片（IN 列表长度上限，防语句过长）。 */
const ID_CHUNK = 200;

interface ChildRow {
    pid: string;
    bid: string;
    markdown?: string;
    part?: string;
}

/** 单容器 hydrate 共用步：取子块（文档序）+ 其 part 属性 Map。题目
 *  hydrate（QuestionService）与材料 hydrate（MaterialService）原本
 *  各写一份 getChildBlocks+part SQL 样板，抽到这里合一。 */
export async function fetchChildParts(id: string): Promise<{ blocks: ChildBlock[]; partById: Map<string, string> }> {
    const { data: children } = await KernelBlock.children(id, 128);
    const blocks = (children as ChildBlock[]) ?? [];
    const partById = new Map<string, string>();
    if (blocks.length === 0) return { blocks, partById };
    const ids = blocks.map((b) => b.id).join("','");
    const rows = await KernelQuery.rows<{ block_id: string; value: string }>(
        `SELECT block_id, value FROM attributes WHERE name = '${Attr.part}' AND block_id IN ('${ids}')`
    );
    for (const r of rows) partById.set(r.block_id, r.value);
    return { blocks, partById };
}

/** 整卷批量 hydrate：逐题失败降级为不完整题目，不拖垮整列表。 */
export async function hydrateAll(questions: WenguQuestion[]): Promise<void> {
    if (questions.length === 0) return;
    const blocksByPid = new Map<string, ChildBlock[]>();
    const partById = new Map<string, string>();
    for (let off = 0; off < questions.length; off += ID_CHUNK) {
        const inList = questions
            .slice(off, off + ID_CHUNK)
            .map((q) => q.id)
            .join("','");
        // 分页 2048（默认 512）：整卷 ~2000 行从 4~5 次串行内核请求
        // 压到 1 次（fetchSyncPost 必须串行，省的是往返不是并发）
        const rows = await KernelQuery.rowsAll<ChildRow>(
            `
                SELECT b.parent_id AS pid, b.id AS bid, b.markdown AS markdown, a.value AS part
                FROM blocks AS b
                LEFT JOIN attributes AS a ON a.block_id = b.id AND a.name = '${Attr.part}'
                WHERE b.parent_id IN ('${inList}')
                ORDER BY b.parent_id, b.id`,
            2048
        );
        for (const r of rows) {
            const arr = blocksByPid.get(r.pid) ?? [];
            arr.push({ id: r.bid, markdown: r.markdown });
            blocksByPid.set(r.pid, arr);
            if (r.part) partById.set(r.bid, r.part);
        }
    }
    const rewrites: StemRewrite[] = [];
    for (const q of questions) {
        try {
            rewrites.push(...assembleQuestion(q, blocksByPid.get(q.id) ?? [], partById));
        } catch (_) {
            // 保留块定位信息，缺题干/答案的题在页签里走自评流程
        }
    }
    await flushStemRewrites(rewrites);
}
