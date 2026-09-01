import type { QuestionBank, BankStats } from "./QuestionBank";
import { Attr } from "../../siyuan/attrs";
import { KernelBlock } from "../../siyuan/block";
import { getBlockAttrs, getBlockKramdown, listQuestions } from "../../quiz/service/QuestionService";
import { parseQuestionKramdown } from "./BankParse";
import { questionHash } from "./BankParse";
import type { WenguQuestion } from "../../types";

/**
 * 题库入库（自 QuestionBank 拆出压 500 行红线）：refreshDoc 把一个习题
 *  文档同步入库（转换后同步与首扫同一条路，幂等），ensureMigrated 对
 *  未扫过的习题文档后台首扫一次。串行内核调用，量大时由调用方放后台。
 *  all/markDirty/migrating 对本模块友元开放。
 */

/** 块属性运行时统计 → 题库 stats 播种/回灌（细粒度编码原样透传）。 */
function seedStats(q: WenguQuestion): BankStats {
    return {
        attempts: q.attempts,
        wrongCount: q.wrongCount,
        ...(q.right ? { right: q.right } : {}),
        ...(q.lastAnswer ? { lastAnswer: q.lastAnswer } : {}),
        ...(q.stepRight ? { stepRight: q.stepRight } : {}),
        ...(q.stepLast ? { stepLast: q.stepLast } : {}),
        ...(q.slotRight ? { slotRight: q.slotRight } : {}),
        ...(q.slotLast ? { slotLast: q.slotLast } : {}),
        updatedAt: Date.now(),
    };
}

/** 块上残留的运行时统计属性置空剥离（内核空值=删属性，DocOps 同款；
 *  仅在有值时发调用，幂等——回灌后块值恒零即静默）。 */
async function stripRuntimeAttrs(qid: string, q: WenguQuestion): Promise<void> {
    const pairs: Record<string, string> = {};
    if (q.attempts > 0) pairs[Attr.attempts] = "";
    if (q.wrongCount > 0) pairs[Attr.wrongCount] = "";
    if (q.right) pairs[Attr.right] = "";
    if (q.lastAnswer) pairs[Attr.lastAnswer] = "";
    if (q.stepRight) pairs[Attr.stepRight] = "";
    if (q.stepLast) pairs[Attr.stepLast] = "";
    if (q.slotRight) pairs[Attr.slotRight] = "";
    if (q.slotLast) pairs[Attr.slotLast] = "";
    if (Object.keys(pairs).length === 0) return;
    try {
        await KernelBlock.setAttrs(qid, pairs);
    } catch (_) {
        // 尽力而为：残留属性不影响统计正确性，下次重扫再清
    }
}

/** 把一个习题文档同步入库，返回新增记录数。重跑=增量同步：qid 逐条
 *  upsert（续跑追加/手工改题都能重扫进 records）、本次扫描未见且归属
 *  本文档的旧记录剔除（题块被删不再滞留）、doc:影子专题题单刷新——
 *  原实现 migratedDocs 只防重不刷新，追加的题永远进不了题库（20260829
 *  三轮审查 P1）。 */
export async function refreshDocFor(bank: QuestionBank, docId: string, title = ""): Promise<number> {
    const data = await bank.all();
    if (!docId) return 0;
    let added = 0;
    let alive: Set<string>;
    try {
        const questions = await listQuestions(docId);
        alive = new Set(questions.map((q) => q.id)); // 现存题块清单（判活口径，与解析成败无关）
        for (const q of questions) {
            let kd = "";
            try {
                kd = await getBlockKramdown(q.id);
            } catch (_) {
                continue;
            }
            const parsed = parseQuestionKramdown(kd, q.id, docId);
            if (!parsed) continue;
            const hash = questionHash(kd);
            const dup = data.hashed[hash];
            if (dup && dup !== q.id) continue; // 跨卷同题：只留第一条
            const exists = data.records[q.id];
            if (!exists) added++;
            data.records[q.id] = {
                qid: q.id,
                kramdown: kd,
                type: parsed.type ?? "brief",
                ...(parsed.knowledge ? { knowledge: parsed.knowledge } : {}),
                ...(parsed.chapter ? { chapter: parsed.chapter } : {}),
                ...(parsed.difficulty !== undefined ? { difficulty: parsed.difficulty } : {}),
                kpRefs: parsed.kpRefs,
                sourceDocId: docId,
                hash,
                // 统计回灌：题库为零而块上有值（停写 IAL 前的存量）时收编，
                // 并把块上残留属性置空剥离——双轨过渡在此收口
                stats:
                    exists && exists.stats.attempts > 0
                        ? exists.stats
                        : q.attempts > 0
                          ? seedStats(q)
                          : (exists?.stats ?? seedStats(q)),
            };
            data.hashed[hash] = q.id;
            if (q.attempts > 0) await stripRuntimeAttrs(q.id, q);
        }
        // 文档级 total-time 同款回灌（取 max：docStats 可能已含迁移后增量）
        try {
            const docAttrs = await getBlockAttrs(docId);
            const legacy = Number(docAttrs[Attr.totalTime]) || 0;
            if (legacy > 0) {
                data.docStats[docId] = Math.max(data.docStats[docId] ?? 0, legacy);
                await KernelBlock.setAttrs(docId, { [Attr.totalTime]: "" });
            }
        } catch (_) {
            // 文档根读取失败：totalTime 留在块上，下次重扫再收
        }
    } catch (_) {
        // 文档读取失败（已删/权限）：不入 migratedDocs，下次再试
        return added;
    }
    // 题块已删的旧记录剔除（仅本文档归属的；hash 索引同步清）——按
    // 现存清单判活：kramdown 拉取/解析失败的题块仍在文档里，不能误删
    const dead = new Set<string>();
    for (const [qid, r] of Object.entries(data.records)) {
        if (r.sourceDocId === docId && !alive.has(qid)) {
            dead.add(qid);
            delete data.records[qid];
        }
    }
    if (dead.size > 0) {
        for (const hash of Object.keys(data.hashed)) {
            if (dead.has(data.hashed[hash])) delete data.hashed[hash];
        }
    }
    if (!data.migratedDocs.includes(docId)) data.migratedDocs.push(docId);
    // 源卷影子专题：已存在则刷新题单（title 空的重扫也刷）；新建仍需 title
    const qids = Object.values(data.records)
        .filter((r) => r.sourceDocId === docId)
        .map((r) => r.qid);
    const col = data.collections.find((c) => c.id === `doc:${docId}`);
    if (col) col.qids = qids;
    else if (title) {
        data.collections.push({
            id: `doc:${docId}`,
            title: `${title}·源卷`,
            qids,
            origin: "manual",
            createdAt: Date.now(),
        });
    }
    bank.markDirty();
    return added;
}

/** 习题文档首次入库（后台一次）：listQuestionDocs 里有而未扫过的文档
 *  逐个 refreshDocFor 入题库（migratedDocs 防重）。串行内核调用，量大
 *  时由调用方放后台。 */
export async function ensureMigratedFor(bank: QuestionBank, docs: { id: string; title?: string }[]): Promise<void> {
    const data = await bank.all();
    const fresh = docs.filter((d) => d.id && !data.migratedDocs.includes(d.id));
    if (fresh.length === 0) return;
    if (bank.migrating) return bank.migrating;
    bank.migrating = (async () => {
        try {
            for (const d of fresh) {
                await refreshDocFor(bank, d.id, d.title ?? "");
            }
            await bank.flush();
        } finally {
            // 闸必须复位：异常（如 flush 上抛）不复位会把后续入库永久短路
            bank.migrating = undefined;
        }
    })();
    return bank.migrating;
}
