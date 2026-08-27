import type { QuizView } from "../quiz";
import type { QuestionBank } from "./QuestionBank";
import { kpRootMap } from "./BankReconcile";
import { openRelatedDialog } from "./RelatedDialog";
import { KernelQuery } from "../siyuan/query";
import { esc, fmt } from "../ui/shared";

/**
 * 知识文档管理工作区面板（纯索引，转换入口仍在刷题侧栏）：从题库
 * 知识引用推导「被题目挂住的知识文档」清单——collectKpRefs（kp 块→
 * 标题）+ kpRootMap（kp 块→根文档）+ knowledgeIndex（键→题数）三次
 * 调用组全量，groupKnowByDoc 为导出纯函数（单测覆盖）。
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
    return `<div class="wengu-cp-row" data-kdoc="${esc(d.docId)}">
  <span class="wengu-cp-title" title="${esc(d.title)}">${esc(d.title)}</span>
  <span class="wengu-cp-meta">${esc(fmt(t("knowSections"), { n: String(d.sections.length) }))} · ${esc(
      fmt(t("knowQCount"), { n: String(d.total) })
  )}</span>
  <span class="wengu-cp-ops">
    <button type="button" class="b3-button b3-button--text" data-krelated>${esc(t("knowRelated"))}</button>
    <button type="button" class="b3-button b3-button--text" data-kopen>${esc(t("knowOpen"))}</button>
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
    const titles = await docTitlesOf([...new Set(roots.values())]);
    const docs = groupKnowByDoc(refs, roots, await bank.knowledgeIndex(), titles);
    const list =
        docs.length > 0
            ? docs.map((d) => docHtml(v, d)).join("")
            : `<div class="wengu-muted">${esc(t("knowEmpty"))}</div>`;
    root.innerHTML = `<div class="wengu-ws-page">
  <div class="wengu-ws-title">${esc(t("knowPanelTitle"))}
    <span class="wengu-ws-titlebtns">
      <button type="button" class="b3-button b3-button--text" data-krefresh>${esc(t("quizRefresh"))}</button>
    </span>
  </div>
  <div class="wengu-muted" style="margin-bottom:8px">${esc(t("knowHint"))}</div>
  <div class="wengu-cp-list">${list}</div>
</div>`;
    bindKnowledgePanel(v, root, bank);
}

function bindKnowledgePanel(v: QuizView, root: HTMLElement, bank: QuestionBank): void {
    root.querySelector<HTMLButtonElement>("[data-krefresh]")?.addEventListener("click", () => {
        void renderKnowledgePanelInto(v, root);
    });
    for (const row of root.querySelectorAll<HTMLElement>("[data-kdoc]")) {
        const docId = row.dataset.kdoc ?? "";
        row.querySelector<HTMLButtonElement>("[data-krelated]")?.addEventListener("click", () => {
            void openRelatedDialog(bank, v.t, docId);
        });
        row.querySelector<HTMLButtonElement>("[data-kopen]")?.addEventListener("click", () => {
            window.open(`siyuan://blocks/${docId}`);
        });
    }
}
