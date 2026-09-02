import { parseQuestionKramdown } from "./BankParse";
import type { ParsedQuestion } from "./BankParse";
import type { BankKnowTree } from "./KnowTrees";
import { knKey, pickStandardName } from "./KnowledgeNorm";
import { notifyError } from "../../ui/Notify";

/**
 * 插件题库（saveData("bank")）：题目以「容器超级块 kramdown 原文」为
 * 主记录；20260903 起题目内容唯一真相在题库——转换产物直写（SetWriter），
 * 题集/材料/知识树都是库内实体（BankSets/KnowTrees）。跨卷同题索引：
 * 内容指纹→首条 qid；落盘按脏标记防抖（千级记录 JSON 整写不能每次作答写）。
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
    /** 所属题集 id（20260903 起题集=bank 内实体；存量记录此值是旧习题
     *  文档 id，语义等价沿用，历史/docStats 键因此不断）。 */
    sourceDocId: string;
    hash: string;
    stats: BankStats;
    /** 所属材料块 id（阅读/完形等共享原文；bank.materials 的键）。 */
    group?: string;
    /** 源块稳定边界键（增量重转换三态分类；键格式冻结不变）。 */
    srcKey?: string;
    /** 源块内容指纹（同 questionHash 归一口径）。 */
    srcHash?: string;
    /** 源已更新但用户保留旧题的标记（增量重转换「保留」动作）。 */
    srcStale?: "1";
}

/** 一个题集（20260903 起转换不再落文档，题集是题库内一等实体）：有序
 *  题单 + 展示元数据 + 源讲义配对（重新导入门控用）。 */
export interface BankSet {
    id: string;
    /** 题集名（=源文档标题；存量推导题集尽力从旧文档读一次）。 */
    title: string;
    /** 源文档标题路径（侧栏树分组用）。 */
    hPath?: string;
    /** 源讲义文档 id（「重新导入」按它重切源块）。 */
    srcId?: string;
    /** 题目 id 的有序集合（转换写入序=原卷题序）。 */
    qids: string[];
    createdAt: number;
}

/** 材料块正文（阅读/完形等共享原文；20260903 起随题入库，不再依赖
 *  文档块回捞）。 */
export interface BankMaterial {
    id: string;
    /** 所属题集 id。 */
    setId: string;
    bodyMd?: string;
    transMd?: string;
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
    /** 已停用（20260902「删除」按钮移除，字段按数据演进守则保留兼容
     *  存量数据；不再读写，存量隐藏行重新出现在面板）。 */
    knowHidden: string[];
    /** 文档级累计刷题用时（秒，原 total-time 块属性自托管）。 */
    docStats: Record<string, number>;
    /** 镜像漂移登记（20260903 起停写——题库即唯一内容真相，无镜像
     *  可漂移；字段按守则保留兼容存量）。 */
    driftDocs?: Record<string, DriftEntry>;
    /** 题集（20260903 起）：id → 集元数据；存量由 ensureSets 推导补齐。 */
    sets?: Record<string, BankSet>;
    /** 材料块正文（20260903 起）：id → 材料内容；缺省为空对象。 */
    materials?: Record<string, BankMaterial>;
    /** AI 知识树（20260903 起不落文档）：源章节文档 id → 归纳大纲。 */
    knowTrees?: Record<string, BankKnowTree>;
}

/** 一个习题文档的镜像漂移摘要（历史结构，20260903 起停写，存量兼容）。 */
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
    /** 版本闩（数据演进守则，见 AGENTS.md）：盘上 version 大于本版已知
     *  （1）= 更新版插件写的题库——本版不识别其形态，内存按空起步但
     *  拒绝一切落盘，防两机插件版本错位时旧版覆写清库。 */
    private foreign?: boolean;
    private flushTimer?: number;
    private readonly parsedCache = new Map<string, { hash: string; parsed: ParsedQuestion }>();

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (v: BankData) => Promise<unknown>
    ) {}

    /** 取缓存数据（装载/落盘/友元模块共用；读异常上抛不落缓存）。 */
    async all(): Promise<BankData> {
        if (this.cache) return this.cache;
        // 只把「读到的东西不是合法题库」当空；**读异常上抛不落缓存**——
        // 原归空后任意 markDirty→flush 会把空 records/collections 覆写
        // 落盘、千级题库静默清零（HistoryStore 同坑 20260828 已修，
        // 20260829 三轮审查补齐本店与 WeaknessStore；loadRaw「文件不
        // 存在」约定返回空串/undefined，进下方三元归空不受影响）
        const data = (await this.loadRaw()) as BankData | "" | null | undefined;
        const ver = data && typeof data === "object" ? (data as { version?: number }).version : undefined;
        if (typeof ver === "number" && ver > 1) {
            // 版本闩：数据来自更新版插件，停写保护（升级后自然解除）
            this.foreign = true;
            notifyError({ key: "notifyStoreForeign", vars: { store: "bank.json" } });
            this.cache = {
                version: 1,
                records: {},
                collections: [],
                migratedDocs: [],
                hashed: {},
                knowRoots: [],
                folders: [],
                knowHidden: [],
                docStats: {},
                sets: {},
                materials: {},
            };
            return this.cache;
        }
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
                      sets: {},
                      materials: {},
                  };
        for (const k of ["knowRoots", "folders", "knowHidden"] as const)
            if (!Array.isArray(this.cache[k])) this.cache[k] = []; // 旧数据补字段
        if (!this.cache.docStats) this.cache.docStats = {};
        if (!this.cache.sets) this.cache.sets = {};
        if (!this.cache.materials) this.cache.materials = {};
        if (!this.cache.knowTrees) this.cache.knowTrees = {};
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
        if (this.foreign) return; // 版本闩：停写保护
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
        if (!this.dirty || !this.cache || this.foreign) return;
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

    /** 删除题集侧数据：全部记录/哈希索引/影子专题/专题引用/迁移标记/
     *  题集元数据与材料（gen- 题不挂 sourceDocId，不受影响）。 */
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
        if (data.sets) delete data.sets[docId];
        if (data.materials) {
            for (const mid of Object.keys(data.materials)) {
                if (data.materials[mid].setId === docId) delete data.materials[mid];
            }
        }
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

    /* ── 解析缓存友元钩子（BankRegen/BankSets 消费） ── */

    /** 命中缓存的解析结果（hash 不符返回 undefined）。 */
    parsedOf(qid: string, hash: string): ParsedQuestion | undefined {
        const hit = this.parsedCache.get(qid);
        return hit && hit.hash === hash ? hit.parsed : undefined;
    }

    /** 解析结果并入缓存。 */
    cacheParsed(qid: string, hash: string, parsed: ParsedQuestion): void {
        this.parsedCache.set(qid, { hash, parsed });
    }

    /** 失效一题的解析缓存（kramdown 被替换/重挂后）。 */
    invalidateParse(qid: string): void {
        this.parsedCache.delete(qid);
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
 *  kp:/ch: 键原样透传。（BankRegen 的 recordsByKeys 同口径共用） */
export function normKn(key: string): string {
    return key.startsWith("kn:") ? knKey(key.slice(3)) || key : key;
}
