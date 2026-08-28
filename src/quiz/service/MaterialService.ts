import { Attr, GROUP_PREV, MATERIAL_FLAG } from "../../siyuan/attrs";
import { KernelBlock } from "../../siyuan/block";
import { KernelQuery } from "../../siyuan/query";
import { fetchChildParts } from "./QuestionBatch";
import type { WenguMaterial } from "../../types";

/**
 * 材料组服务（E0，docs/english-question-review.md M1）：阅读/完形等
 * 共享原文以材料超级块（custom-plugin-wengu-material="1"）与小题
 * 同存一篇习题文档，小题用 group 属性引用材料块 id。
 *
 * AI 转换时写不出真实块 id（由内核 Lute 建块时分配），所以转换
 * 输出 group="prev" 占位（材料=文中紧邻其前的材料块）；装载时
 * resolveGroupPlaceholders 按文档序解析并回写真实 id。
 *
 * 请求一律串行（内核并发会互相吞响应，真机踩坑）。
 */

/** 解析 group="prev" 占位为真实材料块 id（按文档序：材料在前、
 *  小题紧随）。返回被改写题块 → 材料块 id 的映射，供内存视图同步。 */
export async function resolveGroupPlaceholders(docId: string): Promise<Map<string, string>> {
    // rowsAll 全量分页：行数=材料数+题数，长阅读卷轻松过 64——裸 rows
    // 会被内核静默截断，后段题的 group 占位解析不到材料（20260829 审查）
    const rows = await KernelQuery.rowsAll<{ id: string; name: string; value: string }>(`
            SELECT a.block_id AS id, a.name AS name, a.value AS value
            FROM attributes AS a JOIN blocks AS b ON b.id = a.block_id
            WHERE b.root_id = '${docId}'
              AND (a.name = '${Attr.material}' OR a.name = '${Attr.group}')
            ORDER BY b.sort, b.created, a.block_id`);
    const patches = new Map<string, string>();
    let lastMaterial = "";
    for (const row of rows) {
        if (row.name === Attr.material) {
            lastMaterial = row.id;
        } else if (row.value === GROUP_PREV && lastMaterial) {
            // 题块出现在任何材料块之前：占位无法解析，按无材料降级
            patches.set(row.id, lastMaterial);
        }
    }
    for (const [qid, mid] of patches) {
        try {
            await KernelBlock.setAttrs(qid, { [Attr.group]: mid });
        } catch (_) {
            // 回写失败只影响持久化，内存映射仍生效（下次装载再解析）
        }
    }
    return patches;
}

/** 拉取一篇习题文档的全部材料块（正文/译文，供组头渲染与降级 HTML）。 */
export async function listMaterials(docId: string): Promise<WenguMaterial[]> {
    const rows = await KernelQuery.rowsAll<{ id: string }>(`
            SELECT a.block_id AS id
            FROM attributes AS a JOIN blocks AS b ON b.id = a.block_id
            WHERE a.name = '${Attr.material}' AND a.value = '${MATERIAL_FLAG}'
              AND b.root_id = '${docId}'
            ORDER BY b.sort, b.created`);
    const out: WenguMaterial[] = [];
    for (const row of rows) {
        try {
            out.push(await hydrateMaterial(row.id, docId));
        } catch (_) {
            // 单个材料失败降级为空材料，不拖垮整篇装载
        }
    }
    return out;
}

/** 取材料块的 body/trans 子块文本（子块+part 拉取走 QuestionBatch
 *  的 fetchChildParts，与题目 hydrate 同一套模式）。 */
async function hydrateMaterial(id: string, rootId: string): Promise<WenguMaterial> {
    const { blocks, partById } = await fetchChildParts(id);
    const mat: WenguMaterial = { id, rootId };
    if (blocks.length === 0) return mat;
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
