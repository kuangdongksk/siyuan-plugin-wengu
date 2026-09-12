import { errText } from "../../ui/shared";
import { notifyError } from "../../ui/Notify";
import { knowIndex } from "../data/KnowIndex";
import { knowJumpTarget, knowTreeByNode, knowTreesOf } from "../data/KnowTrees";
import type { QuestionBank } from "../data/QuestionBank";
import type { KnowSectionNode } from "../../convert/service/knowledge/KnowledgeLink";

/**
 * 知识索引快照的**根级归口**（Issue #39，自 KnowPanelCtl 拆出压 500 行
 * 红线）：登记根 → 子树小节 id 集，用于「快照过期」判定；以及「重扫」
 * 动作（重跑标题树捕获并落库）。视图层的徽标/按钮状态仍由控制器与
 * UI 段持有，本模块只管数据侧的归口计算与执行。
 *
 * 过期口径：快照是**标题树**，真过期只发生在标题增删改时；但内容变更
 * 与标题变更同属 ws-main 的 update 信号，无从区分，故按「该根子树内有
 * 任何小节内容变更」宁多报不漏报——重扫廉价（只读内核 + 落盘，零 AI）。
 */

/** 登记根 → 子树小节 id 集（装载时按展开结果填一次）。 */
export type RootSections = Map<string, Set<string>>;

/** 收集一条文档树的全部节点 id（纯函数）。 */
export function collectNodeIds(nodes: KnowSectionNode[], into: Set<string>): Set<string> {
    for (const n of nodes) {
        into.add(n.id);
        collectNodeIds(n.children, into);
    }
    return into;
}

/** 按「根 → 子树文档 id」与「文档 → 小节树」两个映射归口出
 *  根 → 子树小节 id 集（纯函数，零内核读）。 */
export function sectionsByRoot(
    rootDocIds: Map<string, Set<string>> | undefined,
    docTrees: { docId: string; sectionTree: KnowSectionNode[] }[]
): RootSections {
    const byDoc = new Map(docTrees.map((d) => [d.docId, d.sectionTree]));
    const out: RootSections = new Map();
    for (const [rid, docIds] of rootDocIds ?? []) {
        const secs = new Set<string>();
        for (const id of docIds) {
            const tree = byDoc.get(id);
            if (tree) collectNodeIds(tree, secs);
        }
        out.set(rid, secs);
    }
    return out;
}

/** 过期根（纯函数）：登记的**根**子树里有小节内容变更即算过期；
 *  未登记根不报。 */
export function staleRootsOf(roots: string[], secsByRoot: RootSections, staleSecs: Set<string>): Set<string> {
    const out = new Set<string>();
    if (staleSecs.size === 0) return out;
    for (const rid of roots) {
        const secs = secsByRoot.get(rid);
        if (!secs) continue;
        for (const secId of staleSecs) {
            if (secs.has(secId)) {
                out.add(rid);
                break;
            }
        }
    }
    return out;
}

/** 「重扫」执行（同一根单飞）：重跑标题树捕获并落库；失败只通知不上抛
 *  （调用方的重载链不能被它打断）。零 AI、只读内核。 */
export function runRescan(rootId: string, running: Set<string>, after: () => Promise<void>): void {
    if (running.has(rootId)) return;
    const store = knowIndex();
    if (!store) return;
    running.add(rootId);
    void (async (): Promise<void> => {
        try {
            await store.rescan(rootId);
        } catch (e) {
            notifyError({ key: "notifyKnowRescanFail", vars: { msg: errText(e) } });
        } finally {
            running.delete(rootId);
        }
        await after();
    })();
}

/** 知识节点跳源（Issue #39）：AI 树节点有源标题块指针则**块级直跳**
 *  （真块 id），无则降级跳到源章节文档；非树节点（真块引用）原样直跳。
 *  查库失败也直跳（不该吞掉跳转），只记日志。 */
export async function jumpToKnowNode(id: string, bank: QuestionBank | undefined): Promise<void> {
    try {
        if (bank) {
            const trees = await knowTreesOf(bank);
            if (knowTreeByNode(trees, id)) {
                window.open(`siyuan://blocks/${knowJumpTarget(trees, id)}`);
                return;
            }
        }
    } catch (e) {
        console.warn("[wengu] 知识树节点定位失败，降级直跳", e);
    }
    window.open(`siyuan://blocks/${id}`);
}

/** 退册时清掉该根的快照（纯派生、重登记即懒捕获重建）：留着只会让
 *  「已退册根的旧树」被 findDoc 之类误认领。失败静默（清账非关键路径）。 */
export async function dropSnapshot(rootId: string): Promise<void> {
    await knowIndex()
        ?.drop(rootId)
        .catch((): void => undefined);
}
