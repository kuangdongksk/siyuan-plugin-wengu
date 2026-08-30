import { expandKnowDocs, type KnowDocEntry } from "../../convert/service/KnowledgeLink";

/**
 * 知识文档面板的视图模型层（Svelte 化前的渲染/绑定已删，20260830）：
 * 类型 + 聚合/合并纯函数 + 手动导入的递归展开装配 + hPath 树构建，
 * 供 comp/KnowledgePanelApp 与 core/KnowPanelCtl 消费，单测覆盖
 * groupKnowByDoc/mergeKnowDocs。面板语义：两个来源合并展示——①题库
 * 推导（kp 块→标题→根文档）②手动导入（bank.knowRoots 登记，
 * expandKnowDocs 递归展开：登记根+全部后代文档各一条），无题也展示。
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
    /** 手动导入涉及的文档（登记根或其后代；行上标「手动导入」）。 */
    manual?: boolean;
    /** 直接登记的根（行上显示「移除」，退册整个登记子树）。 */
    registered?: boolean;
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

/** 推导行 × 导入行合并：同文档节并集（题数保留推导侧）、manual 跟
 *  登记子树走、registered 只跟直接登记走、按关联题数降序（纯导入的
 *  0 题沉底）。 */
export function mergeKnowDocs(
    derived: KnowDocView[],
    imported: ImportedKnowDoc[],
    manual: Set<string>,
    registered: Set<string>
): KnowDocView[] {
    const flagsOf = (docId: string): Pick<KnowDocView, "manual" | "registered"> => ({
        manual: manual.has(docId) || undefined,
        registered: registered.has(docId) || undefined,
    });
    const out: KnowDocView[] = derived.map((d) => ({
        ...d,
        ...flagsOf(d.docId),
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
            ...flagsOf(imp.docId),
        };
        out.push(doc);
        byId.set(imp.docId, doc);
    }
    return out.sort((a, b) => b.total - a.total);
}

/** 手动导入的递归展开（expandKnowDocs：登记根 → 根 + 全部后代文档
 *  各一条，各带自己的 h1~h6 小节）。manualAll=登记∪展开后代（供合并
 *  标「手动导入」）；info 带回标题/hPath 供树化。根已删（查无标题）
 *  不展示；展开失败但文档还在 → 保留空节登记行，退册入口不丢。 */
export async function importedKnowDocs(
    rootIds: string[],
    titles: Map<string, string>
): Promise<{ docs: ImportedKnowDoc[]; info: Map<string, { title: string; hPath: string }>; manualAll: Set<string> }> {
    const docs: ImportedKnowDoc[] = [];
    const info = new Map<string, { title: string; hPath: string }>();
    const manualAll = new Set<string>();
    const absorb = (entries: KnowDocEntry[]): void => {
        for (const e of entries) {
            docs.push({
                docId: e.docId,
                title: e.title,
                sections: e.sections.map((s) => ({ id: s.id, title: s.title })),
            });
            info.set(e.docId, { title: e.title, hPath: e.hPath });
            manualAll.add(e.docId);
        }
    };
    for (const rid of rootIds) {
        let entries: KnowDocEntry[] = [];
        try {
            entries = await expandKnowDocs(rid);
        } catch (_) {
            // 展开失败：下面按标题兜底
        }
        if (entries.length === 0) {
            const title = titles.get(rid);
            if (!title) continue; // 根已删（查无标题）不展示
            docs.push({ docId: rid, title, sections: [] });
            manualAll.add(rid);
            continue;
        }
        absorb(entries);
    }
    return { docs, info, manualAll };
}

/* ── hPath 树化（跟思源原生文档树同款观感；算法同 PickerTree）── */

export interface KnowTreeNode {
    /** 完整路径（分支折叠 key；文档行追加 docId 后缀防撞）。 */
    path: string;
    name: string;
    doc?: KnowDocView;
    children: KnowTreeNode[];
}

/** 知识文档按 hPath 建树（同路径撞名以 docId 后缀子行挂载不丢）。 */
export function buildKnowTree(
    docs: KnowDocView[],
    info: Map<string, { title: string; hPath: string }>
): KnowTreeNode[] {
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
export const secKeyOf = (path: string): string => `${path}::sec`;
