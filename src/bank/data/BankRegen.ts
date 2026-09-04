import { parseQuestionKramdown, questionHash } from "./BankParse";
import type { QuestionBank, BankRecord } from "./QuestionBank";
import { normKn } from "./KnowledgeNorm";
import { knKey } from "./KnowledgeNorm";

/**
 * 题库「对账 / 重生成 / 反查 / 生成入库」段（契约 §三的 ③④⑤⑥）——
 * 20260901 从 QuestionBank 类拆出压 500 行红线，同 BankMigrate/
 * BankRecording 的**函数式友元**模式：接 bank 实例，读写走 all()/
 * markDirty()，题库身份字段与「脏标记防抖落盘」节奏不变（调用方
 * 全换 `bank.foo(x)` → `foo(bank, x)`，语义零变化）。
 */

/** 取一条记录（重新生成读原文/知识点引用）。 */
export async function recordOf(bank: QuestionBank, qid: string): Promise<BankRecord | undefined> {
    const data = await bank.all();
    return data.records[qid];
}

/** 替换一题的 kramdown（重新生成后）：更新指纹、失效解析缓存并落盘。
 *  旧格式的组链（group 在容器 IAL 里）趁替换迁到记录字段——新 kramdown
 *  不再落 group IAL，不迁移则重生成一次就断组（20260903 审查 P1①）。 */
export async function replaceRecordKramdown(bank: QuestionBank, qid: string, kd: string): Promise<boolean> {
    const data = await bank.all();
    const r = data.records[qid];
    if (!r) return false;
    const hash = questionHash(kd);
    delete data.hashed[r.hash];
    if (!r.group) {
        const legacy = /custom-plugin-wengu-group="([^"]*)"/.exec(r.kramdown);
        if (legacy && legacy[1] && legacy[1] !== "prev") r.group = legacy[1];
    }
    r.kramdown = kd;
    r.hash = hash;
    data.hashed[hash] = qid;
    bank.invalidateParse(qid);
    bank.markDirty();
    return true;
}

/** 全库知识点引用清单（id → 标题），对账收集悬空用。 */
export async function collectKpRefs(bank: QuestionBank): Promise<Map<string, string>> {
    const data = await bank.all();
    const out = new Map<string, string>();
    for (const r of Object.values(data.records)) {
        for (const k of r.kpRefs) if (!out.has(k.id)) out.set(k.id, k.title);
    }
    return out;
}

/** 把全库引用的 oldId 重挂到 newId（悬空对账，按标题唯一命中时调用）。 */
export async function remapKpRef(bank: QuestionBank, oldId: string, newId: string, title: string): Promise<number> {
    const data = await bank.all();
    let n = 0;
    for (const r of Object.values(data.records)) {
        if (r.kpRefs.some((k) => k.id === oldId)) {
            r.kpRefs = r.kpRefs.map((k) => (k.id === oldId ? { id: newId, title } : k));
            bank.invalidateParse(r.qid);
            n++;
        }
    }
    if (n > 0) bank.markDirty();
    return n;
}

/** 某知识文档的相关题目（引用落在该文档下的记录；反查入口用）。
 *  kpRoots 由调用方查好（kp 块 id → 所在文档 id）。 */
export async function questionsRelatedToDoc(
    bank: QuestionBank,
    docId: string,
    kpRoots: Map<string, string>
): Promise<{ qid: string; stem: string; attempts: number; wrongCount: number }[]> {
    const data = await bank.all();
    const out: { qid: string; stem: string; attempts: number; wrongCount: number }[] = [];
    for (const r of Object.values(data.records)) {
        const hit = r.sourceDocId === docId || r.kpRefs.some((k) => kpRoots.get(k.id) === docId);
        if (!hit) continue;
        const parsed = bank.parsedOf(r.qid, r.hash) ?? parseQuestionKramdown(r.kramdown, r.qid);
        out.push({
            qid: r.qid,
            stem: (parsed?.stemMd ?? r.kramdown).replace(/\s+/g, " ").trim().slice(0, 60),
            attempts: r.stats.attempts,
            wrongCount: r.stats.wrongCount,
        });
    }
    return out.sort((a, b) => b.wrongCount - a.wrongCount || b.attempts - a.attempts).slice(0, 50);
}

/** 按薄弱键取记录（针对性生成找错题模板用；键含 kp:/kn:/ch: 前缀，
 *  kn 键双向归一——传入新旧键都能命中归一词干）。 */
export async function recordsByKeys(bank: QuestionBank, keys: string[]): Promise<BankRecord[]> {
    const data = await bank.all();
    const set = new Set(keys.map(normKn));
    return Object.values(data.records).filter(
        (r) =>
            r.kpRefs.some((k) => set.has(`kp:${k.id}`)) ||
            (r.knowledge && set.has(knKey(r.knowledge))) ||
            (r.chapter && set.has(`ch:${r.chapter}`))
    );
}

/** 某源卷的全部题记录（变式重练取模板用，按 qid 稳定序）。 */
export async function recordsOfDoc(bank: QuestionBank, docId: string): Promise<BankRecord[]> {
    const data = await bank.all();
    return Object.values(data.records)
        .filter((r) => r.sourceDocId === docId)
        .sort((a, b) => a.qid.localeCompare(b.qid));
}

/** 生成的新题入库（针对性练习；qid 自分配，来源标记 gen）。 */
export async function addGenerated(
    bank: QuestionBank,
    kd: string,
    kpRefs: { id: string; title: string }[],
    title: string
): Promise<string> {
    const data = await bank.all();
    const parsed = parseQuestionKramdown(kd, "");
    if (!parsed) throw new Error("generated question parse failed");
    const hash = questionHash(kd);
    const dup = data.hashed[hash];
    if (dup) return dup;
    const qid = `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    data.records[qid] = {
        qid,
        kramdown: kd,
        type: parsed.type ?? "brief",
        ...(parsed.knowledge ? { knowledge: parsed.knowledge } : {}),
        ...(parsed.chapter ? { chapter: parsed.chapter } : {}),
        ...(parsed.difficulty !== undefined ? { difficulty: parsed.difficulty } : {}),
        kpRefs,
        sourceDocId: "",
        hash,
        stats: { attempts: 0, wrongCount: 0, updatedAt: Date.now() },
    };
    data.hashed[hash] = qid;
    const col = data.collections.find((c) => c.title === title);
    if (col && !col.qids.includes(qid)) col.qids.push(qid); // 去重（与 appendToCollection 口径对齐）
    bank.markDirty();
    return qid;
}

/** 生成专题若无则建（针对性练习收集容器）。 */
export async function ensureCollection(bank: QuestionBank, title: string): Promise<void> {
    const data = await bank.all();
    if (!data.collections.some((c) => c.title === title)) {
        data.collections.push({
            id: `col-${Date.now().toString(36)}`,
            title,
            qids: [],
            origin: "manual",
            createdAt: Date.now(),
        });
        bank.markDirty();
    }
}

/** 把题目挂进指定标题的专题。 */
export async function appendToCollection(bank: QuestionBank, title: string, qid: string): Promise<void> {
    const data = await bank.all();
    const col = data.collections.find((c) => c.title === title);
    if (col && !col.qids.includes(qid)) {
        col.qids.push(qid);
        bank.markDirty();
    }
}
