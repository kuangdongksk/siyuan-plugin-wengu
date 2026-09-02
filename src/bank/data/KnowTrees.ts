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
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    return `${ts}-${Math.random().toString(36).slice(2, 9).padEnd(7, "0").slice(0, 7)}`;
}

/** 全部节点 → 全路径（祖先标题链/标题；level 栈式就近挂靠，与
 *  buildSectionTree 口径一致）——id 复用与展示路径共用的纯函数。 */
export function treePathsOf(nodes: BankKnowNode[]): Map<string, BankKnowNode> {
    const out = new Map<string, BankKnowNode>();
    const stack: string[] = []; // stack[i] = level<=i+1 的最近标题
    for (const n of nodes) {
        stack[n.level - 1] = n.title;
        stack.length = n.level;
        out.set(stack.filter(Boolean).join("/"), n);
    }
    return out;
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
