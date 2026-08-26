import { fetchSyncPost } from "siyuan";
import { EApi } from "./api";

/**
 * SQL 查询（/api/query/sql）。payload 键是 `stmt`（内核实际接受的字段，
 * 全仓既有口径，勿改成 `sql`）。
 *
 * 真机约束：不带 LIMIT 静默截断 64 行、子查询不支持——批量/全量查询
 * 必须显式 LIMIT/OFFSET 分页（见 AGENTS.md「内核坑」）。
 */
export class KernelQuery {
    /** 原始行数组（失败/空结果为 `[]`，与既有散调用 `{ data }` 解构口径
     *  一致——不检 code，code!==0 时 data 为 null 归空）。泛型按调用方
     *  的行结构收窄，免散落 as 断言。 */
    static async rows<T = { [k: string]: unknown }>(stmt: string): Promise<T[]> {
        const { data } = await fetchSyncPost(EApi.QuerySql, { stmt });
        return (data ?? []) as T[];
    }

    /** 行转全字符串 Map（值统一 String()；code!==0 抛错——原
     *  KnowledgeLink/BankReconcile 本地 sql() 帮手的口径）。 */
    static async rowsMap(stmt: string): Promise<Map<string, string>[]> {
        const r = await fetchSyncPost(EApi.QuerySql, { stmt });
        if (r.code !== 0) throw new Error(r.msg || "sql failed");
        return ((r.data ?? []) as { [k: string]: unknown }[]).map((row) => {
            const m = new Map<string, string>();
            for (const [k, v] of Object.entries(row)) m.set(k, typeof v === "string" ? v : String(v ?? ""));
            return m;
        });
    }
}
