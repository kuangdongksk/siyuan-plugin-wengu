import { fetchSyncPost, type IWebSocketData } from "siyuan";
import { EApi } from "./api";
import { KernelQuery } from "./query";

/**
 * 块级内核操作（迁自 sy-lively 的 SY块，英文方法名适配）。
 * 内核行为约束（真机验证记录见 AGENTS.md「内核坑」）：
 * - 追加**一次一块**：多块 markdown 会散落错位；
 * - IAL 必须独立成行才落块属性，行内 IAL 会变成正文；
 * - parentID 锚点必须是真实子块（文档根块=假成功）。
 */

/** 文档 kramdown → 块 id 的文档序位置表（IAL `id="…"` 首次出现序；纯函数）。
 *  SQL 的块排序在导入语料（MinerU 等）上不可信：块 sort/created 全退化
 *  （20260907 真机实测 23/23 章节 sort 全同值），`ORDER BY sort` 返回任意
 *  序——小节树/正文拼接顺序随查询计划漂移。文档序唯一可靠来源是根块
 *  kramdown 里块 id 的出现序。锚定 `id="` 只认 IAL：引用 `((id "标题"))`
 *  的外来 id 不进表（位置表按 id 回查，无人查的外来条目无影响）。 */
export function kramdownBlockOrder(kramdown: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const m of kramdown.matchAll(/id="(\d{14}-[a-z0-9]+)"/g)) {
        if (!out.has(m[1])) out.set(m[1], out.size);
    }
    return out;
}

/** SQL 行按文档序回排（纯函数）：无位置的行沉底并保持原相对序（排序
 *  稳定性）。位置表为空 = 原样返回（kramdown 拉取失败的降级路径）。 */
export function byDocOrder<T>(rows: T[], idOf: (r: T) => string, order: Map<string, number>): T[] {
    if (order.size === 0) return rows;
    const pos = (r: T): number => order.get(idOf(r)) ?? Number.MAX_SAFE_INTEGER;
    return [...rows].sort((a, b) => pos(a) - pos(b));
}

/** 文档序缓存（docId → { stamp, order }；stamp=文档 updated，内容变更才
 *  重拉 kramdown——知识语料稳定，首拉后装载近零成本）。 */
const docOrderCache = new Map<string, { stamp: string; order: Map<string, number> }>();

export class KernelBlock {
    /** 插入后置子块（文档/容器末尾——渐进追加的主通道）。 */
    static append(options: { dataType: "markdown" | "dom"; data: string; parentID: string }) {
        return fetchSyncPost(EApi.AppendBlock, options);
    }

    /** 更新块（⚠ 多块数据会丢段，只用于单块）。 */
    static update(options: { id: string; dataType: "markdown" | "dom"; data: string }) {
        return fetchSyncPost(EApi.UpdateBlock, options);
    }

    /** 删块（超级块容器连子块一起删；20260831 增量重转换删除变更旧题用，
     *  上次清理时因零调用方移除、现有消费方后回填）。 */
    static remove(id: string): Promise<IWebSocketData> {
        return fetchSyncPost(EApi.DeleteBlock, { id });
    }

    /** 取块 kramdown 源码（含 IAL；真实内容，不受 SQL 索引延迟影响）。 */
    static kramdown(id: string): Promise<IWebSocketData> {
        return fetchSyncPost(EApi.GetBlockKramdown, { id });
    }

    /** 取子块列表（标题下方块也算子块；length 为分页大小，题目/材料
     *  hydrate 用 128 防长块截断）。 */
    static children(id: string, length?: number): Promise<IWebSocketData> {
        return fetchSyncPost(EApi.GetChildBlocks, { id, ...(length !== undefined ? { length } : {}) });
    }

    /** 写块属性（合并写，键为 custom-* 全名）。 */
    static setAttrs(id: string, attrs: Record<string, string>) {
        return fetchSyncPost(EApi.SetBlockAttrs, { id, attrs });
    }

    /** 读块属性。 */
    static getAttrs(id: string): Promise<IWebSocketData> {
        return fetchSyncPost(EApi.GetBlockAttrs, { id });
    }

    /** 文档块序（docId → id→出现序位置表，根块 kramdown 解析）：SQL
     *  `ORDER BY sort` 不可信语料的文档序权威来源，按文档 updated 缓存。
     *  文档不存在/kramdown 拉取失败返回空表（消费方降级=保持 SQL 序）；
     *  失败不缓存，下次装载重试。fetchSyncPost 串行约束下调用方逐文档
     *  await（与既有序核调用循环同款式）。 */
    static async docOrder(docId: string): Promise<Map<string, number>> {
        let row: { id: string; updated: string } | undefined;
        try {
            row = (
                await KernelQuery.rows<{ id: string; updated: string }>(
                    `SELECT id, updated FROM blocks WHERE id = '${docId}' AND type = 'd' LIMIT 1`
                )
            )[0];
        } catch (_) {
            return new Map();
        }
        if (!row) return new Map();
        const stamp = row.updated ?? "";
        const hit = docOrderCache.get(docId);
        if (hit && hit.stamp === stamp) return hit.order;
        let order = new Map<string, number>();
        try {
            const kd = String(
                ((await KernelBlock.kramdown(docId)).data as { kramdown?: string } | null)?.kramdown ?? ""
            );
            order = kramdownBlockOrder(kd);
        } catch (_) {
            return order; // 不缓存失败：下次重试
        }
        docOrderCache.set(docId, { stamp, order });
        return order;
    }
}
