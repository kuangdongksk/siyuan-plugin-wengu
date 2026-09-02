import type { AiSessionRecord } from "../data/AiSessions";

/**
 * 会话清单的树归并（20260902）：登记簿是平铺记录流，一次用户动作触发
 * 的多次调用共享 group id（见 data/AiSessions）——本模块把快照归并成
 * 面板左栏的渲染行：组记录（≥2 条同组）折叠成一个组行，孤儿组（成员
 * 被 LRU 淘汰到只剩 1 条）退回平铺行，无组记录原样平铺。
 * 纯函数无副作用，快照进 → 渲染行出（SessionPanelApp 的 $derived 调用）。
 */

/** 左栏渲染行：单条会话或一个动作组。 */
export type SessionRow =
    | { type: "single"; rec: AiSessionRecord }
    | {
          type: "group";
          /** 组 id（组行删除/展开态的键）。 */
          id: string;
          /** 组标题（最新成员的 groupTitle；组员同批同值）。 */
          title: string;
          /** 组内记录（头新尾旧；已过类别过滤）。 */
          recs: AiSessionRecord[];
          /** 聚合状态：有 running 记 running，否则有 error 记 error，全 done 才 done。 */
          status: AiSessionRecord["status"];
          /** 组的时间戳=最新成员的 createdAt（排序用）。 */
          createdAt: number;
      };

/** 状态聚合优先级：在途 > 失败 > 完成（组里还有在途调用就转圈）。 */
function aggStatus(recs: AiSessionRecord[]): AiSessionRecord["status"] {
    if (recs.some((r) => r.status === "running")) return "running";
    if (recs.some((r) => r.status === "error")) return "error";
    return "done";
}

/**
 * 登记簿快照 → 左栏渲染行（头新尾旧；recs 需已按 createdAt 降序——
 * store.list() 的输出序）。filter 为空串=全部；非空时单条按 kind 过滤、
 * 组内只留匹配成员（全滤空则整组隐藏——过滤是「看某类调用」的透镜，
 * 不该把组拆散也不该留空壳）。
 */
export function buildSessionRows(recs: AiSessionRecord[], filter: string): SessionRow[] {
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

    const rows: SessionRow[] = [];
    const emitted = new Set<string>();
    for (const r of recs) {
        if (r.group && grouped.has(r.group)) {
            if (emitted.has(r.group)) continue;
            emitted.add(r.group);
            const members = recs.filter((x) => x.group === r.group && (!filter || x.kind === filter));
            if (members.length === 0) continue;
            rows.push({
                type: "group",
                id: r.group,
                title: title.get(r.group) ?? r.group,
                recs: members,
                status: aggStatus(members),
                createdAt: r.createdAt,
            });
        } else if (!filter || r.kind === filter) {
            rows.push({ type: "single", rec: r });
        }
    }
    return rows;
}
