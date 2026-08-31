import { normalizeCollectionPath, type CollectionRow, type QuestionBank } from "./QuestionBank";

/**
 * 活视图专题（docs/knowledge-tree.md □3，20260831）：知识树节点行
 * 「刷此知识点」物化**确定性 id** 专题（col-kp-{块id}），BankCollection
 * 记 nodeKey/subKeys 绑定——读取（questionsOf/清单装载）时按 collectQids
 * 口径实时刷新题单，题库后续变化（转换/补题/重新挂引用）自动回流；
 * 历史/轮次/统计沿用 col:<id> 机制零新账（id 确定性=删了重建轮次仍连续）。
 * 手动跨节点专题无 subKeys 即死快照，行为不变（无数据迁移）。
 */

/** 子树节点最小形状（KnowSectionTreeView 结构匹配，避免 data→ui 反向依赖）。 */
interface SubtreeNode {
    id: string;
    children: SubtreeNode[];
}

/** 节点子树的引用键并集（先序遍历，首键=节点自身）。 */
export function subKeysOf(node: SubtreeNode): string[] {
    const out = [`kp:${node.id}`];
    const walk = (ns: SubtreeNode[]): void => {
        for (const n of ns) {
            out.push(`kp:${n.id}`);
            walk(n.children);
        }
    };
    walk(node.children);
    return out;
}

/** 活视图专题 id（确定性：同一节点跨重建同 id）。 */
export const liveColIdOf = (blockId: string): string => `col-kp-${blockId}`;

/** 物化/更新节点的活视图专题（再点=重绑子树+题单对账；标题跟随节点）。 */
export async function ensureLiveCollection(
    bank: QuestionBank,
    node: { id: string; title: string },
    subKeys: string[]
): Promise<CollectionRow> {
    const data = await bank.all();
    const id = liveColIdOf(node.id);
    let col = data.collections.find((c) => c.id === id);
    if (!col) {
        col = { id, title: "", qids: [], origin: "knowledge", createdAt: Date.now() };
        data.collections.push(col);
    }
    col.nodeKey = `kp:${node.id}`;
    col.subKeys = subKeys;
    // live 语义：标题跟着节点走（面板里的手动改名以节点下次进入为准）
    col.title = normalizeCollectionPath(node.title) || node.title;
    col.qids = await bank.collectQids(subKeys);
    bank.markDirty();
    return { id: col.id, title: col.title, count: col.qids.length };
}

/** 全部活视图专题的题单对账（清单装载前调用，侧栏/面板计数不漂）。 */
export async function refreshLiveCollections(bank: QuestionBank): Promise<void> {
    const data = await bank.all();
    let dirty = false;
    for (const col of data.collections) {
        if (!col.subKeys?.length) continue;
        const qids = await bank.collectQids(col.subKeys);
        if (qids.join("\u0000") !== col.qids.join("\u0000")) {
            col.qids = qids;
            dirty = true;
        }
    }
    if (dirty) bank.markDirty();
}
