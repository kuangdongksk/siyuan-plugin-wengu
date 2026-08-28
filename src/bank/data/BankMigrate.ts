import type { QuestionBank } from "./QuestionBank";
import { getBlockKramdown, listQuestions } from "../../quiz/service/QuestionService";
import { parseQuestionKramdown } from "./BankParse";
import { questionHash } from "./BankParse";

/**
 * 题库入库与存量迁移（自 QuestionBank 拆出压 500 行红线）：
 * refreshDoc 把一个习题文档同步入库（迁移与转换后同步同一条路，幂等），
 * ensureMigrated 对存量文档后台跑一次。串行内核调用，量大时由调用方
 * 放后台。all/markDirty/migrating 对本模块友元开放。
 */

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
                stats: exists?.stats ?? { attempts: q.attempts, wrongCount: q.wrongCount, updatedAt: Date.now() },
            };
            data.hashed[hash] = q.id;
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
    if (title) {
        // 源卷落成自动专题（文档模式的影子，专题入口统一）；重跑刷新题单
        const qids = Object.values(data.records)
            .filter((r) => r.sourceDocId === docId)
            .map((r) => r.qid);
        const col = data.collections.find((c) => c.id === `doc:${docId}`);
        if (col) col.qids = qids;
        else
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

/** 存量迁移（后台一次）：listQuestionDocs 里有而未迁移过的文档。 */
export async function ensureMigratedFor(bank: QuestionBank, docs: { id: string; title?: string }[]): Promise<void> {
    const data = await bank.all();
    const pending = docs.filter((d) => d.id && !data.migratedDocs.includes(d.id));
    if (pending.length === 0) return;
    if (bank.migrating) return bank.migrating;
    bank.migrating = (async () => {
        for (const d of pending) {
            await refreshDocFor(bank, d.id, d.title ?? "");
        }
        await bank.flush();
        bank.migrating = undefined;
    })();
    return bank.migrating;
}
