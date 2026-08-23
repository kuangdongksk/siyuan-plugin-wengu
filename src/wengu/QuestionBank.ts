import {
    parseQuestionKramdown,
    questionHash,
} from "./BankParse";
import type {ParsedQuestion} from "./BankParse";
import {
    getBlockKramdown,
    listQuestions,
} from "./QuestionService";
import type {WenguQuestion} from "./types";

/**
 * 插件题库（saveData("bank")）：题目以「容器超级块 kramdown 原文」为
 * 主记录，细粒度管理（删题/组专题/增量同步）都在插件数据上做，不再
 * 受文档结构锁死。存量习题文档按文档粒度自动迁移（refreshDoc 幂等，
 * 已迁移名单防重）；转换完成后对新文档同样走 refreshDoc 同步入库。
 *
 * 跨卷同题去重：内容指纹（questionHash，剥块 id）→ 已存在的 hash 不
 * 再建第二条记录。作答统计镜像在记录上（块属性仍在写，双轨过渡期）。
 * 落盘按脏标记防抖（记录量可达千级、JSON 整写，不能每次作答都写）。
 */

/** 单题统计（与块属性 attempts/wrong-count/right/last-answer 对应）。 */
export interface BankStats {
    attempts: number;
    wrongCount: number;
    right?: "0" | "1";
    lastAnswer?: string;
    updatedAt: number;
}

/** 一道题的题库记录。 */
export interface BankRecord {
    qid: string;
    /** 容器超级块 kramdown 原文（题库真相，渲染/重生成从这里出发）。 */
    kramdown: string;
    type: string;
    knowledge?: string;
    chapter?: string;
    difficulty?: number;
    /** 知识点标题块引用（反链目标，按序去重）。 */
    kpRefs: {id: string; title: string;}[];
    /** 来源习题文档 id。 */
    sourceDocId: string;
    hash: string;
    stats: BankStats;
}

/** 专题：题目 id 的有序集合（手动建或按知识点收集）。 */
export interface BankCollection {
    id: string;
    title: string;
    qids: string[];
    origin: "manual" | "knowledge";
    createdAt: number;
}

/** 插件存储（saveData("bank")）里的题库。 */
export interface BankData {
    version: 1;
    records: Record<string, BankRecord>;
    collections: BankCollection[];
    /** 已迁移（同步）过的习题文档 id。 */
    migratedDocs: string[];
    /** 内容指纹 → 已有 qid（跨卷去重）。 */
    hashed: Record<string, string>;
}

/** 侧栏专题行。 */
export interface CollectionRow {
    id: string;
    title: string;
    count: number;
}

/** 知识点索引行（建专题对话框用）。 */
export interface KnowledgeRow {
    key: string;
    title: string;
    count: number;
}

const SAVE_DEBOUNCE_MS = 2000;

export class QuestionBank {
    private cache?: BankData;
    private dirty = false;
    private flushTimer?: number;
    private migrating?: Promise<void>;
    private readonly parsedCache = new Map<string, {hash: string; parsed: ParsedQuestion;}>();

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (v: BankData) => Promise<unknown>,
    ) {}

    private async all(): Promise<BankData> {
        if (this.cache) return this.cache;
        try {
            const data = await this.loadRaw() as BankData | "" | null | undefined;
            this.cache = data && typeof data === "object" && data.records ?
                data :
                {version: 1, records: {}, collections: [], migratedDocs: [], hashed: {}};
        } catch (_) {
            this.cache = {version: 1, records: {}, collections: [], migratedDocs: [], hashed: {}};
        }
        return this.cache;
    }

    /** 启动预热（首次 load 拉缓存；后续调用幂等）。 */
    async preload(): Promise<void> {
        await this.all();
    }

    private markDirty(): void {
        this.dirty = true;
        if (this.flushTimer) window.clearTimeout(this.flushTimer);
        this.flushTimer = window.setTimeout((): void => void this.flush(), SAVE_DEBOUNCE_MS);
    }

    /** 防抖落盘（销毁/关键节点也直接调）。 */
    async flush(): Promise<void> {
        if (this.flushTimer) {
            window.clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        if (!this.dirty || !this.cache) return;
        this.dirty = false;
        try {
            await this.saveRaw(this.cache);
        } catch (_) {
            // 尽力而为：写失败保留脏标记等下次
            this.dirty = true;
        }
    }

    /** 把一个习题文档同步入库（迁移与转换后同步同一条路，幂等）。
     *  返回新增记录数。串行内核调用，量大时由调用方放后台。 */
    async refreshDoc(docId: string, title = ""): Promise<number> {
        const data = await this.all();
        if (!docId) return 0;
        let added = 0;
        try {
            const questions = await listQuestions(docId);
            for (const q of questions) {
                let kd = "";
                try {
                    kd = await getBlockKramdown(q.id);
                } catch (_) {
                    continue;
                }
                const parsed = parseQuestionKramdown(kd, q.id, docId);
                if (!parsed) continue;
                const hash = this.hashOf(kd);
                const dup = data.hashed[hash];
                if (dup && dup !== q.id) continue; // 跨卷同题：只留第一条
                const exists = data.records[q.id];
                data.records[q.id] = {
                    qid: q.id,
                    kramdown: kd,
                    type: parsed.type ?? "brief",
                    ...(parsed.knowledge ? {knowledge: parsed.knowledge} : {}),
                    ...(parsed.chapter ? {chapter: parsed.chapter} : {}),
                    ...(parsed.difficulty !== undefined ? {difficulty: parsed.difficulty} : {}),
                    kpRefs: parsed.kpRefs,
                    sourceDocId: docId,
                    hash,
                    stats: exists?.stats ??
                        {attempts: q.attempts, wrongCount: q.wrongCount, updatedAt: Date.now()},
                };
                data.hashed[hash] = q.id;
                added++;
            }
        } catch (_) {
            // 文档读取失败（已删/权限）：不入 migratedDocs，下次再试
            return added;
        }
        if (!data.migratedDocs.includes(docId)) data.migratedDocs.push(docId);
        if (title && !data.collections.some((c) => c.id === `doc:${docId}`)) {
            // 源卷落成自动专题（文档模式的影子，专题入口统一）
            data.collections.push({
                id: `doc:${docId}`,
                title: `${title}·源卷`,
                qids: Object.values(data.records)
                    .filter((r) => r.sourceDocId === docId)
                    .map((r) => r.qid),
                origin: "manual",
                createdAt: Date.now(),
            });
        }
        this.markDirty();
        return added;
    }

    /** 存量迁移（后台一次）：listQuestionDocs 里有而未迁移过的文档。 */
    async ensureMigrated(docs: {id: string; title?: string;}[]): Promise<void> {
        const data = await this.all();
        const pending = docs.filter((d) => d.id && !data.migratedDocs.includes(d.id));
        if (pending.length === 0) return;
        if (this.migrating) return this.migrating;
        this.migrating = (async () => {
            for (const d of pending) {
                await this.refreshDoc(d.id, d.title ?? "");
            }
            await this.flush();
            this.migrating = undefined;
        })();
        return this.migrating;
    }

    private hashOf(kd: string): string {
        return questionHash(kd);
    }

    /** 作答镜像记账（全题型漏斗在 QuizView.recordAnswer；多步题 qid#k
     *  由调用方剥后缀——题库按整题记一次）。 */
    async recordAnswer(qid: string, submitted: string, ok: boolean): Promise<void> {
        const data = await this.all();
        const r = data.records[qid];
        if (!r) return;
        r.stats.attempts++;
        if (!ok) r.stats.wrongCount++;
        r.stats.right = ok ? "1" : "0";
        r.stats.lastAnswer = submitted;
        r.stats.updatedAt = Date.now();
        this.markDirty();
    }

    /** 专题的题目列表（解析缓存按 hash 失效；统计镜像覆盖）。 */
    async questionsOf(collectionId: string): Promise<ParsedQuestion[]> {
        const data = await this.all();
        const col = data.collections.find((c) => c.id === collectionId);
        if (!col) return [];
        const out: ParsedQuestion[] = [];
        for (const qid of col.qids) {
            const r = data.records[qid];
            if (!r) continue;
            const hit = this.parsedCache.get(qid);
            let parsed = hit && hit.hash === r.hash ? hit.parsed : undefined;
            if (!parsed) {
                parsed = parseQuestionKramdown(r.kramdown, r.qid);
                if (!parsed) continue;
                this.parsedCache.set(qid, {hash: r.hash, parsed});
            }
            out.push(overlayStats(parsed, r));
        }
        return out;
    }

    /** 侧栏专题清单（源卷自动专题在前？否——按创建时间倒序，源卷标题带·源卷）。 */
    async collectionsView(): Promise<CollectionRow[]> {
        const data = await this.all();
        return data.collections
            .slice()
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((c) => ({id: c.id, title: c.title, count: c.qids.length}));
    }

    /** 全库知识点索引（kp 引用优先，降级 knowledge/chapter 文本）。 */
    async knowledgeIndex(): Promise<KnowledgeRow[]> {
        const data = await this.all();
        const acc = new Map<string, KnowledgeRow>();
        for (const r of Object.values(data.records)) {
            const keys = r.kpRefs.length > 0 ?
                r.kpRefs.map((k) => ({key: `kp:${k.id}`, title: k.title})) :
                (r.knowledge ?
                    [{key: `kn:${r.knowledge}`, title: r.knowledge}] :
                    (r.chapter ? [{key: `ch:${r.chapter}`, title: r.chapter}] : []));
            for (const k of keys) {
                const row = acc.get(k.key) ?? {key: k.key, title: k.title, count: 0};
                row.count++;
                acc.set(k.key, row);
            }
        }
        return [...acc.values()].sort((a, b) => b.count - a.count);
    }

    /** 按知识点键收集题目 id（勾选的键做并集）。 */
    async collectQids(keys: string[]): Promise<string[]> {
        const data = await this.all();
        const set = new Set(keys);
        return Object.values(data.records)
            .filter((r) =>
                r.kpRefs.some((k) => set.has(`kp:${k.id}`)) ||
                (r.knowledge && set.has(`kn:${r.knowledge}`)) ||
                (r.chapter && set.has(`ch:${r.chapter}`))
            )
            .sort((a, b) =>
                a.sourceDocId === b.sourceDocId ?
                    a.qid.localeCompare(b.qid) :
                    a.sourceDocId.localeCompare(b.sourceDocId)
            )
            .map((r) => r.qid);
    }

    async createCollection(title: string, qids: string[], origin: "manual" | "knowledge"): Promise<CollectionRow> {
        const data = await this.all();
        const row: BankCollection = {
            id: `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            title: title.trim() || "未命名专题",
            qids: [...new Set(qids)],
            origin,
            createdAt: Date.now(),
        };
        data.collections.push(row);
        this.markDirty();
        return {id: row.id, title: row.title, count: row.qids.length};
    }

    async deleteCollection(id: string): Promise<void> {
        const data = await this.all();
        data.collections = data.collections.filter((c) => c.id !== id);
        this.markDirty();
    }

    /** 从专题移除一题（记录保留，源卷/其他专题不受影响）。 */
    async removeFromCollection(collectionId: string, qid: string): Promise<void> {
        const data = await this.all();
        const col = data.collections.find((c) => c.id === collectionId);
        if (!col) return;
        col.qids = col.qids.filter((x) => x !== qid);
        this.markDirty();
    }
}

/** 统计镜像覆盖到解析视图（保留题库身份字段）。 */
function overlayStats(p: ParsedQuestion, r: BankRecord): ParsedQuestion {
    p.attempts = r.stats.attempts;
    p.wrongCount = r.stats.wrongCount;
    p.right = r.stats.right;
    p.lastAnswer = r.stats.lastAnswer;
    return p;
}

/** 题库模式渲染也要的题面（不含统计）。 */
export function questionFromRecord(r: BankRecord): WenguQuestion | undefined {
    return parseQuestionKramdown(r.kramdown, r.qid);
}
