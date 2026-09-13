import { normalizeCollectionPath, type CollectionRow, type QuestionBank } from "./QuestionBank";
import { relatedQidsOf } from "./RelatedQids";
import { kpRootMap } from "./BankReconcile";

/**
 * 活视图专题（docs/knowledge-tree.md □3，20260831）：知识树节点行
 * 「刷此知识点」物化**确定性 id** 专题（col-kp-{块id}），BankCollection
 * 记 nodeKey/subKeys 绑定——读取（questionsOf/清单装载）时按 collectQids
 * 口径实时刷新题单，题库后续变化（转换/补题/重新挂引用）自动回流；
 * 历史/轮次/统计沿用 col:<id> 机制零新账（id 确定性=删了重建轮次仍连续）。
 * 20260912（Issue #44）加**第二种活视图绑定**：`related:{docId}`（相关题
 * 弹窗的预览/开刷落点，id `col-related-{docId}`）——题单收集**与弹窗
 * 列表同源**（RelatedQids.relatedRecordsOf，含「sourceDocId 命中但无
 * kpRefs」的题），**不得套用 kp 键收集**（collectQids 口径不同，题单会与
 * 列表对不上）；只有 related 绑定走这条腿，kp 活视图行为逐字节不变。
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

/* ── related 活视图（相关题弹窗 × 刷题联动，Issue #44） ── */

/** related 活视图的 nodeKey（存来源文档 id，专题标题可由此反查）。 */
export const relatedNodeKey = (docId: string): string => `related:${docId}`;

/** related 活视图专题 id（确定性：重开弹窗点动作即重建，轮次历史连续）。 */
export const relatedColIdOf = (docId: string): string => `col-related-${docId}`;

/** nodeKey → 来源文档 id（非 related 绑定返回空串）。 */
export function relatedDocIdOf(nodeKey: string | undefined): string {
    return nodeKey?.startsWith("related:") ? nodeKey.slice("related:".length) : "";
}

/** 从 nodeKey 反解来源文档 id（专题行/删除后重建都靠它，id 里也含 docId）。 */
export function relatedDocIdFromColId(colId: string): string {
    return colId.startsWith("col-related-") ? colId.slice("col-related-".length) : "";
}

/** 相关题专题的一条题单（读取时重算，题库变化自动回流）。 */
async function relatedQids(bank: QuestionBank, docId: string): Promise<string[]> {
    const data = await bank.all();
    // kpRefs 归位：kp 块 id → 所在文档 id（与弹窗同一条映射链）
    const refs = new Set<string>();
    for (const r of Object.values(data.records)) for (const k of r.kpRefs) refs.add(k.id);
    const roots = await kpRootMap(bank, [...refs]);
    return relatedQidsOf(Object.values(data.records), docId, roots);
}

/** 物化/更新 related 活视图专题（再点=对账题单）。
 *  标题「跟随来源」只认**传入的标题**：同一来源文档每次进入都带标题
 *  （面板行/右键都查得到），而**用户在专题管理里改的名不被覆盖**——
 *  传入标题为空（文档已删/查不到）时保持现有标题，至少不退化成空。 */
export async function ensureRelatedCollection(
    bank: QuestionBank,
    docId: string,
    docTitle: string
): Promise<CollectionRow> {
    const data = await bank.all();
    const id = relatedColIdOf(docId);
    let col = data.collections.find((c) => c.id === id);
    if (!col) {
        col = { id, title: "", qids: [], origin: "knowledge", createdAt: Date.now() };
        data.collections.push(col);
    }
    col.nodeKey = relatedNodeKey(docId);
    col.subKeys = undefined; // related 腿自带收集口径，不用 kp 键
    const title = relatedColTitle(docTitle, docId);
    if (title) col.title = title;
    col.qids = await relatedQids(bank, docId);
    bank.markDirty();
    return { id: col.id, title: col.title, count: col.qids.length };
}

/** 专题标题（来源写清楚：「相关题·{来源文档标题}」；空标题=保持现值，
 *  由调用方决定（见 ensureRelatedCollection 注释），不凭空造名）。 */
export function relatedColTitle(docTitle: string, docId: string): string {
    const name = docTitle.trim();
    if (!name) return "";
    return normalizeCollectionPath(`相关题·${name}`) || `相关题·${name} ${docId.slice(-6)}`;
}

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
        const relDoc = relatedDocIdOf(col.nodeKey);
        if (relDoc) {
            const qids = await relatedQids(bank, relDoc);
            if (qids.join("\u0000") !== col.qids.join("\u0000")) {
                col.qids = qids;
                dirty = true;
            }
            continue;
        }
        if (!col.subKeys?.length) continue;
        const qids = await bank.collectQids(col.subKeys);
        if (qids.join("\u0000") !== col.qids.join("\u0000")) {
            col.qids = qids;
            dirty = true;
        }
    }
    if (dirty) bank.markDirty();
}
