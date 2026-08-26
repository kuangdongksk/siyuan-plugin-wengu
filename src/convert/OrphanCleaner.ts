import { fetchSyncPost } from "siyuan";
import { Attr } from "../siyuan/attrs";

/**
 * 孤儿习题文档清理（契约见 docs/question-block-contract.md「转换配对」）：
 * 转换时在习题文档根块打 custom-plugin-wengu-source-doc=源讲义文档 id；
 * 装载时核对源文档是否仍在——已删（进回收站即离开 SQL 索引）则把配对
 * 的习题文档一并删入回收站（可在思源回收站找回）。
 *
 * fetchSyncPost 必须串行调用（内核并发会互相吞响应，真机踩坑）。
 */

/** 块 id 字符集（拼 SQL 前校验，防脏值）。 */
const ID_RE = /^[\w-]+$/;

/** 找出源讲义已不存在的习题文档 id（attributes 表配对 + 存在性核对）。 */
async function findOrphanDocIds(): Promise<string[]> {
    const { data } = await fetchSyncPost("/api/query/sql", {
        stmt: `SELECT block_id AS docId, value AS srcId FROM attributes WHERE name = '${Attr.sourceDoc}'`,
    });
    const pairs = ((data ?? []) as { docId?: string; srcId?: string }[]).filter(
        (p) => !!p.docId && !!p.srcId && p.docId !== p.srcId && ID_RE.test(p.srcId)
    );
    if (pairs.length === 0) return [];
    const ids = pairs.map((p) => `'${p.srcId}'`).join(",");
    const { data: alive } = await fetchSyncPost("/api/query/sql", {
        stmt: `SELECT id FROM blocks WHERE type = 'd' AND id IN (${ids})`,
    });
    const living = new Set(((alive ?? []) as { id?: string }[]).map((x) => String(x.id ?? "")));
    return pairs.filter((p) => !living.has(String(p.srcId))).map((p) => String(p.docId));
}

/**
 * 清理孤儿习题文档（逐个串行删入回收站）。返回实际删掉的文档 id，
 * 供调用方联动清理插件侧数据（会话历史）；查询/删除失败都不抛，
 * 留待下次装载重试。
 */
export async function cleanOrphanExerciseDocs(): Promise<string[]> {
    let orphans: string[];
    try {
        orphans = await findOrphanDocIds();
    } catch (_) {
        return [];
    }
    const removed: string[] = [];
    for (const id of orphans) {
        try {
            const { code } = await fetchSyncPost("/api/filetree/removeDocByID", { id });
            if (code === 0) removed.push(id);
        } catch (_) {
            // 单个失败跳过，下次装载重试
        }
    }
    return removed;
}
