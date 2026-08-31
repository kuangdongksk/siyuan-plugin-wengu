import { fetchSyncPost, type IWebSocketData } from "siyuan";
import { EApi } from "./api";

/**
 * 块级内核操作（迁自 sy-lively 的 SY块，英文方法名适配）。
 * 内核行为约束（真机验证记录见 AGENTS.md「内核坑」）：
 * - 追加**一次一块**：多块 markdown 会散落错位；
 * - IAL 必须独立成行才落块属性，行内 IAL 会变成正文；
 * - parentID 锚点必须是真实子块（文档根块=假成功）。
 */
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
}
