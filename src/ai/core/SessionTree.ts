import type { AiSessionRecord } from "../data/AiSessions";
import type { TreeListNode } from "../../ui/TreeListTypes";

/**
 * 会话清单的树化（20260902）：登记簿是平铺记录流，一次用户动作触发的
 * 多次调用共享 group id（见 data/AiSessions）——本模块把快照归并成
 * 共享树组件 TreeList 的节点：组记录（≥2 条同组）成一个 branch 节点、
 * 成员挂 children；孤儿组（成员被 LRU 淘汰到只剩 1 条）退回顶层叶子，
 * 无组记录原样顶层叶子。纯函数无副作用（SessionPanelApp 的 $derived
 * 调用），行渲染走 ui/TreeList（与知识面板/侧栏树同源）。
 */

/** 组视图：trailing/main 片段按 key 查聚合信息用。 */
export interface SessionGroupView {
    id: string;
    title: string;
    /** 组内记录（头新尾旧；已过类别过滤）。 */
    recs: AiSessionRecord[];
    /** 聚合状态：有 running 记 running，否则有 error 记 error，全 done 才 done。 */
    status: AiSessionRecord["status"];
    /** 组的时间戳=最新成员的 createdAt。 */
    createdAt: number;
}

/** 树化结果：TreeList 节点 + 两个行渲染查找表（同知识面板 idiom）。 */
export interface SessionTreeData {
    nodes: TreeListNode[];
    /** 叶子 key（=记录 id）→ 记录。 */
    recByKey: Map<string, AiSessionRecord>;
    /** 组 key（=组 id）→ 组视图。 */
    groupByKey: Map<string, SessionGroupView>;
}

/** 状态聚合优先级：在途 > 失败 > 完成（组里还有在途调用就转圈）。 */
function aggStatus(recs: AiSessionRecord[]): AiSessionRecord["status"] {
    if (recs.some((r) => r.status === "running")) return "running";
    if (recs.some((r) => r.status === "error")) return "error";
    return "done";
}

/**
 * 登记簿快照 → 树节点（头新尾旧；recs 需已按 createdAt 降序——
 * store.list() 的输出序）。filter 为空串=全部；非空时叶子按 kind 过滤、
 * 组内只留匹配成员（全滤空则整组隐藏——过滤是「看某类调用」的透镜，
 * 不该把组拆散也不该留空壳）。
 */
export function buildSessionTree(recs: AiSessionRecord[], filter: string): SessionTreeData {
    const recByKey = new Map<string, AiSessionRecord>();
    const groupByKey = new Map<string, SessionGroupView>();
    const leaf = (r: AiSessionRecord): TreeListNode => {
        recByKey.set(r.id, r);
        // hideAction：删除钮走行尾 hover 才显（同旧平铺行口径）
        return { key: r.id, id: r.id, name: r.title, kind: "doc", hideAction: true, children: [] };
    };
    // 组员计数与组标题按**全量**算：过滤后只剩 1 条的组仍是组（保留
    // 「这是一次动作」的上下文）；LRU 淘汰到全量只剩 1 条才退平铺
    const count = new Map<string, number>();
    const title = new Map<string, string>();
    for (const r of recs) {
        if (!r.group) continue;
        count.set(r.group, (count.get(r.group) ?? 0) + 1);
        if (!title.has(r.group)) title.set(r.group, r.groupTitle ?? r.group);
    }
    const grouped = new Set([...count.entries()].filter(([, n]) => n >= 2).map(([id]) => id));

    const nodes: TreeListNode[] = [];
    const emitted = new Set<string>();
    for (const r of recs) {
        if (r.group && grouped.has(r.group)) {
            if (emitted.has(r.group)) continue;
            emitted.add(r.group);
            const members = recs.filter((x) => x.group === r.group && (!filter || x.kind === filter));
            if (members.length === 0) continue;
            groupByKey.set(r.group, {
                id: r.group,
                title: title.get(r.group) ?? r.group,
                recs: members,
                status: aggStatus(members),
                createdAt: r.createdAt,
            });
            nodes.push({
                key: r.group,
                name: title.get(r.group) ?? r.group,
                kind: "branch",
                hideAction: true,
                children: members.map(leaf),
            });
        } else if (!filter || r.kind === filter) {
            nodes.push(leaf(r));
        }
    }
    return { nodes, recByKey, groupByKey };
}
