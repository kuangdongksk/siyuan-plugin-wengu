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

    /** 全量分页执行（自动追加 LIMIT/OFFSET 翻页到取完）：无 LIMIT 截
     *  64 行的坑见类注释，全量查询一律走这里；stmt 不要自带 LIMIT/
     *  OFFSET（尾部分号会被剥掉）。 */
    static async rowsAll<T = { [k: string]: unknown }>(stmt: string, pageSize = 512): Promise<T[]> {
        const out: T[] = [];
        for (let off = 0; ; off += pageSize) {
            const rows = await KernelQuery.rows<T>(`${stmt.replace(/;\s*$/, "")} LIMIT ${pageSize} OFFSET ${off}`);
            out.push(...rows);
            if (rows.length < pageSize) return out;
        }
    }

    /** rowsMap 的全量分页版（语义同 rowsAll，code!==0 抛错）。 */
    static async rowsMapAll(stmt: string, pageSize = 512): Promise<Map<string, string>[]> {
        const out: Map<string, string>[] = [];
        for (let off = 0; ; off += pageSize) {
            const rows = await KernelQuery.rowsMap(`${stmt.replace(/;\s*$/, "")} LIMIT ${pageSize} OFFSET ${off}`);
            out.push(...rows);
            if (rows.length < pageSize) return out;
        }
    }
}
