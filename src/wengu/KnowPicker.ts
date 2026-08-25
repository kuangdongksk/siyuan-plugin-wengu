import { Dialog, fetchSyncPost } from "siyuan";
import { esc } from "./ui";

/**
 * 知识点文档勾选器（转换弹窗「选择…」）：按标题/路径搜索工作区文档，
 * 勾选回填 id 列表。SQL 恒带 LIMIT（内核无 LIMIT 静默截断 64 行的坑），
 * 关键词过滤引号/通配符防 SQL 串坏。
 */

interface PickerDoc {
    id: string;
    hpath: string;
    content: string;
}

export interface KnowPickerOpts {
    t: (key: string) => string;
    /** 已选中的文档 id（输入框现值解析）。 */
    current: string[];
    /** 确认：回传勾选的全部 id。 */
    onConfirm(ids: string[]): void;
}

/** 输入框里的原始串 → 合法块 id 列表（与转换侧同规则）。 */
export function parseKnowIds(raw: string): string[] {
    return raw
        .split(/[\s,;，；]+/)
        .map((s) => s.trim())
        .filter((s) => /^\d{14}-[a-z0-9]+$/i.test(s));
}

/** 关键词清洗：只留安全字符（防 LIKE 通配/引号破坏 SQL）。 */
function safeKeyword(kw: string): string {
    return kw.replace(/[^\w\u4e00-\u9fa5-]/g, "");
}

async function queryDocs(kw: string): Promise<PickerDoc[]> {
    const key = safeKeyword(kw);
    const like = key ? `AND (hpath LIKE '%${key}%' OR content LIKE '%${key}%') ` : "";
    const { data } = await fetchSyncPost("/api/query/sql", {
        stmt: `SELECT id, hpath, content FROM blocks WHERE type='d' ${like}ORDER BY updated DESC LIMIT 100`,
    });
    return (data as PickerDoc[] | null) ?? [];
}

export function openKnowPicker(opts: KnowPickerOpts): void {
    const { t } = opts;
    const dialog = new Dialog({
        title: t("knowPickTitle"),
        width: "480px",
        content: `<div class="b3-dialog__content wengu-dialog wengu-knowpick">
      <input class="b3-text-field wengu-knowpick-search" data-act="kp-search" type="search" spellcheck="false"
        placeholder="${esc(t("knowPickSearchPh"))}">
      <div class="wengu-knowpick-list" data-act="kp-list"><div class="wengu-muted">…</div></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="kp-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--outline" data-act="kp-ok">${esc(t("knowPickConfirm"))}</button>
    </div>`,
    });
    const root = dialog.element;
    const search = root.querySelector<HTMLInputElement>("[data-act='kp-search']");
    const list = root.querySelector<HTMLElement>("[data-act='kp-list']");

    const render = (docs: PickerDoc[]): void => {
        if (!list) return;
        if (!docs.length) {
            list.innerHTML = `<div class="wengu-muted">${esc(t("knowPickEmpty"))}</div>`;
            return;
        }
        list.innerHTML = docs
            .map(
                (d) => `<label class="wengu-knowpick-row">
  <input type="checkbox" data-kid="${d.id}"${opts.current.includes(d.id) ? " checked" : ""}>
  <span class="wengu-knowpick-path" title="${esc(d.hpath)}">${esc(d.hpath || d.content || d.id)}</span>
</label>`
            )
            .join("");
    };

    let timer = 0;
    const reload = (): void => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            void queryDocs(search?.value ?? "")
                .then(render)
                .catch(() => render([]));
        }, 300);
    };
    search?.addEventListener("input", reload);
    reload();

    root.querySelector<HTMLButtonElement>("[data-act='kp-cancel']")?.addEventListener("click", () => dialog.destroy());
    root.querySelector<HTMLButtonElement>("[data-act='kp-ok']")?.addEventListener("click", () => {
        const ids = Array.from(root.querySelectorAll<HTMLInputElement>("[data-kid]:checked")).map(
            (el) => el.dataset.kid ?? ""
        );
        opts.onConfirm(ids);
        dialog.destroy();
    });
}
