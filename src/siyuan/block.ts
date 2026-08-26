import { fetchSyncPost, type IWebSocketData } from "siyuan";
import { EApi } from "./api";

/**
 * 块级内核操作（迁自 sy-lively 的 SY块，英文方法名适配）。
 * 内核行为约束（真机验证记录见 AGENTS.md「内核坑」）：
 * - 插入/追加**一次一块**：多块 markdown 会散落错位；
 * - IAL 必须独立成行才落块属性，行内 IAL 会变成正文；
 * - previousID/parentID 锚点必须是真实子块（文档根块=假成功）。
 */
export class KernelBlock {
    /** 插入块（previousID 锚其后、nextID 锚其前、parentID 入容器，三选一）。 */
    static insert(options: {
        dataType: "markdown" | "dom";
        data: string;
        nextID?: string;
        previousID?: string;
        parentID?: string;
    }) {
        return fetchSyncPost(EApi.InsertBlock, options);
    }

    /** 插入前置子块（容器的第一个子块位置）。 */
    static prepend(options: { dataType: "markdown" | "dom"; data: string; parentID: string }) {
        return fetchSyncPost(EApi.PrependBlock, options);
    }

    /** 插入后置子块（文档/容器末尾——渐进追加的主通道）。 */
    static append(options: { dataType: "markdown" | "dom"; data: string; parentID: string }) {
        return fetchSyncPost(EApi.AppendBlock, options);
    }

    /** 更新块（⚠ 多块数据会丢段，只用于单块）。 */
    static update(options: { id: string; dataType: "markdown" | "dom"; data: string }) {
        return fetchSyncPost(EApi.UpdateBlock, options);
    }

    /** 删除块。 */
    static remove(id: string) {
        return fetchSyncPost(EApi.DeleteBlock, { id });
    }

    /** 移动块（parentID 必填，previousID 可选定位）。 */
    static move(options: { id: string; parentID: string; previousID?: string }) {
        return fetchSyncPost(EApi.MoveBlock, options);
    }

    /** 取块 kramdown 源码（含 IAL；真实内容，不受 SQL 索引延迟影响）。 */
    static kramdown(id: string): Promise<IWebSocketData> {
        return fetchSyncPost(EApi.GetBlockKramdown, { id });
    }

    /** 取子块列表（标题下方块也算子块）。 */
    static children(id: string): Promise<IWebSocketData> {
        return fetchSyncPost(EApi.GetChildBlocks, { id });
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
