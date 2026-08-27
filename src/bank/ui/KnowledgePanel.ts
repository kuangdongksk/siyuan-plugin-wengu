import type { QuizView } from "../../quiz";
import type { QuestionBank } from "../data/QuestionBank";
import { kpRootMap } from "../data/BankReconcile";
import { knowRootsOf, removeKnowRoot, setKnowRoots } from "../data/KnowRoots";
import { openRelatedDialog } from "./RelatedDialog";
import { buildKnowledgeIndex } from "../../convert/service/KnowledgeLink";
import { openKnowPicker } from "../../ui/KnowPicker";
import { KernelQuery } from "../../siyuan/query";
import { svgIcon } from "../../ui/FormHtml";
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

/** 根文档标题与 hPath（分块 IN，兼容大批量；hPath 供树建分支）。 */
async function docInfoOf(docIds: string[]): Promise<Map<string, { title: string; hPath: string }>> {
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
            // 标题查不到用 id 兜底显示
        }
    }
    return out;
}

/* ── hPath 树化（20260827 用户定稿：跟思源原生文档树同款观感）──
   行壳走 PickerTree 同款 b3-list-item 紧凑单行风；交互完全对齐
   KnowPicker 的已验证模式：展开集合（openPaths）持有状态、点击后整树
   重渲染、容器级事件委托——绝不对行节点逐个 addEventListener。 */

interface KnowTreeNode {
    /** 完整路径（分支折叠 key；文档行追加 docId 后缀防撞）。 */
    path: string;
    name: string;
    doc?: KnowDocView;
    children: KnowTreeNode[];
}

/** 知识文档按 hPath 建树（算法同 PickerTree.buildPickerTree；同路径
 *  撞名以 docId 后缀子行挂载不丢）。 */
function buildKnowTree(docs: KnowDocView[], info: Map<string, { title: string; hPath: string }>): KnowTreeNode[] {
    const roots: KnowTreeNode[] = [];
    const byPath = new Map<string, KnowTreeNode>();
    for (const d of docs) {
        const segs = (info.get(d.docId)?.hPath || d.title || d.docId).split("/").filter(Boolean);
        let siblings = roots;
        let path = "";
        segs.forEach((seg, i) => {
            path = `${path}/${seg}`;
            let node = byPath.get(path);
            if (!node) {
                node = { path, name: seg, children: [] };
                byPath.set(path, node);
                siblings.push(node);
            }
            siblings = node.children;
            if (i === segs.length - 1) {
                if (node.doc) {
                    siblings.push({ path: `${path}#${d.docId}`, name: d.title || seg, doc: d, children: [] });
                } else {
                    node.doc = d;
                }
            }
        });
    }
    const sortRec = (nodes: KnowTreeNode[]): void => {
        nodes.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
        for (const n of nodes) sortRec(n.children);
    };
    sortRec(roots);
    return roots;
}

/** 文档小节容器的折叠 key（与树路径同空间但带后缀防撞）。 */
const secKeyOf = (path: string): string => `${path}::sec`;

interface KnowPaintCtx {
    t: (key: string) => string;
    openPaths: Set<string>;
}

function toggleSlot(node: KnowTreeNode, ctx: KnowPaintCtx): string {
    const expandable = node.children.length > 0 || (!!node.doc && node.doc.sections.length > 0);
    return expandable
        ? `<span class="wengu-tree-toggle wengu-tree-toggle-btn${ctx.openPaths.has(node.path) ? " wengu-tree-open" : ""}" data-tree-path="${esc(
              node.path
          )}">${svgIcon("iconRight")}</span>`
        : '<span class="wengu-tree-toggle"></span>';
}

function sectionRowHtml(s: KnowSectionView, t: (key: string) => string): string {
    return `<div class="b3-list-item b3-list-item--narrow wengu-kp-sec-row" data-ksec="${esc(s.id)}" title="${esc(
        s.title
    )}"><span class="wengu-tree-toggle"></span><span class="b3-list-item__text">${esc(
        s.title
    )}</span><span class="wengu-cp-meta">${esc(fmt(t("knowQCount"), { n: String(s.count) }))}</span></div>`;
}

function knowDocRowHtml(node: KnowTreeNode, ctx: KnowPaintCtx): string {
    const d = node.doc!;
    const t = ctx.t;
    const tag = d.manual ? ` · ${t("knowImportTag")}` : "";
    const title = `${d.title}\n${fmt(t("knowSections"), { n: String(d.sections.length) })} · ${fmt(t("knowQCount"), {
        n: String(d.total),
    })}${tag}`;
    const rm = d.manual
        ? `<button type="button" class="b3-button b3-button--text" data-krm>${esc(t("knowRemoveBtn"))}</button>`
        : "";
    const secOpen = ctx.openPaths.has(secKeyOf(node.path));
    const kids =
        d.sections.length > 0
            ? `<div class="wengu-tree-children"${secOpen ? "" : " hidden"}>${d.sections
                  .map((s) => sectionRowHtml(s, t))
                  .join("")}</div>`
            : "";
    return `<div class="b3-list-item b3-list-item--narrow b3-list-item--hide-action wengu-kp-doc" data-kdoc="${esc(
        d.docId
    )}" data-tree-path="${esc(node.path)}" title="${esc(title)}">
  ${toggleSlot(node, ctx)}
  <span class="b3-list-item__text">${esc(d.title)}</span>
  <span class="wengu-cp-meta">${esc(fmt(t("knowQCount"), { n: String(d.total) }))}</span>
  <span class="b3-list-item__action">
    <button type="button" class="b3-button b3-button--text" data-krelated>${esc(t("knowRelated"))}</button>
    <button type="button" class="b3-button b3-button--text" data-kopen>${esc(t("knowOpen"))}</button>
    ${rm}
  </span>
</div>${kids}`;
}

function knowNodeHtml(node: KnowTreeNode, ctx: KnowPaintCtx): string {
    if (node.doc) return knowDocRowHtml(node, ctx);
    const open = ctx.openPaths.has(node.path);
    return `<div class="b3-list-item b3-list-item--narrow wengu-kp-branch${open ? " wengu-tree-open" : ""}" data-tree-path="${esc(
        node.path
    )}" title="${esc(node.path)}">
  ${toggleSlot(node, ctx)}
  <span class="b3-list-item__text">${esc(node.name)}</span>
</div>
<div class="wengu-tree-children"${open ? "" : " hidden"}>${node.children.map((c) => knowNodeHtml(c, ctx)).join("")}</div>`;
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
    const rootsMap = await kpRootMap([...refs.keys()]);
    const registered = await knowRootsOf(bank);
    const info = await docInfoOf([...new Set([...rootsMap.values(), ...registered])]);
    const titles = new Map([...info].map(([k, v]) => [k, v.title]));
    let docs = groupKnowByDoc(refs, rootsMap, await bank.knowledgeIndex(), titles);
    if (registered.length > 0) {
        const imported = await importedKnowDocs(registered, titles);
        docs = mergeKnowDocs(docs, imported, new Set(registered));
    }
    // 工作区骨架可能在异步装载期间被重建（refreshSide 全量重绘），旧
    // 根节点已离场——此时本次结果作废，接管中的新调用自会渲染
    if (!root.isConnected) return;
    const treeNodes = buildKnowTree(docs, info);
    const openPaths = new Set<string>(
        // 分支默认全展开（知识树浅、文档即叶子，全可见才对齐原生观感）；
        // 小节容器不进集合=默认收起
        (function collect(nodes: KnowTreeNode[]): string[] {
            return nodes.flatMap((n) => [n.path, ...collect(n.children)]);
        })(treeNodes)
    );
    const ctx: KnowPaintCtx = { t, openPaths };
    const paintTree = (): void => {
        const listEl = root.querySelector<HTMLElement>(".wengu-cp-list");
        if (!listEl) return;
        listEl.innerHTML = docs.length
            ? `<div class="wengu-tree">${treeNodes.map((n) => knowNodeHtml(n, ctx)).join("")}</div>`
            : `<div class="wengu-muted">${esc(t("knowEmpty"))}</div>`;
    };
    root.innerHTML = `<div class="wengu-ws-page">
  <div class="wengu-ws-title">${esc(t("knowPanelTitle"))}
    <span class="wengu-ws-titlebtns">
      <button type="button" class="b3-button b3-button--outline" data-kimport>${esc(t("knowImportBtn"))}</button>
      <button type="button" class="b3-button b3-button--text" data-krefresh>${esc(t("quizRefresh"))}</button>
    </span>
  </div>
  <div class="wengu-muted" style="margin-bottom:8px">${esc(t("knowHint"))}</div>
  <div class="wengu-cp-list"></div>
</div>`;
    paintTree();
    // 每次装载都重建壳节点，委托监听挂在新列表上=生命周期天然对齐，不叠加
    bindKnowledgePanel(v, root, bank, ctx, paintTree);
}

/** 「移除」二次确认状态（按文档 id 记忆武装态，3s 未点回退）。 */
const rmArmed = new Map<string, { armed: boolean; timer?: ReturnType<typeof setTimeout> }>();

function bindKnowledgePanel(
    v: QuizView,
    root: HTMLElement,
    bank: QuestionBank,
    ctx: KnowPaintCtx,
    paintTree: () => void
): void {
    const rerender = (): void => void renderKnowledgePanelInto(v, root);
    // 标题行动作（每面板只有一对按钮，直接绑新节点）
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
    // 列表容器级委托（同 KnowPicker）：折叠/小节/开文档/行内操作一次接管
    root.querySelector<HTMLElement>(".wengu-cp-list")?.addEventListener("click", (ev) => {
        const el = ev.target as HTMLElement;
        const opBtn = el.closest<HTMLElement>("[data-krelated],[data-kopen],[data-krm]");
        if (opBtn) {
            ev.stopPropagation();
            const docId = opBtn.dataset.krelated ?? opBtn.dataset.kopen ?? opBtn.dataset.krm ?? "";
            if (!docId) return;
            if (opBtn.dataset.krelated !== undefined) void openRelatedDialog(bank, v.t, docId);
            else if (opBtn.dataset.kopen !== undefined) window.open(`siyuan://blocks/${docId}`);
            else {
                // 二次确认：先点变文案，3s 内再点执行退册
                const st = rmArmed.get(docId) ?? { armed: false };
                if (!st.armed) {
                    rmArmed.set(docId, { armed: true, timer: undefined });
                    opBtn.textContent = v.t("collectConfirm");
                    st.timer = setTimeout(() => {
                        rmArmed.set(docId, { armed: false });
                        opBtn.textContent = v.t("knowRemoveBtn");
                    }, 3000);
                    return;
                }
                clearTimeout(st.timer);
                rmArmed.delete(docId);
                void removeKnowRoot(bank, docId)
                    .then(() => bank.flush())
                    .then(rerender);
            }
            return;
        }
        // 知识点子行：跳转块
        const sec = el.closest<HTMLElement>("[data-ksec]");
        if (sec) {
            window.open(`siyuan://blocks/${sec.dataset.ksec}`);
            return;
        }
        // 折叠切换：箭头点文档小节层；分支行整行可折（原生手感）。
        // 文档行本体不算折叠命中（点它是开文档）
        const tg = el.closest<HTMLElement>(".wengu-tree-toggle-btn");
        const branchRow = el.closest<HTMLElement>(".wengu-kp-branch");
        const hit = tg ?? branchRow;
        if (hit) {
            const p = hit.dataset.treePath ?? "";
            if (!p) return;
            if (ctx.openPaths.has(p)) ctx.openPaths.delete(p);
            else ctx.openPaths.add(p);
            paintTree();
            return;
        }
        const docRow = el.closest<HTMLElement>("[data-kdoc]");
        if (docRow && !el.closest("button")) window.open(`siyuan://blocks/${docRow.dataset.kdoc}`);
    });
}
