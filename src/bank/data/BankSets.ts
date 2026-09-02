import { KernelQuery } from "../../siyuan/query";
import { parseQuestionKramdown } from "./BankParse";
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
                await KernelQuery.rows<{ content?: string }>(
                    `SELECT content FROM blocks WHERE id = '${id}' AND type = 'd' LIMIT 1`
                )
            )[0];
            if (row?.content) set.title = row.content;
        } catch (_) {
            // 标题读不到不阻断（已删文档/索引未就绪，显示短 id 兜底）
        }
        data.sets[id] = set;
        added++;
    }
    if (added > 0) bank.markDirty();
    return added;
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
