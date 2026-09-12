import type { BankKnowNode, KnowTreesMap } from "../../../bank/data/KnowTrees";
import { stripChapterEcho } from "../../../bank/data/KnowTrees";
import { knowIndex, leafDocsOf, type KnowIndexDoc, type KnowIndexRoot } from "../../../bank/data/KnowIndex";

/**
 * 知识点反链（从 ConvertBatch 拆出的独立关注点）：转换前按用户给的知识点
 * 根文档（书架/书）建两级索引（章 → h1~h6 小节）；每批生成前先路由出本批
 * 涉及的小节，让 AI 用 K 别名标注（避免抄错长块 id）——别名映射回真实块
 * id、解析引述块尾注入 `((id "标题"))` 块引用的后处理在 KnowRef.ts
 * （20260831 拆出压 500 行红线），两级路由执行与 AI 通道在 KnowRoute.ts
 * （20260910 同款拆分）。知识点文档的反链面板即可看到相关题目，题目卡里
 * 点击可跳转（Protyle 原生渲染块引用）。
 *
 * **装载源 = know-index 快照**（Issue #39，20260912）：文档标题树一次性
 * 捕获进 saveData("know-index")（`bank/data/KnowIndex.ts`），本模块的
 * `expandKnowDocs` / `buildKnowledgeIndex` 只读快照——**装载零内核 SQL**。
 * 快照缺根时由快照店懒捕获并落库（存量登记根零用户动作）。
 *  **未接线（快照店未 init）时装载归空**——不再有现场 SQL 兜底：捕获是
 *  唯一标题查询场景（插件 onload 必先 initKnowIndex，未接线只出现在
 *  单测/异常环境，此时宁可为空也不偷偷回退打 SQL）。
 *
 * 真机数据（20260823，/MinerU 书架）：61 个实质章节 304 万字，章中位
 * 4.7 万字——正文挂载不可行，本模块只做标题级路由与引用注入。
 * 任何路由失败都降级为「该批不加链接」，不阻断转换主流程。
 */

/** 知识点小节（h1~h6 标题块）。 */
export interface KnowSection {
    /** 标题块 id（块引用目标）。 */
    id: string;
    /** 小节标题。 */
    title: string;
    /** 展示路径：文档标题路径 + 祖先标题链 + 本标题（建树后才有真层级——
     *  同文档不同 h1 下的同名小节不再撞车；建树走 nestHeads/bankNodesToTree）。 */
    path: string;
}

/** 知识点章节（一个叶子文档）。 */
export interface KnowChapter {
    /** 章节文档 id（无小节结构的章直接引用文档根块）。 */
    docId: string;
    title: string;
    /** 展示路径：书架/书/章节。 */
    path: string;
    sections: KnowSection[];
}

/** 两级索引：路由①在章集合上选，路由②在选中章的小节集合上选。 */
export interface KnowledgeIndex {
    chapters: KnowChapter[];
}

/** 知识文档树条目（知识面板展示用：一个文档一行，带自己的小节）。 */
export interface KnowDocEntry {
    docId: string;
    title: string;
    hPath: string;
    sections: { id: string; title: string }[];
    /** 小节层级树（20260831 树化）：按 h1~h6 嵌套建的真树，知识面板
     *  按文档树观感逐层折叠展示。 */
    sectionTree: KnowSectionNode[];
}

/** 小节层级树节点：一个标题块 + 嵌套子标题（h1~h6 按级别挂父）。 */
export interface KnowSectionNode {
    id: string;
    title: string;
    children: KnowSectionNode[];
}

/** AI 树（h1~h3 平铺）→ 嵌套小节树（纯函数）：与快照捕获的就近挂靠
 *  口径一致——更低级挂前方最近的更高级标题；跳级照常收编为子级。快照
 *  树本身已是嵌套形态，不走这里。 */
export function bankNodesToTree(nodes: BankKnowNode[]): KnowSectionNode[] {
    const roots: KnowSectionNode[] = [];
    const last: (KnowSectionNode | undefined)[] = [];
    for (const n of nodes) {
        const node: KnowSectionNode = { id: n.id, title: n.title, children: [] };
        last[n.level] = node;
        for (let lv = n.level + 1; lv < last.length; lv++) last[lv] = undefined;
        let parent: KnowSectionNode | undefined;
        for (let lv = n.level - 1; lv >= 1; lv--) {
            if (last[lv]) {
                parent = last[lv];
                break;
            }
        }
        (parent ? parent.children : roots).push(node);
    }
    return roots;
}

/** 该文档的小节树：内部 AI 树命中则整体替换（带章节名回声剔除），
 *  否则用快照捕获的原始标题树。 */
function treeOf(
    doc: { docId: string; title: string; children: KnowSectionNode[] },
    trees: KnowTreesMap | undefined
): KnowSectionNode[] {
    const tree = trees?.[doc.docId];
    if (!tree) return doc.children;
    return bankNodesToTree(stripChapterEcho(tree.nodes, doc.title));
}

/** 快照文档 → 展示条目（文档标题树 + 平铺小节表）。 */
function toEntry(doc: KnowIndexDoc, trees: KnowTreesMap | undefined): KnowDocEntry {
    const sectionTree = treeOf({ docId: doc.docId, title: doc.title, children: doc.children }, trees);
    const sections: { id: string; title: string }[] = [];
    const walk = (ns: KnowSectionNode[]): void => {
        for (const n of ns) {
            sections.push({ id: n.id, title: n.title });
            walk(n.children);
        }
    };
    walk(sectionTree);
    return {
        docId: doc.docId,
        title: doc.title || doc.hPath || doc.docId,
        hPath: doc.hPath,
        sections,
        sectionTree,
    };
}

/** 快照根 → 全部文档条目（面板按文档观感逐文档展示）。
 *  根查无（含快照店未接线）→ null；调用方（importedKnowDocs）统一折成
 *  空数组，再按标题兜底区分「已删跳过」与「保留空节登记行」。 */
async function entriesOfRoot(rootId: string, trees?: KnowTreesMap): Promise<KnowDocEntry[] | null> {
    const store = knowIndex();
    if (!store) return null;
    const root = await store.root(rootId).catch((): KnowIndexRoot | null => null);
    if (!root) return null;
    return root.docs.map((d) => toEntry(d, trees));
}

/**
 * 递归展开登记根的知识文档树（知识面板「导入文档」20260828 用）：根
 * 自身 + 全部后代文档（含书/章中间层）各一条，每条带自己的 h1~h6 小节
 * ——与 buildKnowledgeIndex 的分工：路由索引只要叶子章节，这里保留
 * 完整层级供面板按原生文档树观感逐文档展示（20260831 起小节再按标题
 * 级别建成 sectionTree 真树）。快照缺根时由快照店懒捕获落库（存量登记
 * 根零用户动作）；根查无/快照落库失败返回空数组（调用方按标题兜底区分
 * 「已删跳过」与「保留空节登记行」）。
 */
export async function expandKnowDocs(rootId: string, trees?: KnowTreesMap): Promise<KnowDocEntry[]> {
    return (await entriesOfRoot(rootId, trees)) ?? [];
}

/**
 * 建知识点索引。rootIds 是用户填的知识点根文档（书架那层或直接一本
 * 书/一章）：取其下所有叶子文档为章节（书名空壳层自动排除），根自身
 * 无叶子后代时（用户直接指到章节）把根当唯一章节。无小节结构的章节
 * 引用文档根块本身。小节 path = 文档标题路径 + 祖先标题链（同级同名
 * 小节靠链区分，不再是假的两段拼接）。trees=内部知识树（命中章节的
 * 小节整体替换为树节点）。装载源=know-index 快照（零内核 SQL）。
 */
export async function buildKnowledgeIndex(rootIds: string[], trees?: KnowTreesMap): Promise<KnowledgeIndex> {
    const chapters: KnowChapter[] = [];
    for (const rid of rootIds) {
        const store = knowIndex();
        if (!store) continue;
        const root = await store.root(rid).catch((): KnowIndexRoot | null => null);
        if (!root) continue;
        const entries = new Map(root.docs.map((d) => [d.docId, d]));
        for (const leaf of leafDocsOf(root)) {
            const doc = entries.get(leaf.docId);
            if (!doc) continue;
            const sectionTree = treeOf({ docId: doc.docId, title: doc.title, children: doc.children }, trees);
            chapters.push({
                docId: doc.docId,
                title: doc.title || doc.hPath || doc.docId,
                path: doc.hPath,
                sections: flattenSections(sectionTree, doc.hPath),
            });
        }
    }
    return { chapters };
}

/** 嵌套小节树 → 平铺小节表（path 前缀带入文档标题路径；纯函数）。 */
export function flattenSections(nodes: KnowSectionNode[], prefix: string): KnowSection[] {
    const out: KnowSection[] = [];
    const walk = (ns: KnowSectionNode[], pre: string): void => {
        for (const n of ns) {
            const path = `${pre}/${n.title}`;
            out.push({ id: n.id, title: n.title, path });
            walk(n.children, path);
        }
    };
    walk(nodes, prefix);
    return out;
}
