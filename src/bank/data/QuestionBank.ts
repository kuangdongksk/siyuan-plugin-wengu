import { parseQuestionKramdown, questionHash } from "./BankParse";
import type { ParsedQuestion } from "./BankParse";
import { ensureMigratedFor, refreshDocFor } from "./BankMigrate";
import { knKey, pickStandardName } from "./KnowledgeNorm";
import { notifyError } from "../../ui/Notify";

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

/** 单题统计（作答运行时唯一真相——自托管后停写块属性，细粒度编码
 *  与原块属性一致：step/slotRight 位图串、step/slotLast 竖线序列）。 */
export interface BankStats {
    attempts: number;
    wrongCount: number;
    right?: "0" | "1";
    lastAnswer?: string;
    stepRight?: string;
    stepLast?: string;
    slotRight?: string;
    slotLast?: string;
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
    kpRefs: { id: string; title: string }[];
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
    /** 活视图绑定（□3）：知识树节点主键（kp:{块id}）。缺省=死快照。 */
    nodeKey?: string;
    /** 活视图刷新入参：节点子树引用键并集（含自身；questionsOf 读取时
     *  按 collectQids 口径重算 qids，题库变化自动回流）。 */
    subKeys?: string[];
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
    /** 手动导入的知识文档根（知识面板登记；旧数据缺省为 []）。 */
    knowRoots: string[];
    /** 手动建的目录文件夹路径（空文件夹落盘；旧数据缺省为 []）。 */
    folders: string[];
    /** 软删除的知识文档 id 集合（面板里不再展示；思源文档本体不动，
     *  与 knowRoots 平行；旧数据缺省为 []）。 */
    knowHidden: string[];
    /** 文档级累计刷题用时（秒，原 total-time 块属性自托管）。 */
    docStats: Record<string, number>;
    /** 镜像漂移登记（DriftWatch 写）：习题文档 id → 漂移摘要，UI 徽标
     *  与「采纳/忽略」弹窗消费；空漂移删条目。 */
    driftDocs?: Record<string, DriftEntry>;
}

/** 一个习题文档的镜像漂移摘要（changed=内容变、fresh=文档新增未入库、
 *  gone=题块已删但记录仍在——三类都靠一次重扫（refreshDocFor）收口）。 */
export interface DriftEntry {
    changed: string[];
    fresh: string[];
    gone: string[];
    updatedAt: number;
}

/** 侧栏专题行。 */
export interface CollectionRow {
    id: string;
    title: string;
    count: number;
}

/** 专题标题 → 目录路径规范化：按「/」分段 trim、去空段，总长超 60
 *  从整段处截断（不切半段）；返回空串 = 无有效段（创建兜底未命名，
 *  重命名按无效放弃）。无「/」即普通平铺标题（行为同旧版 trim）。 */
export function normalizeCollectionPath(title: string): string {
    const out: string[] = [];
    for (const seg of title
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (out.join("/").length + (out.length ? 1 : 0) + seg.length > 60) break;
        out.push(seg);
    }
    return out.join("/");
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
    /** 供 BankMigrate 友元使用（迁移互斥闸）。 */
    migrating?: Promise<void>;
    private readonly parsedCache = new Map<string, { hash: string; parsed: ParsedQuestion }>();

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (v: BankData) => Promise<unknown>
    ) {}

    /** 供 BankMigrate 友元使用（入库与迁移编排）。 */
    async all(): Promise<BankData> {
        if (this.cache) return this.cache;
        // 只把「读到的东西不是合法题库」当空；**读异常上抛不落缓存**——
        // 原归空后任意 markDirty→flush 会把空 records/collections 覆写
        // 落盘、千级题库静默清零（HistoryStore 同坑 20260828 已修，
        // 20260829 三轮审查补齐本店与 WeaknessStore；loadRaw「文件不
        // 存在」约定返回空串/undefined，进下方三元归空不受影响）
        const data = (await this.loadRaw()) as BankData | "" | null | undefined;
        this.cache =
            data && typeof data === "object" && data.records
                ? data
                : {
                      version: 1,
                      records: {},
                      collections: [],
                      migratedDocs: [],
                      hashed: {},
                      knowRoots: [],
                      folders: [],
                      knowHidden: [],
                      docStats: {},
                  };
        for (const k of ["knowRoots", "folders", "knowHidden"] as const)
            if (!Array.isArray(this.cache[k])) this.cache[k] = []; // 旧数据补字段
        if (!this.cache.docStats) this.cache.docStats = {};
        return this.cache;
    }

    /** 启动预热（首次 load 拉缓存；后续调用幂等）。 */
    async preload(): Promise<void> {
        await this.all();
    }

    /** 已加载缓存的同步窥视（未就绪返回 undefined；UI 快照渲染用，
     *  load 流程 await preload 之后 renderList 的时序保证 cache 命中）。 */
    peek(): BankData | undefined {
        return this.cache;
    }

    /** 供 BankMigrate 友元使用（入库与迁移编排）。 */
    markDirty(): void {
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
        } catch (e) {
            // 尽力而为：写失败保留脏标记并重排防抖——原只保留标记不清
            // 定时器，得等下一次 markDirty 才会再试（20260829 审查）；
            // 不再静默：落盘失败走思源通知（Notify 同文案 60s 冷却）
            notifyError({ key: "notifySaveFailBank", vars: { msg: String((e as Error)?.message ?? e) } });
            this.dirty = true;
            this.flushTimer = window.setTimeout((): void => void this.flush(), SAVE_DEBOUNCE_MS);
        }
    }

    /** 把一个习题文档同步入库（迁移与转换后同步同一条路，幂等）。
     *  实现在 BankMigrate.refreshDocFor（拆出压 500 行红线）。 */
    async refreshDoc(docId: string, title = ""): Promise<number> {
        return refreshDocFor(this, docId, title);
    }

    /** 习题文档首次入库（后台一次）：实现在 BankMigrate.ensureMigratedFor。 */
    async ensureMigrated(docs: { id: string; title?: string }[]): Promise<void> {
        return ensureMigratedFor(this, docs);
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

    /** 专题的题目列表（解析缓存按 hash 失效；统计镜像覆盖）。活视图
     *  专题（subKeys 绑定）读取时先实时刷新题单——题库后续变化回流。 */
    async questionsOf(collectionId: string): Promise<ParsedQuestion[]> {
        const data = await this.all();
        const col = data.collections.find((c) => c.id === collectionId);
        if (!col) return [];
        if (col.subKeys?.length) {
            const live = await this.collectQids(col.subKeys);
            if (live.join("\u0000") !== col.qids.join("\u0000")) {
                col.qids = live;
                this.markDirty();
            }
        }
        const out: ParsedQuestion[] = [];
        for (const qid of col.qids) {
            const r = data.records[qid];
            if (!r) continue;
            const hit = this.parsedCache.get(qid);
            let parsed = hit && hit.hash === r.hash ? hit.parsed : undefined;
            if (!parsed) {
                parsed = parseQuestionKramdown(r.kramdown, r.qid);
                if (!parsed) continue;
                this.parsedCache.set(qid, { hash: r.hash, parsed });
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
            .map((c) => ({ id: c.id, title: c.title, count: c.qids.length }));
    }

    /** 全库知识点索引（kp 引用优先，降级 knowledge/chapter 文本；kn 键
     *  走归一词干——「洛必达」与「洛必达法则」并成一行；显示名取同簇
     *  标准名 pickStandardName，即信息最全的正式写法「洛必达法则」）。 */
    async knowledgeIndex(): Promise<KnowledgeRow[]> {
        const data = await this.all();
        const acc = new Map<string, KnowledgeRow>();
        /** kn 键 → 同簇原文写法（选标准名用）。 */
        const knNames = new Map<string, string[]>();
        for (const r of Object.values(data.records)) {
            const keys =
                r.kpRefs.length > 0
                    ? r.kpRefs.map((k) => ({ key: `kp:${k.id}`, title: k.title }))
                    : r.knowledge && knKey(r.knowledge)
                      ? [{ key: knKey(r.knowledge), title: r.knowledge }]
                      : r.chapter
                        ? [{ key: `ch:${r.chapter}`, title: r.chapter }]
                        : [];
            for (const k of keys) {
                if (k.key.startsWith("kn:") && r.knowledge) {
                    const names = knNames.get(k.key) ?? [];
                    names.push(r.knowledge);
                    knNames.set(k.key, names);
                }
                const row = acc.get(k.key) ?? { key: k.key, title: k.title, count: 0 };
                row.count++;
                acc.set(k.key, row);
            }
        }
        // kn 键显示名替换为同簇标准名（正式名）
        for (const [key, names] of knNames) {
            const row = acc.get(key);
            const std = pickStandardName(names);
            if (row && std) row.title = std;
        }
        return [...acc.values()].sort((a, b) => b.count - a.count);
    }

    /** 按知识点键收集题目 id（勾选的键做并集；kn 键按归一词干比对，
     *  传入键也归一——新旧键都能命中）。 */
    async collectQids(keys: string[]): Promise<string[]> {
        const data = await this.all();
        const set = new Set(keys.map(normKn));
        return Object.values(data.records)
            .filter(
                (r) =>
                    r.kpRefs.some((k) => set.has(`kp:${k.id}`)) ||
                    (r.knowledge && set.has(knKey(r.knowledge))) ||
                    (r.chapter && set.has(`ch:${r.chapter}`))
            )
            .sort((a, b) =>
                a.sourceDocId === b.sourceDocId
                    ? a.qid.localeCompare(b.qid)
                    : a.sourceDocId.localeCompare(b.sourceDocId)
            )
            .map((r) => r.qid);
    }

    async createCollection(title: string, qids: string[], origin: "manual" | "knowledge"): Promise<CollectionRow> {
        const data = await this.all();
        const row: BankCollection = {
            id: `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            title: normalizeCollectionPath(title) || "未命名专题",
            qids: [...new Set(qids)],
            origin,
            createdAt: Date.now(),
        };
        data.collections.push(row);
        this.markDirty();
        return { id: row.id, title: row.title, count: row.qids.length };
    }

    async deleteCollection(id: string): Promise<void> {
        const data = await this.all();
        data.collections = data.collections.filter((c) => c.id !== id);
        this.markDirty();
    }

    /** 重命名专题（专题管理工作区面板；含 / 即改挂目录）。 */
    async renameCollection(id: string, title: string): Promise<void> {
        const data = await this.all();
        const col = data.collections.find((c) => c.id === id);
        const next = normalizeCollectionPath(title);
        if (!col || !next || next === col.title) return;
        col.title = next;
        this.markDirty();
    }

    /** 删除文档侧插件数据：该卷全部记录、内容哈希索引、doc: 影子专题、
     *  各专题对这批 qid 的引用、迁移标记（文档本体由调用方先删入回收站；
     *  gen- 生成题不挂 sourceDocId，不受影响）。 */
    async removeDocData(docId: string): Promise<void> {
        const data = await this.all();
        const dead = new Set(
            Object.values(data.records)
                .filter((r) => r.sourceDocId === docId)
                .map((r) => r.qid)
        );
        for (const qid of dead) delete data.records[qid];
        for (const hash of Object.keys(data.hashed)) {
            if (dead.has(data.hashed[hash])) delete data.hashed[hash];
        }
        data.collections = data.collections
            .filter((c) => c.id !== `doc:${docId}`)
            .map((c) =>
                c.qids.some((qid) => dead.has(qid)) ? { ...c, qids: c.qids.filter((qid) => !dead.has(qid)) } : c
            );
        data.migratedDocs = data.migratedDocs.filter((d) => d !== docId);
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

    /** 把题目挂进指定 id 的专题（补题生成用，按 id 免受同名干扰）。 */
    async appendQidToCollection(collectionId: string, qid: string): Promise<void> {
        const data = await this.all();
        const col = data.collections.find((c) => c.id === collectionId);
        if (col && !col.qids.includes(qid)) {
            col.qids.push(qid);
            this.markDirty();
        }
    }

    /** 专题题目涉及的来源文档集合（gen- 无来源除外；col 模式材料并集装载用）。 */
    async collectionSourceDocs(collectionId: string): Promise<string[]> {
        const data = await this.all();
        const col = data.collections.find((c) => c.id === collectionId);
        if (!col) return [];
        const docs = new Set<string>();
        for (const qid of col.qids) {
            const d = data.records[qid]?.sourceDocId;
            if (d) docs.add(d);
        }
        return [...docs];
    }

    /* ── 重新生成 / 对账 / 反查 / 生成入库（③④⑤⑥ 用） ── */

    /** 取一条记录（重新生成读原文/知识点引用）。 */
    async recordOf(qid: string): Promise<BankRecord | undefined> {
        const data = await this.all();
        return data.records[qid];
    }

    /** 替换一题的 kramdown（重新生成后）：更新指纹、失效解析缓存并落盘。 */
    async replaceRecordKramdown(qid: string, kd: string): Promise<boolean> {
        const data = await this.all();
        const r = data.records[qid];
        if (!r) return false;
        const hash = questionHash(kd);
        delete data.hashed[r.hash];
        r.kramdown = kd;
        r.hash = hash;
        data.hashed[hash] = qid;
        this.parsedCache.delete(qid);
        this.markDirty();
        return true;
    }

    /** 全库知识点引用清单（id → 标题），对账收集悬空用。 */
    async collectKpRefs(): Promise<Map<string, string>> {
        const data = await this.all();
        const out = new Map<string, string>();
        for (const r of Object.values(data.records)) {
            for (const k of r.kpRefs) if (!out.has(k.id)) out.set(k.id, k.title);
        }
        return out;
    }

    /** 把全库引用的 oldId 重挂到 newId（悬空对账，按标题唯一命中时调用）。 */
    async remapKpRef(oldId: string, newId: string, title: string): Promise<number> {
        const data = await this.all();
        let n = 0;
        for (const r of Object.values(data.records)) {
            if (r.kpRefs.some((k) => k.id === oldId)) {
                r.kpRefs = r.kpRefs.map((k) => (k.id === oldId ? { id: newId, title } : k));
                this.parsedCache.delete(r.qid);
                n++;
            }
        }
        if (n > 0) this.markDirty();
        return n;
    }

    /** 某知识文档的相关题目（引用落在该文档下的记录；反查入口用）。
     *  kpRoots 由调用方查好（kp 块 id → 所在文档 id）。 */
    async questionsRelatedToDoc(
        docId: string,
        kpRoots: Map<string, string>
    ): Promise<{ qid: string; stem: string; attempts: number; wrongCount: number }[]> {
        const data = await this.all();
        const out: { qid: string; stem: string; attempts: number; wrongCount: number }[] = [];
        for (const r of Object.values(data.records)) {
            const hit = r.sourceDocId === docId || r.kpRefs.some((k) => kpRoots.get(k.id) === docId);
            if (!hit) continue;
            const parsed =
                this.parsedCache.get(r.qid)?.hash === r.hash
                    ? this.parsedCache.get(r.qid)!.parsed
                    : parseQuestionKramdown(r.kramdown, r.qid);
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
    async recordsByKeys(keys: string[]): Promise<BankRecord[]> {
        const data = await this.all();
        const set = new Set(keys.map(normKn));
        return Object.values(data.records).filter(
            (r) =>
                r.kpRefs.some((k) => set.has(`kp:${k.id}`)) ||
                (r.knowledge && set.has(knKey(r.knowledge))) ||
                (r.chapter && set.has(`ch:${r.chapter}`))
        );
    }

    /** 某源卷的全部题记录（变式重练取模板用，按 qid 稳定序）。 */
    async recordsOfDoc(docId: string): Promise<BankRecord[]> {
        const data = await this.all();
        return Object.values(data.records)
            .filter((r) => r.sourceDocId === docId)
            .sort((a, b) => a.qid.localeCompare(b.qid));
    }

    /** 生成的新题入库（针对性练习；qid 自分配，来源标记 gen）。 */
    async addGenerated(kd: string, kpRefs: { id: string; title: string }[], title: string): Promise<string> {
        const data = await this.all();
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
        this.markDirty();
        return qid;
    }

    /** 生成专题若无则建（针对性练习收集容器）。 */
    async ensureCollection(title: string): Promise<void> {
        const data = await this.all();
        if (!data.collections.some((c) => c.title === title)) {
            data.collections.push({
                id: `col-${Date.now().toString(36)}`,
                title,
                qids: [],
                origin: "manual",
                createdAt: Date.now(),
            });
            this.markDirty();
        }
    }

    /** 把题目挂进指定标题的专题。 */
    async appendToCollection(title: string, qid: string): Promise<void> {
        const data = await this.all();
        const col = data.collections.find((c) => c.title === title);
        if (col && !col.qids.includes(qid)) {
            col.qids.push(qid);
            this.markDirty();
        }
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

/** 传入聚合键归一：kn: 键的词干化（新旧键都能与 knKey 产出对齐）；
 *  kp:/ch: 键原样透传。 */
function normKn(key: string): string {
    return key.startsWith("kn:") ? knKey(key.slice(3)) || key : key;
}
