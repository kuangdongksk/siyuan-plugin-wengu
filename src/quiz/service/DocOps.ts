import { KernelDoc } from "../../siyuan/doc";
import type { QuizView } from "../index";

/**
 * 目录文档右键「删除文档」（自 QuizView.deleteDocOf 拆出，压 500 行
 * 红线）：文档本体删入回收站（可在思源找回），插件侧联动清记录/
 * 影子专题/会话历史后重载——load 的选中回退链（当前>记住>活动>
 * 第一个）自动切离被删文档。内核调用串行。
 */
export function deleteDocWithCleanup(v: QuizView, docId: string): void {
    void (async () => {
        try {
            const { code } = await KernelDoc.remove(docId);
            if (code !== 0) return;
        } catch (_) {
            return; // 删除失败不动插件数据，下次再试
        }
        await v.bankStore()?.removeDocData(docId);
        await v.bankStore()?.flush();
        await v.historyStore()?.removeDocs([docId]);
        await v.reloadView();
    })();
}
