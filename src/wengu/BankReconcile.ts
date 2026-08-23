import {fetchSyncPost} from "siyuan";
import type {QuestionBank} from "./QuestionBank";
import type {WeaknessStore} from "./WeaknessStore";

/**
 * 知识引用对账（增量刷新的核心）：知识文档删除/重组后，题库 kpRefs 与
 * 薄弱画像 kp: 键会悬空。每次会话后台跑一次——分块查存在性，悬空的按
 * 标题在同库唯一命中时重挂（块 id 编辑不变，只有删除才悬空），挂不上
 * 保留原样（静态引用渲染为锚文本，无害）。检测全自动、零 AI。
 */

/** SQL 帮手（沿用 KnowledgeLink 的约束：无 LIMIT 截 64 行）。 */
async function sql(stmt: string): Promise<Map<string, string>[]> {
    const r = await fetchSyncPost("/api/query/sql", {stmt});
    if (r.code !== 0) throw new Error(r.msg || "sql failed");
    return ((r.data ?? []) as {[k: string]: unknown;}[]).map((row) => {
        const m = new Map<string, string>();
        for (const [k, v] of Object.entries(row)) m.set(k, typeof v === "string" ? v : String(v ?? ""));
        return m;
    });
}

/** kp 块 id → 所在文档 id（分块 IN；⑤反查也用）。 */
export async function kpRootMap(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50).map((x) => `'${x}'`).join(",");
        if (!chunk) continue;
        try {
            for (const row of await sql(`SELECT id, root_id FROM blocks WHERE id IN (${chunk})`)) {
                out.set(row.get("id"), row.get("root_id"));
            }
        } catch (_) {
            // 查询失败按无映射处理（反查少一半来源，不致命）
        }
    }
    return out;
}

/** 对账主流程：返回重挂数。失败静默（下次再试）。 */
export async function reconcileKnowledgeRefs(bank: QuestionBank, weakness: WeaknessStore): Promise<number> {
    try {
        const refs = await bank.collectKpRefs();
        if (refs.size === 0) return 0;
        const roots = await kpRootMap([...refs.keys()]);
        const dangling = [...refs.keys()].filter((id) => !roots.has(id));
        if (dangling.length === 0) return 0;
        let remapped = 0;
        for (const oldId of dangling) {
            const title = refs.get(oldId) ?? "";
            if (!title) continue;
            // 按标题在同库唯一命中才重挂（多命中/零命中保留悬空）
            const rows = await sql(
                `SELECT id FROM blocks WHERE type = 'h' AND content = '${title.replace(/'/g, "''")}'`,
            );
            if (rows.length !== 1) continue;
            const newId = rows[0].get("id");
            if (newId === oldId) continue;
            remapped += await bank.remapKpRef(oldId, newId, title);
            await weakness.remapKey(`kp:${oldId}`, `kp:${newId}`, title);
        }
        if (remapped > 0) await bank.flush();
        return remapped;
    } catch (_) {
        return 0;
    }
}
