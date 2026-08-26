import { Dialog } from "siyuan";
import { svgIcon } from "../ui/FormHtml";
import { kpRootMap } from "./BankReconcile";
import type { QuestionBank } from "./QuestionBank";
import { esc, fmt } from "../ui/shared";

/**
 * 知识文档右键「温故：查相关题目」（⑤）：思源侧入口——插件数据与思源
 * 数据不互通，但映射在插件里，反查是本地查询。点击题目跳到其源块
 * （文档模式的习题文档块，siyuan:// 直开）。
 */
export async function openRelatedDialog(bank: QuestionBank, t: (k: string) => string, blockId: string): Promise<void> {
    // 点击的可能是文档/标题/任意块：定位其根文档
    const { fetchSyncPost } = await import("siyuan");
    let docId = blockId;
    try {
        const r = await fetchSyncPost("/api/query/sql", {
            stmt: `SELECT root_id FROM blocks WHERE id = '${blockId}' LIMIT 1`,
        });
        const root = (r.data as { root_id?: string }[] | null)?.[0]?.root_id;
        if (root) docId = root;
    } catch (_) {
        // 查不到就按原 id 试
    }
    const refs = await bank.collectKpRefs();
    const roots = await kpRootMap([...refs.keys()]);
    const rows = await bank.questionsRelatedToDoc(docId, roots);
    const items =
        rows.length > 0
            ? rows
                  .map(
                      (r) =>
                          `<div class="wengu-col-row" data-jump="${esc(r.qid)}" title="${esc(r.stem)}">
        <span class="wengu-col-row-title">${esc(r.stem || r.qid)}</span>
        <span class="wengu-meta">${esc(
            fmt(t("relatedStats"), { a: String(r.attempts), w: String(r.wrongCount) })
        )}</span>
      </div>`
                  )
                  .join("")
            : `<div class="wengu-muted">${esc(t("relatedEmpty"))}</div>`;
    const dialog = new Dialog({
        title: t("relatedTitle"),
        width: "560px",
        content: `<div class="b3-dialog__content wengu-dialog">
      <div class="wengu-muted">${svgIcon("iconSearch")} ${esc(t("relatedHint"))}</div>
      <div class="wengu-col-list" style="margin-top:8px">${items}</div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="related-close">${esc(t("cancel"))}</button>
    </div>`,
    });
    const root = dialog.element;
    root.querySelector("[data-act='related-close']")?.addEventListener("click", () => dialog.destroy());
    for (const row of root.querySelectorAll<HTMLElement>("[data-jump]")) {
        row.style.cursor = "pointer";
        row.addEventListener("click", () => {
            window.open(`siyuan://blocks/${row.dataset.jump}`);
        });
    }
}
