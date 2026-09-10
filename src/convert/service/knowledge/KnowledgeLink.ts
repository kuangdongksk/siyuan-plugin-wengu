import { KernelQuery } from "../../../siyuan/query";
import { KernelBlock } from "../../../siyuan/block";
import { stripChapterEcho } from "../../../bank/data/KnowTrees";
import type { KnowTreesMap } from "../../../bank/data/KnowTrees";

/**
 * 知识点反链（从 ConvertBatch 拆出的独立关注点）：
 * 转换前按用户给的知识点根文档（书架/书）建两级索引（章 → h1~h6 小节，
 * 全部走 SQL 拿块 id，不导出正文）；每批生成前先路由出本批涉及的小节，
 * 让 AI 用 K 别名标注（避免抄错长块 id）——别名映射回真实块 id、解析
 * 引述块尾注入 `((id "标题"))` 块引用的后处理在 KnowRef.ts（20260831
 * 拆出压 500 行红线），两级路由执行与 AI 通道在 KnowRoute.ts（20260910
 * 同款拆分）。知识点文档的反链面板即可看到相关题目，题目卡里点击可跳转
 * （Protyle 原生渲染块引用）。
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
    /** 展示路径：文档标题路径 + 祖先标题链 + 本标题（buildSectionTree 建树后
     *  才有真层级——同文档不同 h1 下的同名小节不再撞车）。 */
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

/** SQL 查询（工厂 rowsMap：code!==0 抛错由调用方降级）。 */
const sql = KernelQuery.rowsMap;

/** rowsMap 行（KernelQuery 工厂的 Map 行别名）。 */
type KnowRow = Map<string, string>;

/** 根块行 + 其全部后代文档行（同笔记本递归 path LIKE，含书/章中间层）。
 *  根非文档/已删/SQL 失败返回 null，调用方各自降级。 */
async function knowDocRows(rootId: string): Promise<{ root: KnowRow; rows: KnowRow[] } | null> {
    let root: KnowRow | undefined;
    try {
        root = (
            await sql(`SELECT id, box, path, content, hpath FROM blocks WHERE id = '${rootId}' AND type = 'd' LIMIT 1`)
        )[0];
    } catch (_) {
        return null;
    }
    if (!root?.get("box")) return null;
    const dir = root.get("path").replace(/\.sy$/, "");
    const rows = await KernelQuery.rowsMapAll(
        `SELECT id, path, content, hpath FROM blocks WHERE type = 'd' AND box = '${root.get(
            "box"
        )}' AND path LIKE '${dir}/%.sy' ORDER BY hpath`
    );
    return { root, rows };
}

/** 批量拉文档的 h1~h6 标题块（按 root_id 分组；subtype 供建树与祖先链
 *  ——20260831 前只取 content，层级信息在 SQL 阶段就丢了）。SQL 的
 *  ORDER BY sort 在导入语料上是任意序（块 sort 全退化），逐文档以
 *  KernelBlock.docOrder 回排成真文档序——buildSectionTree 的就近挂靠
 *  依赖标题按序到达，乱序会让子标题先于父标题沉到顶层（20260907
 *  真机：23/23 章节中雷，层级塌平）。 */
async function headingsByRoot(
    docIds: string[]
): Promise<Map<string, { id: string; content: string; level: number }[]>> {
    const byRoot = new Map<string, { id: string; content: string; level: number }[]>();
    if (docIds.length === 0) return byRoot;
    const ids = docIds.map((x) => `'${x}'`).join(",");
    for (const h of await KernelQuery.rowsMapAll(
        `SELECT root_id, id, content, subtype FROM blocks WHERE type = 'h' AND subtype IN ('h1','h2','h3','h4','h5','h6') AND root_id IN (${ids}) ORDER BY root_id, sort`
    )) {
        const k = h.get("root_id");
        const arr = byRoot.get(k) ?? [];
        arr.push({
            id: h.get("id"),
            content: h.get("content"),
            level: Number(h.get("subtype")?.replace("h", "")) || 1,
        });
        byRoot.set(k, arr);
    }
    for (const [docId, arr] of byRoot) {
        const order = await KernelBlock.docOrder(docId);
        const pos = (id: string): number => order.get(id) ?? Number.MAX_SAFE_INTEGER;
        arr.sort((a, b) => pos(a.id) - pos(b.id));
    }
    return byRoot;
}

/** 内部知识树命中文档 → 伪标题行（id=节点 id、level=节点层级）。树是
 *  对单薄章节的更好归纳，命中即**整体替换**该文档的 SQL 小节；未命中
 *  返回 undefined 走原路径。20260903 起树不落文档，面板/路由/词表经
 *  本并流点统一消费。chapterTitle 供头部章节名回声剔除（存量树与
 *  prompt 禁不住的新生成 alike——「1-行列式/行列式/…」双层嵌套），
 *  缺省不剔。 */
function treeHeads(
    trees: KnowTreesMap | undefined,
    docId: string,
    chapterTitle?: string
): { id: string; title: string; level: number }[] | undefined {
    const tree = trees?.[docId];
    if (!tree) return undefined;
    return stripChapterEcho(tree.nodes, chapterTitle ?? "").map((n) => ({
        id: n.id,
        title: n.title,
        level: n.level,
    }));
}

/**
 * 建知识点索引。rootIds 是用户填的知识点根文档（书架那层或直接一本
 * 书/一章）：取其下所有叶子文档为章节（书名空壳层自动排除），根自身
 * 无叶子后代时（用户直接指到章节）把根当唯一章节。无小节结构的章节
 * 引用文档根块本身。小节 path = 文档标题路径 + 祖先标题链（同级同名
 * 小节靠链区分，不再是假的两段拼接）。trees=内部知识树（命中章节的
 * 小节整体替换为树节点）。
 */
export async function buildKnowledgeIndex(rootIds: string[], trees?: KnowTreesMap): Promise<KnowledgeIndex> {
    const chapters: KnowChapter[] = [];
    for (const rid of rootIds) {
        const hit = await knowDocRows(rid);
        if (!hit) continue;
        // 叶子 = 没有任何文档以它为父目录（书名空壳层自动出局）
        const parentDirs = new Set(
            hit.rows.map((r) => {
                const p = r.get("path");
                return p.slice(0, p.lastIndexOf("/"));
            })
        );
        let leaves = hit.rows.filter((r) => !parentDirs.has(r.get("path").replace(/\.sy$/, "")));
        if (leaves.length === 0) leaves = [hit.root];
        const byRoot = await headingsByRoot(leaves.map((r) => r.get("id")));
        for (const leaf of leaves) {
            const hp = leaf.get("hpath");
            const secs: KnowSection[] = [];
            const walk = (nodes: KnowSectionNode[], prefix: string): void => {
                for (const n of nodes) {
                    const path = `${prefix}/${n.title}`;
                    secs.push({ id: n.id, title: n.title, path });
                    walk(n.children, path);
                }
            };
            const heads =
                treeHeads(trees, leaf.get("id"), leaf.get("content") ?? "") ??
                (byRoot.get(leaf.get("id")) ?? []).map((h) => ({ id: h.id, title: h.content, level: h.level }));
            walk(buildSectionTree(heads), hp);
            chapters.push({
                docId: leaf.get("id"),
                title: leaf.get("content") || hp,
                path: hp,
                sections: secs,
            });
        }
    }
    return { chapters };
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

/**
 * 文档内标题平铺列表 → 层级树（纯函数）。思源标题块只存 subtype
 * （h1~h6）不存父子关系，嵌套按「更低级（数字更大）挂到前方最近的
 * 更高级标题下」的规则派生；跳级（h1 直下 h3）照常收编为子级——
 * 即与大纲/文档树的「就近挂靠」语义一致。
 */
export function buildSectionTree(heads: { id: string; title: string; level: number }[]): KnowSectionNode[] {
    const roots: KnowSectionNode[] = [];
    /** 各级别最近一个节点（栈式：新同级顶替、更深级清空）。 */
    const last: (KnowSectionNode | undefined)[] = [];
    for (const h of heads) {
        const node: KnowSectionNode = { id: h.id, title: h.title, children: [] };
        last[h.level] = node;
        for (let lv = h.level + 1; lv < last.length; lv++) last[lv] = undefined;
        // 父级 = 比本标题高级（数字小）的最近一个；没有则挂根层
        let parent: KnowSectionNode | undefined;
        for (let lv = h.level - 1; lv >= 1; lv--) {
            if (last[lv]) {
                parent = last[lv];
                break;
            }
        }
        (parent ? parent.children : roots).push(node);
    }
    return roots;
}

/**
 * 递归展开登记根的知识文档树（知识面板「导入文档」20260828 用）：根
 * 自身 + 全部后代文档（含书/章中间层）各一条，每条带自己的 h1~h6 小节
 * ——与 buildKnowledgeIndex 的分工：路由索引只要叶子章节，这里保留
 * 完整层级供面板按原生文档树观感逐文档展示（20260831 起小节再按标题
 * 级别建成 sectionTree 真树）。根查无/SQL 失败返回空数组（调用方按
 * 标题兜底区分「已删跳过」与「保留空节登记行」）。
 */
export async function expandKnowDocs(rootId: string, trees?: KnowTreesMap): Promise<KnowDocEntry[]> {
    const hit = await knowDocRows(rootId);
    if (!hit) return [];
    const docs = [hit.root, ...hit.rows];
    const byRoot = await headingsByRoot(docs.map((d) => d.get("id")));
    return docs.map((d) => {
        const heads =
            treeHeads(trees, d.get("id"), d.get("content") ?? "") ??
            (byRoot.get(d.get("id")) ?? []).map((h) => ({ id: h.id, title: h.content, level: h.level }));
        return {
            docId: d.get("id"),
            title: d.get("content") || d.get("hpath") || d.get("id"),
            hPath: d.get("hpath") ?? "",
            sections: heads.map((h) => ({ id: h.id, title: h.title })),
            sectionTree: buildSectionTree(heads),
        };
    });
}
