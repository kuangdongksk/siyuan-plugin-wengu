import {fetchSyncPost} from "siyuan";
import {
    Attr,
    GROUP_PREV,
    MATERIAL_FLAG,
} from "./attrs";
import type {WenguMaterial} from "./types";

/**
 * 材料组服务（E0，docs/english-question-review.md M1）：阅读/完形等
 * 共享原文以材料超级块（custom-plugin-wengu-material="1"）与小题
 * 同存一篇习题文档，小题用 group 属性引用材料块 id。
 *
 * AI 转换时写不出真实块 id（由内核 Lute 建块时分配），所以转换
 * 输出 group="prev" 占位（材料=文中紧邻其前的材料块）；装载时
 * resolveGroupPlaceholders 按文档序解析并回写真实 id。
 *
 * 请求一律串行（fetchSyncPost 并发会互相吞响应，真机踩坑）。
 */

/** 解析 group="prev" 占位为真实材料块 id（按文档序：材料在前、
 *  小题紧随）。返回被改写题块 → 材料块 id 的映射，供内存视图同步。 */
export async function resolveGroupPlaceholders(docId: string): Promise<Map<string, string>> {
    const {data} = await fetchSyncPost("/api/query/sql", {
        stmt: `
            SELECT a.block_id AS id, a.name AS name, a.value AS value
            FROM attributes AS a JOIN blocks AS b ON b.id = a.block_id
            WHERE b.root_id = '${docId}'
              AND (a.name = '${Attr.material}' OR a.name = '${Attr.group}')
            ORDER BY b.sort, b.created, a.block_id`,
    });
    const patches = new Map<string, string>();
    let lastMaterial = "";
    for (const row of (data ?? []) as {id: string; name: string; value: string;}[]) {
        if (row.name === Attr.material) {
            lastMaterial = row.id;
        } else if (row.value === GROUP_PREV && lastMaterial) {
            // 题块出现在任何材料块之前：占位无法解析，按无材料降级
            patches.set(row.id, lastMaterial);
        }
    }
    for (const [qid, mid] of patches) {
        try {
            await fetchSyncPost("/api/attr/setBlockAttrs", {id: qid, attrs: {[Attr.group]: mid}});
        } catch (_) {
            // 回写失败只影响持久化，内存映射仍生效（下次装载再解析）
        }
    }
    return patches;
}

/** 拉取一篇习题文档的全部材料块（正文/译文，供组头渲染与降级 HTML）。 */
export async function listMaterials(docId: string): Promise<WenguMaterial[]> {
    const {data} = await fetchSyncPost("/api/query/sql", {
        stmt: `
            SELECT a.block_id AS id
            FROM attributes AS a JOIN blocks AS b ON b.id = a.block_id
            WHERE a.name = '${Attr.material}' AND a.value = '${MATERIAL_FLAG}'
              AND b.root_id = '${docId}'
            ORDER BY b.sort, b.created`,
    });
    const out: WenguMaterial[] = [];
    for (const row of (data ?? []) as {id: string;}[]) {
        try {
            out.push(await hydrateMaterial(row.id, docId));
        } catch (_) {
            // 单个材料失败降级为空材料，不拖垮整篇装载
        }
    }
    return out;
}

/** 取材料块的 body/trans 子块文本（与题目 hydrate 同一套子块模式）。 */
async function hydrateMaterial(id: string, rootId: string): Promise<WenguMaterial> {
    const {data: children} = await fetchSyncPost("/api/block/getChildBlocks", {id, length: 128});
    const blocks = (children as {id: string; markdown?: string;}[]) ?? [];
    const mat: WenguMaterial = {id, rootId};
    if (blocks.length === 0) return mat;
    const ids = blocks.map((b) => b.id).join("','");
    const {data: partRows} = await fetchSyncPost("/api/query/sql", {
        stmt: `SELECT block_id, value FROM attributes WHERE name = '${Attr.part}' AND block_id IN ('${ids}')`,
    });
    const partById = new Map<string, string>();
    for (const r of partRows as {block_id: string; value: string;}[]) {
        partById.set(r.block_id, r.value);
    }
    const body: string[] = [];
    const trans: string[] = [];
    for (const b of blocks) {
        const md = (b.markdown ?? "").trim();
        if (!md) continue;
        const part = partById.get(b.id);
        if (part === "body") body.push(md);
        else if (part === "trans") trans.push(md);
    }
    mat.bodyMd = body.join("\n\n");
    mat.transMd = trans.join("\n\n");
    return mat;
}
