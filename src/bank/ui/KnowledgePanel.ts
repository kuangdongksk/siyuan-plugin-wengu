import type { QuizView } from "../../quiz";
import type { QuestionBank } from "../data/QuestionBank";
import { kpRootMap } from "../data/BankReconcile";
import { knowRootsOf, removeKnowRoot, setKnowRoots } from "../data/KnowRoots";
import { openRelatedDialog } from "./RelatedDialog";
import { buildKnowledgeIndex } from "../../convert/service/KnowledgeLink";
import { openKnowPicker } from "../../ui/KnowPicker";
import { KernelQuery } from "../../siyuan/query";
import { esc, fmt } from "../../ui/shared";

/**
 * 知识文档管理工作区面板：两个来源合并展示——①题库推导（kp 块→标题
 * →根文档，collectKpRefs/kpRootMap/knowledgeIndex 三次调用组全量，
 * groupKnowByDoc 为导出纯函数）②手动导入（bank.knowRoots 登记，
 * importedKnowDocs 用 buildKnowledgeIndex 拉 h2~h4 小节结构，无题也
 * 展示；mergeKnowDocs 合并去重，单测覆盖）。转换入口仍在刷题侧栏。
 */

export interface KnowSectionView {
    id: string;
    title: string;
    count: number;
}

export interface KnowDocView {
    docId: string;
    title: string;
    sections: KnowSectionView[];
    total: number;
    /** 手动导入登记的文档（可「移除」退册；推导行无此标记）。 */
    manual?: boolean;
}

/** 按根文档聚合知识覆盖（文档按关联题数降序，小节同理）。 */
export function groupKnowByDoc(
    refs: Map<string, string>,
    roots: Map<string, string>,
    kidx: { key: string; count: number }[],
    docTitles: Map<string, string>
): KnowDocView[] {
    const countOf = new Map(kidx.map((r) => [r.key, r.count]));
    const byDoc = new Map<string, KnowSectionView[]>();
    for (const [kpId, title] of refs) {
        const docId = roots.get(kpId);
        if (!docId) continue; // 悬空引用（对账前）不计入
        const list = byDoc.get(docId) ?? [];
        list.push({ id: kpId, title, count: countOf.get(`kp:${kpId}`) ?? 1 });
        byDoc.set(docId, list);
    }
    return [...byDoc.entries()]
        .map(([docId, sections]) => ({
            docId,
            title: docTitles.get(docId) ?? docId,
            sections: sections.sort((a, b) => b.count - a.count),
            total: sections.reduce((n, s) => n + s.count, 0),
        }))
        .sort((a, b) => b.total - a.total);
}

/** 手动导入的知识文档（登记 id + 拉到的小节结构，题数为 0）。 */
export interface ImportedKnowDoc {
    docId: string;
    title: string;
    sections: { id: string; title: string }[];
}

/** 推导行 × 导入行合并：同文档节并集（题数保留推导侧）、manual 标记
 *  跟登记走、按关联题数降序（纯导入的 0 题沉底）。 */
export function mergeKnowDocs(derived: KnowDocView[], imported: ImportedKnowDoc[], manual: Set<string>): KnowDocView[] {
    const out: KnowDocView[] = derived.map((d) => ({
        ...d,
        manual: manual.has(d.docId) || undefined,
        sections: [...d.sections],
    }));
    const byId = new Map(out.map((d) => [d.docId, d]));
    for (const imp of imported) {
        const secs = imp.sections.map((s) => ({ id: s.id, title: s.title, count: 0 }));
        const hit = byId.get(imp.docId);
        if (hit) {
            const seen = new Set(hit.sections.map((s) => s.id));
            hit.sections.push(...secs.filter((s) => !seen.has(s.id)));
            continue;
        }
        const doc: KnowDocView = {
            docId: imp.docId,
            title: imp.title,
            sections: secs,
            total: 0,
            manual: manual.has(imp.docId) || undefined,
        };
        out.push(doc);
        byId.set(imp.docId, doc);
    }
    return out.sort((a, b) => b.total - a.total);
}

/** 拉一个登记根的小节结构（buildKnowledgeIndex 单根调用：章→h2~h4
 *  小节；无小节的章以文档根块为「节」）。文档已删（查无标题）不展示。 */
async function importedKnowDocs(rootIds: string[], titles: Map<string, string>): Promise<ImportedKnowDoc[]> {
    const out: ImportedKnowDoc[] = [];
    for (const rid of rootIds) {
        const title = titles.get(rid);
        if (!title) continue;
        let sections: { id: string; title: string }[] = [];
        try {
            const idx = await buildKnowledgeIndex([rid]);
            sections = idx.chapters.flatMap((c) =>
                c.sections.length > 0
                    ? c.sections.map((s) => ({ id: s.id, title: s.title }))
                    : [{ id: c.docId, title: c.title }]
            );
        } catch (_) {
            // 结构拉失败：保留登记行（空节），退册入口不丢
        }
        out.push({ docId: rid, title, sections });
    }
    return out;
}

/** 根文档标题（分块 IN，兼容大批量）。 */
async function docTitlesOf(docIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < docIds.length; i += 50) {
        const chunk = docIds
            .slice(i, i + 50)
            .map((x) => `'${x}'`)
            .join(",");
        if (!chunk) continue;
        try {
            for (const row of await KernelQuery.rows<{ id: string; content: string }>(
                `SELECT id, content FROM blocks WHERE id IN (${chunk})`
            )) {
                out.set(row.id, row.content);
            }
        } catch (_) {
            // 标题查不到用 id 兜底显示
        }
    }
    return out;
}

function docHtml(v: QuizView, d: KnowDocView): string {
    const t = v.t;
    const sections = d.sections
        .map(
            (s) =>
                `<li class="wengu-kp-sec"><span class="wengu-kp-sec-title" title="${esc(s.title)}">${esc(
                    s.title
                )}</span><span class="wengu-cp-meta">${esc(fmt(t("knowQCount"), { n: String(s.count) }))}</span></li>`
        )
        .join("");
    const tag = d.manual ? ` · ${esc(t("knowImportTag"))}` : "";
    const rm = d.manual
        ? `<button type="button" class="b3-button b3-button--text" data-krm>${esc(t("knowRemoveBtn"))}</button>`
        : "";
    return `<div class="wengu-cp-row" data-kdoc="${esc(d.docId)}">
  <span class="wengu-cp-title" title="${esc(d.title)}">${esc(d.title)}</span>
  <span class="wengu-cp-meta">${esc(fmt(t("knowSections"), { n: String(d.sections.length) }))} · ${esc(
      fmt(t("knowQCount"), { n: String(d.total) })
  )}${tag}</span>
  <span class="wengu-cp-ops">
    <button type="button" class="b3-button b3-button--text" data-krelated>${esc(t("knowRelated"))}</button>
    <button type="button" class="b3-button b3-button--text" data-kopen>${esc(t("knowOpen"))}</button>
    ${rm}
  </span>
</div>
<details class="wengu-kp-detail">
  <summary>${esc(t("knowSectionList"))}</summary>
  <ul>${sections}</ul>
</details>`;
}

/** 知识文档面板渲染入口（WorkspaceShell 调）。 */
export async function renderKnowledgePanelInto(v: QuizView, root: HTMLElement): Promise<void> {
    const t = v.t;
    const bank: QuestionBank | undefined = v.bankStore();
    if (!bank) {
        root.innerHTML = `<div class="wengu-ws-page"><div class="wengu-muted">${esc(t("knowEmpty"))}</div></div>`;
        return;
    }
    root.innerHTML = `<div class="wengu-ws-page"><div class="wengu-muted">${esc(t("loading"))}</div></div>`;
    const refs = await bank.collectKpRefs();
    const roots = await kpRootMap([...refs.keys()]);
    const registered = await knowRootsOf(bank);
    const titles = await docTitlesOf([...new Set([...roots.values(), ...registered])]);
    let docs = groupKnowByDoc(refs, roots, await bank.knowledgeIndex(), titles);
    if (registered.length > 0) {
        const imported = await importedKnowDocs(registered, titles);
        docs = mergeKnowDocs(docs, imported, new Set(registered));
    }
    const list =
        docs.length > 0
            ? docs.map((d) => docHtml(v, d)).join("")
            : `<div class="wengu-muted">${esc(t("knowEmpty"))}</div>`;
    root.innerHTML = `<div class="wengu-ws-page">
  <div class="wengu-ws-title">${esc(t("knowPanelTitle"))}
    <span class="wengu-ws-titlebtns">
      <button type="button" class="b3-button b3-button--outline" data-kimport>${esc(t("knowImportBtn"))}</button>
      <button type="button" class="b3-button b3-button--text" data-krefresh>${esc(t("quizRefresh"))}</button>
    </span>
  </div>
  <div class="wengu-muted" style="margin-bottom:8px">${esc(t("knowHint"))}</div>
  <div class="wengu-cp-list">${list}</div>
</div>`;
    bindKnowledgePanel(v, root, bank);
}

function bindKnowledgePanel(v: QuizView, root: HTMLElement, bank: QuestionBank): void {
    const rerender = (): void => void renderKnowledgePanelInto(v, root);
    root.querySelector<HTMLButtonElement>("[data-krefresh]")?.addEventListener("click", rerender);
    root.querySelector<HTMLButtonElement>("[data-kimport]")?.addEventListener("click", (ev) => {
        const btn = ev.currentTarget as HTMLButtonElement;
        void (async () => {
            const current = await knowRootsOf(bank);
            openKnowPicker({
                t: v.t,
                anchor: btn,
                current,
                single: false,
                onConfirm: (ids) => {
                    void setKnowRoots(bank, ids)
                        .then(() => bank.flush())
                        .then(rerender);
                },
            });
        })();
    });
    for (const row of root.querySelectorAll<HTMLElement>("[data-kdoc]")) {
        const docId = row.dataset.kdoc ?? "";
        row.querySelector<HTMLButtonElement>("[data-krelated]")?.addEventListener("click", () => {
            void openRelatedDialog(bank, v.t, docId);
        });
        row.querySelector<HTMLButtonElement>("[data-kopen]")?.addEventListener("click", () => {
            window.open(`siyuan://blocks/${docId}`);
        });
        const rmBtn = row.querySelector<HTMLButtonElement>("[data-krm]");
        if (!rmBtn) continue;
        let armed = false;
        let armTimer: ReturnType<typeof setTimeout> | undefined;
        rmBtn.addEventListener("click", () => {
            if (!armed) {
                armed = true;
                rmBtn.textContent = v.t("collectConfirm");
                armTimer = setTimeout(() => {
                    armed = false;
                    rmBtn.textContent = v.t("knowRemoveBtn");
                }, 3000);
                return;
            }
            clearTimeout(armTimer);
            void removeKnowRoot(bank, docId)
                .then(() => bank.flush())
                .then(rerender);
        });
    }
}
