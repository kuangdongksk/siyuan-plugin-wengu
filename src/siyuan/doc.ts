import { fetchSyncPost, type IWebSocketData } from "siyuan";
import { EApi } from "./api";
import { KernelQuery } from "./query";

/**
 * 文档级内核操作（迁自 sy-lively 的 SY文档，取温故实际用到的面）。
 * 路径定位必须用 hPath（标题路径）而非 .sy 文件路径——内核按标题匹配
 * createDocWithMd 的路径段（真机踩坑记录见 AGENTS.md）。
 */
export class KernelDoc {
    /** 按路径（/父/标题）整体建文档并解析 markdown（IAL 一次全落）。 */
    static createByMd(notebook: string, path: string, markdown: string): Promise<IWebSocketData> {
        return fetchSyncPost(EApi.CreateDocWithMd, { notebook, path, markdown });
    }

    /** 删文档（进回收站）。 */
    static remove(id: string) {
        return fetchSyncPost(EApi.RemoveDocById, { id });
    }

    /** 改文档标题。 */
    static rename(notebook: string, path: string, title: string) {
        return fetchSyncPost(EApi.RenameDoc, { notebook, path, title });
    }

    /** 按 id 移动文档到新父文档下。 */
    static moveById(fromDocId: string, toDocId: string, toNotebook: string) {
        return fetchSyncPost(EApi.MoveDocsById, { toNotebook, fromPaths: [fromDocId], toPath: toDocId });
    }

    /** 取人类可读路径（hPath）。 */
    static hPath(id: string): Promise<IWebSocketData> {
        return fetchSyncPost(EApi.GetHPathById, { id });
    }

    /** 按路径列子文档。 */
    static listByPath(notebook: string, path: string) {
        return fetchSyncPost(EApi.ListDocsByPath, { notebook, path });
    }

    /** 批量取文档标题与 hPath（分块 IN 50 兼容大批量；hPath 供树建分支；
     *  查不到的 id 不入表，调用方用 id 兜底显示）。 */
    static async infoOf(docIds: string[]): Promise<Map<string, { title: string; hPath: string }>> {
        const out = new Map<string, { title: string; hPath: string }>();
        for (let i = 0; i < docIds.length; i += 50) {
            const chunk = docIds
                .slice(i, i + 50)
                .map((x) => `'${x}'`)
                .join(",");
            if (!chunk) continue;
            try {
                for (const row of await KernelQuery.rows<{ id: string; content: string; hpath: string }>(
                    `SELECT id, content, hpath FROM blocks WHERE id IN (${chunk})`
                )) {
                    out.set(row.id, { title: row.content, hPath: row.hpath ?? "" });
                }
            } catch (_) {
                // 单块查询失败跳过：缺的用 id 兜底
            }
        }
        return out;
    }
}
