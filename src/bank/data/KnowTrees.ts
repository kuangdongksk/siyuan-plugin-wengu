import { mintTsId } from "../../types";
import type { QuestionBank } from "./QuestionBank";

/**
 * AI 知识树（20260903 起不落文档）：对结构单薄的章节文档做 AI 归纳的
 * 知识点大纲（h1 大类/h2 方法/h3 细分），直接存 bank（键=源章节文档
 * id）——归纳产物就是数据，不再物化成《·知识树》文档。
 *
 * **节点 id 铸内核块 id 形态**（`{14位时间戳}-{7位}`）：parseKpRefs 与
 * MdRender.BLOCK_REF 的正则只认这个形态，树节点的知识点引用要经记录
 * kramdown `((id "标题"))` 往返、题卡要渲染「查看原文」——正则本身
 * 冻结不动，内部 id 铸合法形态兼容（跳转端按 internalRootMap 降级）。
 *
 * **重新归纳时同路径节点复用旧 id**：结构未变的节点保 id → 存量
 * kpRefs/活视图 col-kp-{id}/薄弱画像 kp:{id} 不悬空（优于旧「删文档
 * 重建→对账碰运气重挂」）。函数式友元模式，同 BankSets/BankRegen。
 */

/** 知识树的一个节点（AI 大纲的一个标题）。 */
export interface BankKnowNode {
    id: string;
    title: string;
    level: 1 | 2 | 3;
    /** 标题下的补充说明（prompt 约定 ≤30 字，可整篇省略）。 */
    note?: string;
}

/** 一棵内部知识树。 */
export interface BankKnowTree {
    /** 源章节文档 id（Record 键同值）。 */
    srcId: string;
    /** 大纲 markdown 原文（人读对照/重归纳差异用）。 */
    outlineMd: string;
    nodes: BankKnowNode[];
    /** 归纳时源文档内容指纹（stale 判定：源变更→树过期，重新归纳）。 */
    srcHash: string;
    createdAt: number;
}

export type KnowTreesMap = Record<string, BankKnowTree>;

/** 节点 id（内核块 id 形态：14 位时间戳-7 位随机，秒内 36^7 防撞）。 */
export function mintKnowNodeId(): string {
    return mintTsId();
}

/** 全部节点 → 全路径（祖先标题链/标题；level 栈式就近挂靠，与
 *  buildSectionTree 口径一致）——id 复用与展示路径共用的纯函数。
 *  同父同名兄弟按文档序追加 ~2/~3 消歧：直接后写覆盖会让先出节点
 *  在「同路径复用旧 id」对齐里永远落空、每轮重归纳都被 mint 新 id
 *  （20260903 审查 P2）；新旧两侧走同一函数，消歧结果按位对齐。 */
export function treePathsOf(nodes: BankKnowNode[]): Map<string, BankKnowNode> {
    const out = new Map<string, BankKnowNode>();
    const stack: string[] = []; // stack[i] = level<=i+1 的最近标题
    for (const n of nodes) {
        stack[n.level - 1] = n.title;
        stack.length = n.level;
        let path = stack.filter(Boolean).join("/");
        if (out.has(path)) {
            let k = 2;
            while (out.has(`${path}~${k}`)) k++;
            path = `${path}~${k}`;
        }
        out.set(path, n);
    }
    return out;
}

/** 章节标题去编号归一（「1-行列式」/「四、分块矩阵」/「第2章 极限」→
 *  「行列式」/「分块矩阵」/「极限」）：章节回声判定用。中文数字形态
 *  必须带分隔符（、.．）——否则「一维随机变量」的「一」会被误剥。 */
function normChapterTitle(s: string): string {
    return s
        .trim()
        .replace(
            /^(?:[0-9]{1,3}\s*[-—–.、．]\s*|第\s*[0-9一二三四五六七八九十百零]+\s*[章节讲]\s*[:：]?\s*|[一二三四五六七八九十百]+\s*[、.．]\s*)/,
            ""
        )
        .trim();
}

/** 剔除大纲头部的章节名回声（纯函数）：AI 归纳常把章节名本身写成首个
 *  h1 包住全树（prompt 禁不住，20260908 真机两棵树均中雷）——面板就成
 *  「1-行列式/行列式/…」双层嵌套、回声标题还会混进文本关联词表。只剔
 *  头部**连续** level-1 且归一后与章节名同名的节点（生成与展示两侧、
 *  重新索引的旧树对齐都走本函数，路径/id 复用口径一致）；剔除后余下
 *  节点保持原 level（栈式挂靠对 h2 起头无 h1 天然兼容）。章节名为空
 *  或无回声原样返回。 */
export function stripChapterEcho(nodes: BankKnowNode[], chapterTitle: string): BankKnowNode[] {
    const norm = normChapterTitle(chapterTitle);
    if (!norm) return nodes;
    let i = 0;
    while (i < nodes.length && nodes[i].level === 1 && normChapterTitle(nodes[i].title) === norm) i++;
    return i === 0 ? nodes : nodes.slice(i);
}

/** 读取内部树表（缺省空对象）。 */
export async function knowTreesOf(bank: QuestionBank): Promise<KnowTreesMap> {
    const data = await bank.all();
    return data.knowTrees ?? {};
}

/** 写一棵树（覆盖语义=重新归纳；markDirty 由调用方 flush）。 */
export async function setKnowTree(bank: QuestionBank, tree: BankKnowTree): Promise<void> {
    const data = await bank.all();
    data.knowTrees ??= {};
    data.knowTrees[tree.srcId] = tree;
    bank.markDirty();
}

/** 节点 id → 所在树与节点（跳转降级/文本回落用）。 */
export function knowTreeByNode(
    trees: KnowTreesMap,
    nodeId: string
): { tree: BankKnowTree; node: BankKnowNode } | undefined {
    for (const tree of Object.values(trees)) {
        const node = tree.nodes.find((n) => n.id === nodeId);
        if (node) return { tree, node };
    }
    return undefined;
}

/** 节点的「小节正文」：自身说明行 + 子树标题拼串——sectionKramdown 查空
 *  时的内部回落材料（旧树文档小节本来也只有 ≤30 字说明行，等价降级）。 */
export function knowNodeText(trees: KnowTreesMap, nodeId: string): string {
    const hit = knowTreeByNode(trees, nodeId);
    if (!hit) return "";
    const i = hit.tree.nodes.indexOf(hit.node);
    const lines: string[] = hit.node.note ? [hit.node.note] : [];
    for (const n of hit.tree.nodes.slice(i + 1)) {
        if (n.level <= hit.node.level) break;
        lines.push(`${"#".repeat(n.level)} ${n.title}`);
    }
    return lines.join("\n\n");
}

/** 内部节点 id → 源章节文档 id 映射（并进 kpRootMap：反查/面板聚合把
 *  树节点引用归到源文档名下，对账不误判悬空）。 */
export function internalRootMap(trees: KnowTreesMap): Map<string, string> {
    const out = new Map<string, string>();
    for (const tree of Object.values(trees)) {
        for (const n of tree.nodes) out.set(n.id, tree.srcId);
    }
    return out;
}

/** 筛出「尚未索引」的文档 id（纯函数，导入后自动补索引用）：保持入参
 *  顺序、去重；trees[id] 存在即视为已有索引（不论是否 stale——过期重索
 *  是用户显式动作，自动路径不动它）。入参 docIds 通常是 expandKnowDocs
 *  展开的「登记根 + 全部后代」，已索引的一个都不许重跑。 */
export function pendingIndexIds(docIds: readonly string[], trees: KnowTreesMap): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of docIds) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (!trees[id]) out.push(id);
    }
    return out;
}
