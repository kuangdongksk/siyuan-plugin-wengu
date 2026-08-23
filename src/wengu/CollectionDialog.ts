import {Dialog} from "siyuan";
import {svgIcon} from "./FormHtml";
import type {
    CollectionRow,
    KnowledgeRow,
    QuestionBank,
} from "./QuestionBank";
import {esc} from "./ui";

/**
 * 专题管理对话框：上半=按知识点收集（勾选知识点键 → 并集收集成新
 * 专题），下半=已有专题（点击切换、删除）。知识点索引来自题库记录
 * （kp 引用优先，降级 knowledge/chapter），迁移完成前可能为空。
 */

export interface CollectionDialogDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    /** 专题变化（新建/删除）后刷新侧栏。 */
    onChanged(): void;
    /** 创建后直接切过去开刷。 */
    onSelect(collectionId: string): void;
}

export function openCollectionDialog(deps: CollectionDialogDeps): void {
    const {t, bank} = deps;
    const dialog = new Dialog({
        title: t("collectionsTitle"),
        width: "560px",
        content: `<div class="b3-dialog__content wengu-col-dialog">
      <div class="wengu-muted">${esc(t("collectHint"))}</div>
      <div class="wengu-col-list" data-act="col-knowledge"><div class="wengu-muted">…</div></div>
      <div class="wengu-col-new">
        <input class="wengu-input" data-act="col-title" spellcheck="false"
          placeholder="${esc(t("collectTitlePlaceholder"))}">
        <button class="b3-button b3-button--outline" data-act="col-create">${esc(t("collectCreate"))}</button>
      </div>
      <div class="wengu-side-label" style="margin-top:12px">${esc(t("collectExisting"))}</div>
      <div class="wengu-col-list" data-act="col-existing"><div class="wengu-muted">…</div></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="col-close">${esc(t("cancel"))}</button>
    </div>`,
    });
    const root = dialog.element;
    const knowledgeBox = root.querySelector<HTMLElement>("[data-act='col-knowledge']");
    const existingBox = root.querySelector<HTMLElement>("[data-act='col-existing']");
    const titleInput = root.querySelector<HTMLInputElement>("[data-act='col-title']");
    const createBtn = root.querySelector<HTMLButtonElement>("[data-act='col-create']");

    const selected = new Set<string>();
    /** 默认标题 = 第一个勾选的知识点标题（可改）。 */
    let defaultTitle = "";

    const renderKnowledge = (rows: KnowledgeRow[]) => {
        if (!knowledgeBox) return;
        if (rows.length === 0) {
            knowledgeBox.innerHTML = `<div class="wengu-muted">${esc(t("collectEmptyKnowledge"))}</div>`;
            return;
        }
        knowledgeBox.innerHTML = rows
            .slice(0, 200)
            .map((r) =>
                `<label class="wengu-col-row" data-key="${esc(r.key)}">
        <input type="checkbox" data-key="${esc(r.key)}"${selected.has(r.key) ? " checked" : ""}>
        <span class="wengu-col-row-title" title="${esc(r.title)}">${esc(r.title)}</span>
        <span class="wengu-meta">${esc(String(r.count))}</span>
      </label>`
            )
            .join("");
        for (const cb of knowledgeBox.querySelectorAll<HTMLInputElement>("input[type='checkbox']")) {
            cb.addEventListener("change", () => {
                const key = cb.dataset.key ?? "";
                const row = rows.find((r) => r.key === key);
                if (cb.checked) {
                    selected.add(key);
                    if (!defaultTitle && row) {
                        defaultTitle = row.title;
                        if (titleInput && !titleInput.value) titleInput.value = row.title;
                    }
                } else {
                    selected.delete(key);
                }
            });
        }
    };

    const renderExisting = (rows: CollectionRow[]) => {
        if (!existingBox) return;
        if (rows.length === 0) {
            existingBox.innerHTML = `<div class="wengu-muted">${esc(t("collectEmptyCollections"))}</div>`;
            return;
        }
        existingBox.innerHTML = rows
            .map((c) =>
                `<div class="wengu-col-row" data-colid="${esc(c.id)}">
        <span class="wengu-col-row-title">${svgIcon("iconList")} ${esc(c.title)}</span>
        <span class="wengu-meta">${esc(String(c.count))}</span>
        <button class="b3-button b3-button--cancel wengu-col-del" data-del="${esc(c.id)}" title="${
                    esc(t("collectDelete"))
                }">×</button>
      </div>`
            )
            .join("");
        existingBox.querySelectorAll<HTMLElement>("[data-colid]").forEach((row) => {
            row.addEventListener("click", (ev) => {
                const del = (ev.target as HTMLElement).closest("[data-del]");
                if (del) return; // 删除按钮单独处理
                const id = row.dataset.colid ?? "";
                dialog.destroy();
                deps.onSelect(id);
            });
        });
        existingBox.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((btn) => {
            btn.addEventListener("click", () => {
                void bank.deleteCollection(btn.dataset.del ?? "").then((): void => void refresh());
            });
        });
    };

    const refresh = async (): Promise<void> => {
        renderKnowledge(await bank.knowledgeIndex());
        renderExisting(await bank.collectionsView());
    };

    createBtn?.addEventListener("click", () => {
        if (selected.size === 0) return;
        const title = (titleInput?.value ?? "").trim() || defaultTitle || t("collectDefaultTitle");
        void bank.collectQids([...selected]).then((qids) =>
            bank.createCollection(title, qids, "knowledge").then(() => {
                void bank.flush();
                void refresh();
                deps.onChanged();
                if (titleInput) titleInput.value = "";
            })
        );
    });
    root.querySelector("[data-act='col-close']")?.addEventListener("click", () => dialog.destroy());
    void refresh();
}
