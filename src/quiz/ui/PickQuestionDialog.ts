import { Dialog } from "siyuan";
import type { QuestionBank, BankRecord } from "../../bank/data/QuestionBank";
import { esc } from "../../ui/shared";

/**
 * 题目选择弹窗（自定义块插入入口，3.8.3）：按关键词过滤题库记录、
 * 点行回调 qid。过滤与摘要都作用在 kramdown 原文上（万级题全量解析
 * 太重，parsedOf 缓存只有刷过的题）——剥 IAL/标记行取可读摘要。
 * UI 一致性：b3-text-field 输入、行=文档树 ghost 风、wengu-dialog 挂点。
 */

/** 单页行数上限（无虚拟滚动，首屏截断即可）。 */
const PAGE_ROWS = 50;

export interface PickQuestionDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    onPick(qid: string): void;
}

export function openPickQuestionDialog(deps: PickQuestionDeps): void {
    const { t } = deps;
    const dialog = new Dialog({
        title: t("qblockPickTitle"),
        width: "560px",
        content: `<div class="b3-dialog__content wengu-dialog">
      <input class="b3-text-field fn__flex-shrink" data-act="pq-filter" placeholder="${esc(
          t("qblockFilterHint")
      )}" style="width:100%">
      <div class="wengu-pq-list" data-act="pq-list"></div>
    </div>`,
    });
    const root = dialog.element;
    const listEl = root.querySelector<HTMLElement>("[data-act='pq-list']");
    const inputEl = root.querySelector<HTMLInputElement>("[data-act='pq-filter']");
    if (!listEl || !inputEl) return;
    let records: BankRecord[] = [];
    let destroyed = false;
    const close = (): void => {
        destroyed = true;
        dialog.destroy();
    };
    const renderList = (kw: string): void => {
        const needle = kw.trim().toLowerCase();
        const hits = needle
            ? records.filter((r) => r.kramdown.toLowerCase().includes(needle))
            : records.slice(0, PAGE_ROWS);
        const rows = hits.slice(0, PAGE_ROWS);
        listEl.innerHTML = rows.length
            ? rows
                  .map(
                      (r) =>
                          `<div class="b3-list-item wengu-pq-row" data-qid="${esc(r.qid)}">` +
                          `<span class="b3-list-item__text wengu-pq-stem">${esc(stemExcerpt(r))}</span>` +
                          `<span class="b3-list-item__meta">${esc(r.qid)}</span></div>`
                  )
                  .join("")
            : `<div class="wengu-muted" style="padding:12px 4px">${esc(t("qblockEmpty"))}</div>`;
    };
    // 题库装载完成前先出空列表占位，异步填充
    listEl.innerHTML = `<div class="wengu-muted" style="padding:12px 4px">${esc(t("loading"))}</div>`;
    void (async (): Promise<void> => {
        const data = await deps.bank.all();
        if (destroyed) return;
        records = Object.values(data.records);
        renderList(inputEl.value);
    })();
    inputEl.addEventListener("input", () => renderList(inputEl.value));
    listEl.addEventListener("click", (ev) => {
        const row = (ev.target as HTMLElement).closest<HTMLElement>(".wengu-pq-row");
        const qid = row?.dataset.qid;
        if (!qid) return;
        close();
        deps.onPick(qid); // 点击即关窗（弹窗去阻塞口径）
    });
    root.querySelector(".b3-dialog__close")?.addEventListener("click", close);
    inputEl.focus();
}

/** kramdown 摘要：剥 IAL 行/块标记，取前 72 字符可读文本。 */
function stemExcerpt(r: BankRecord): string {
    const text = r.kramdown
        .split("\n")
        .filter((l) => l.trim() && !l.trim().startsWith("{:"))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > 72 ? text.slice(0, 72) + "…" : text;
}
