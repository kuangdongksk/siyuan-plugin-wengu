import { KernelQuery } from "../../siyuan/query";
import { KernelBlock } from "../../siyuan/block";
import { Attr, GROUP_PREV, MATERIAL_FLAG } from "../../siyuan/attrs";
import { parseQuestionKramdown, parseMaterialKramdown } from "./BankParse";
import type { ParsedQuestion } from "./BankParse";
import type { QuestionBank, BankSet } from "./QuestionBank";
import type { SrcGroup } from "../../convert/service/SrcChunk";
import type { WenguDoc, WenguMaterial } from "../../types";

/**
 * 题集段（20260903 起转换不再落文档，题集是题库内一等实体）——
 * 函数式友元模式（同 BankRegen/BankMigrate）：接 bank 实例，读写走
 * all()/markDirty()。
 *
 * - **存量零迁移**：records 的 sourceDocId 就是题集 id（旧习题文档 id），
 *   ensureSets 按它分组补齐 sets 条目（标题尽力从仍在的旧文档读一次，
 *   读不到显示短 id）；历史轮次/docStats/影子专题的键因此全部天然延续。
 * - 新转换的题集由 convert/service/SetWriter 直写（含有序 qids 与材料）。
 */

/** 题集 id（set- 前缀，风格同 col-/gen-）。 */
export function mintSetId(): string {
    return `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 转换新题的 qid（gen- 前缀，与 addGenerated 同款生成器——bank-only
 *  题没有源块，思源块 id 语义不存在）。 */
export function mintQid(): string {
    return `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 材料块 id（mat- 前缀；bank.materials 的键，题记录 group 指向它）。 */
export function mintMatId(): string {
    return `mat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 短 id 兜底显示（标题读不到的存量题集）。 */
export function setFallbackTitle(id: string): string {
    return `习题集 ${id.slice(-6)}`;
}

/** 聚合视图 id（虚拟专题「全部习题」：所有题集按序合刷）。不落
 *  collections——仅流程层（CollectionFlow/侧栏树）认它，专题管理/清单
 *  天然看不见，删改无门。 */
export const AGGREGATE_ID = "all";

/** 聚合视图的题集顺序：sets 插入序（新转换=完成序，存量推导=记录
 *  落库序）——卷册/章节的先后就是转换先后，跨重载稳定可复现，
 *  **任何聚合都不重排**（题集先后 × 集内 qids 序，两层都不动）。 */
export async function orderedSetIds(bank: QuestionBank): Promise<string[]> {
    return Object.keys((await bank.all()).sets ?? {});
}

/** 全部题集聚合题目（聚合专题刷题列表；空题集自然无贡献）。 */
export async function allSetQuestions(bank: QuestionBank): Promise<ParsedQuestion[]> {
    const out: ParsedQuestion[] = [];
    for (const setId of await orderedSetIds(bank)) out.push(...(await setQuestions(bank, setId)));
    return out;
}

/** 全部题集的材料并集（聚合视图装载；题集顺序拼接）。 */
export async function allSetMaterials(bank: QuestionBank): Promise<WenguMaterial[]> {
    const out: WenguMaterial[] = [];
    for (const setId of await orderedSetIds(bank)) out.push(...(await setMaterials(bank, setId)));
    return out;
}

/** 推导缺 sets 条目的题集（records 按 sourceDocId 分组；后台调用，
 *  不阻塞装载）。标题从旧习题文档尽力读一次——文档已删则留空。 */
export async function ensureSets(bank: QuestionBank): Promise<number> {
    const data = await bank.all();
    data.sets ??= {};
    const groups = new Map<string, string[]>();
    for (const r of Object.values(data.records)) {
        if (!r.sourceDocId) continue;
        const qids = groups.get(r.sourceDocId) ?? [];
        qids.push(r.qid);
        groups.set(r.sourceDocId, qids);
    }
    let added = 0;
    for (const [id, qids] of groups) {
        if (data.sets[id]) continue;
        const set: BankSet = { id, title: "", qids, createdAt: Date.now() };
        try {
            const row = (
                await KernelQuery.rows<{ content?: string; hpath?: string }>(
                    `SELECT content, hpath FROM blocks WHERE id = '${id}' AND type = 'd' LIMIT 1`
                )
            )[0];
            if (row?.content) set.title = row.content;
            if (row?.hpath) set.hPath = row.hpath; // 侧栏树/聚合标题行用（读不到不阻断）
        } catch (_) {
            // 标题读不到不阻断（已删文档/索引未就绪，显示短 id 兜底）
        }
        data.sets[id] = set;
        added++;
    }
    if (added > 0) bank.markDirty();
    return added;
}

/* ── 存量材料迁移（20260903 审查 P1③）──
 * 旧世界的材料是习题文档里的超级块、小题 group 挂容器 IAL；题库化后
 * 材料进 bank.materials、group 走记录字段。ensureSets 只补题集条目不收
 * 材料——存量含材料题集永久丢材料、组链断裂（DrillUnits 全降级独立题）。
 * 迁移按文档序扫旧文档：材料块解析入库（id=材料块 id，与小题 group 引用
 * 同键天然对齐），小题 group IAL（真实 id 或 "prev" 占位按文档序解析）
 * 回填 record.group。只补缺（幂等）：记录已有 group 不动、材料已入库
 * 不重读；文档已删/属性行为空=零动作静默过。 */

/** 本会话已扫的存量文档（重扫零动作，每会话每文档至多一次 SQL）。 */
const legacyScanned = new Set<string>();

export async function migrateLegacyMaterials(bank: QuestionBank): Promise<void> {
    const data = await bank.all();
    const need = new Set<string>();
    for (const r of Object.values(data.records)) {
        const doc = r.sourceDocId;
        if (!doc || r.group || legacyScanned.has(doc)) continue;
        need.add(doc);
    }
    for (const doc of need) {
        legacyScanned.add(doc);
        try {
            await migrateOneDoc(bank, data, doc);
        } catch (e) {
            console.warn("[wengu] 存量材料迁移失败（下次装载重试）", doc, e);
            legacyScanned.delete(doc); // 失败不占坑：索引未就绪等瞬态可重试
        }
    }
}

/** 单个旧文档的迁移体（rowsAll 全量分页：行数=材料+组链，长阅读卷过 64）。 */
async function migrateOneDoc(
    bank: QuestionBank,
    data: Awaited<ReturnType<QuestionBank["all"]>>,
    docId: string
): Promise<void> {
    const rows = await KernelQuery.rowsAll<{ id: string; name: string; value: string }>(`
            SELECT a.block_id AS id, a.name AS name, a.value AS value
            FROM attributes AS a JOIN blocks AS b ON b.id = a.block_id
            WHERE b.root_id = '${docId}'
              AND (a.name = '${Attr.material}' OR a.name = '${Attr.group}')
            ORDER BY b.sort, b.created, a.block_id`);
    const matIds: string[] = [];
    const patch = new Map<string, string>(); // qid → 材料块 id
    let lastMat = "";
    for (const row of rows) {
        if (row.name === Attr.material && row.value === MATERIAL_FLAG) {
            lastMat = row.id;
            matIds.push(row.id);
        } else if (row.name === Attr.group) {
            const target = row.value === GROUP_PREV ? lastMat : row.value;
            if (target && data.records[row.id]) patch.set(row.id, target);
        }
    }
    let changed = false;
    data.materials ??= {};
    for (const mid of matIds) {
        if (data.materials[mid]) continue;
        const kd = String(((await KernelBlock.kramdown(mid)).data as { kramdown?: string } | null)?.kramdown ?? "");
        const mat = parseMaterialKramdown(kd, mid, docId);
        if (mat) {
            data.materials[mid] = {
                id: mid,
                setId: docId,
                ...(mat.bodyMd ? { bodyMd: mat.bodyMd } : {}),
                ...(mat.transMd ? { transMd: mat.transMd } : {}),
            };
            changed = true;
        }
    }
    for (const [qid, mid] of patch) {
        const r = data.records[qid];
        if (r && !r.group && data.materials[mid]) {
            r.group = mid;
            changed = true;
        }
    }
    if (changed) bank.markDirty();
}

/** 题集的题目（set.qids 序；解析走缓存、统计镜像覆盖、rootId=setId）。 */
export async function setQuestions(bank: QuestionBank, setId: string): Promise<ParsedQuestion[]> {
    const data = await bank.all();
    const set = data.sets?.[setId];
    if (!set) return [];
    const out: ParsedQuestion[] = [];
    for (const qid of set.qids) {
        const r = data.records[qid];
        if (!r) continue;
        const parsed =
            bank.parsedOf(qid, r.hash) ??
            (() => {
                const p = parseQuestionKramdown(r.kramdown, qid, setId);
                if (p) bank.cacheParsed(qid, r.hash, p);
                return p;
            })();
        if (!parsed) continue;
        parsed.rootId = setId; // 缓存命中时也可能是专题模式解析的（无 rootId），归位
        if (r.group) parsed.group = r.group; // 记录字段为组链真相（20260903 审查 P1①）
        parsed.attempts = r.stats.attempts;
        parsed.wrongCount = r.stats.wrongCount;
        parsed.right = r.stats.right;
        parsed.lastAnswer = r.stats.lastAnswer;
        out.push(parsed);
    }
    return out;
}

/** 题集的全部材料（bank.materials；组头渲染与材料组降级 HTML 用）。 */
export async function setMaterials(bank: QuestionBank, setId: string): Promise<WenguMaterial[]> {
    const data = await bank.all();
    return Object.values(data.materials ?? {})
        .filter((m) => m.setId === setId)
        .map((m) => ({ id: m.id, rootId: setId, bodyMd: m.bodyMd, transMd: m.transMd }));
}

/** 按 qid 取一题的解析视图（复习详情等单题消费点；统计镜像随行）。 */
export async function questionOf(bank: QuestionBank, qid: string): Promise<ParsedQuestion | undefined> {
    const data = await bank.all();
    const r = data.records[qid];
    if (!r) return undefined;
    const parsed =
        bank.parsedOf(qid, r.hash) ??
        (() => {
            const p = parseQuestionKramdown(r.kramdown, qid, r.sourceDocId);
            if (p) bank.cacheParsed(qid, r.hash, p);
            return p;
        })();
    if (!parsed) return undefined;
    parsed.rootId = r.sourceDocId;
    if (r.group) parsed.group = r.group; // 记录字段为组链真相（20260903 审查 P1①）
    parsed.attempts = r.stats.attempts;
    parsed.wrongCount = r.stats.wrongCount;
    parsed.right = r.stats.right;
    parsed.lastAnswer = r.stats.lastAnswer;
    return parsed;
}

/** 全部题集的聚合视图（WenguDoc[]，替换 listQuestionDocs 的 SQL 聚合）：
 *  total 按 set.qids（ensureSets 未跑的虚拟分组按记录数）、运行时数字
 *  按记录 stats/docStats 归并——自托管口径不变。 */
export async function setDocsView(bank: QuestionBank): Promise<WenguDoc[]> {
    const data = await bank.all();
    const agg = new Map<string, { title: string; hPath: string; total: number; attempted: number; right: number }>();
    const ensure = (id: string): { title: string; hPath: string; total: number; attempted: number; right: number } => {
        let a = agg.get(id);
        if (!a) {
            a = { title: "", hPath: "", total: 0, attempted: 0, right: 0 };
            agg.set(id, a);
        }
        return a;
    };
    for (const [id, set] of Object.entries(data.sets ?? {})) {
        const a = ensure(id);
        a.title = set.title;
        a.hPath = set.hPath ?? "";
        a.total = set.qids.length;
    }
    for (const r of Object.values(data.records)) {
        if (!r.sourceDocId) continue;
        const a = ensure(r.sourceDocId);
        if (r.stats.attempts > 0) a.attempted++;
        if (r.stats.right === "1") a.right++;
        if (!data.sets?.[r.sourceDocId]) a.total++; // 虚拟分组（推导未落）按记录数
    }
    return [...agg.entries()]
        .map(([id, a]) => ({
            id,
            title: a.title || setFallbackTitle(id),
            hPath: a.hPath,
            total: a.total,
            attempted: a.attempted,
            rightCount: a.right,
            totalTime: data.docStats[id] ?? 0,
        }))
        .sort((x, y) => y.total - x.total);
}

/** 读题集记录里的源块分组（增量重转换的旧方，替代 attributes 表查询；
 *  同 src-hash 的题归一组，键取组内任一）。 */
export async function readRecordSrcGroups(bank: QuestionBank, setId: string): Promise<SrcGroup[]> {
    const data = await bank.all();
    const byHash = new Map<string, SrcGroup>();
    for (const r of Object.values(data.records)) {
        if (r.sourceDocId !== setId || !r.srcHash) continue;
        let g = byHash.get(r.srcHash);
        if (!g) {
            g = { key: r.srcKey ?? "", hash: r.srcHash, blocks: [] };
            byHash.set(r.srcHash, g);
        }
        if (!g.blocks.includes(r.qid)) g.blocks.push(r.qid);
    }
    return [...byHash.values()];
}

/** 删除一批记录（增量重转换「消失/重生成」的删旧；set.qids/影子专题/
 *  专题引用/哈希索引同步清，材料正文不动——孤儿材料无消费面，无害）。 */
export async function removeRecords(bank: QuestionBank, qids: string[]): Promise<void> {
    if (qids.length === 0) return;
    const data = await bank.all();
    const dead = new Set(qids);
    for (const qid of qids) {
        const r = data.records[qid];
        if (!r) continue;
        if (data.hashed[r.hash] === qid) delete data.hashed[r.hash];
        delete data.records[qid];
        bank.invalidateParse(qid);
    }
    if (data.sets) {
        for (const set of Object.values(data.sets)) {
            if (set.qids.some((q) => dead.has(q))) set.qids = set.qids.filter((q) => !dead.has(q));
        }
    }
    data.collections = data.collections.map((c) =>
        c.qids.some((q) => dead.has(q)) ? { ...c, qids: c.qids.filter((q) => !dead.has(q)) } : c
    );
    bank.markDirty();
}

/** 给一批记录打 src-stale（增量重转换「保留旧题」动作）。 */
export async function staleRecords(bank: QuestionBank, qids: string[]): Promise<void> {
    const data = await bank.all();
    let n = 0;
    for (const qid of qids) {
        const r = data.records[qid];
        if (r) {
            r.srcStale = "1";
            n++;
        }
    }
    if (n > 0) bank.markDirty();
}

/** 记录归属的题集 id（无记录返回空；DocOps/跳转降级用）。 */
export async function setOfRecord(bank: QuestionBank, qid: string): Promise<string> {
    const data = await bank.all();
    return data.records[qid]?.sourceDocId ?? "";
}

/** 题集某题是否 bank-only（无对应源块可跳——siyuan://blocks 跳转降级）。
 *  gen-/mat- 前缀 id 与新 mint 的题天然无源块。 */
export function qidHasBlock(qid: string): boolean {
    return /^\d{14}-[a-z0-9]+$/.test(qid);
}
