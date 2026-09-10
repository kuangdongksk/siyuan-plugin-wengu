/**
 * 知识点同义词表（20260910，Issue #3）：文本关联（linkBankByText）只在
 * 归一后**精确相等**时挂引用（宁漏勿错），跨语言/换写法的同一考点
 * （「洛必达」↔「L'Hôpital 法则」↔「洛必达法则」）漏挂。本模块是
 * **归一链前置的一层**（不是并行体系）：原文 → 查同义表（零 AI）→
 * `normalizeKnowledge` 剥命名性后缀 → 精确相等。查表得到规范词后
 * 继续走既有归一链，短名/长名就此对齐。
 *
 * **AI 判定只跑一次**：未命中的词对按批发给 AI（prompts/synonyms.ts
 * 批量协议，复用 prompts/route.ts 的编号行风格），判定结果**落表**；
 * 同一对词第二次出现查表即命中，零 AI 调用。
 *
 * 失效口径：表**不参与** RouteCache 的索引代数（routeKnowledgeBatchCached
 * 的缓存键 `modelId|题指纹` 是纯题面指纹，本表插在路由之前、只决定
 * 「路由后是否采纳命中」，改了表不会让存量路由答案失真——详见 PR 结论）。
 * 表本身按词条带 `at` 时间戳，`clear()` 一键重置。
 *
 * 存储放 saveData("know-synonyms")：纯派生数据可重建（丢=少数词对重问
 * 一次 AI），读异常归空表；落盘串行链防并发 saveData 互吞（同仓库
 * 其余存储店模式）。
 */

/** 同义词表存储（saveData("know-synonyms")）。 */
export interface KnowSynonymsData {
    version: 1;
    /** 查表键（归一化原文）→ 词条。 */
    entries: Record<string, KnowSynonymEntry>;
}

/** 一个已判定的词对。 */
export interface KnowSynonymEntry {
    /** 查表键：`synKey(raw)` 的输出。 */
    key: string;
    /** 原始写法（展示用；UI 显示「原词 → 规范词」）。 */
    raw: string;
    /** 规范词（AI 给出的清单内写法，或手工修正值）。 */
    canonical: string;
    /** 判定来源。 */
    source: "ai" | "manual";
    /** 写入时间（毫秒时间戳）。 */
    at: number;
}

/** 查表键归一：剥装饰（空白/书名号/引号/尾「的」）并**小写化**——
 *  拉丁词大小写不影响等价（"l'hôpital" / "L'Hôpital"）。只做键、不
 *  动数据；`KnowledgeNorm` 的剥后缀继续在键之后。 */
export function synKey(raw: string): string {
    return raw
        .trim()
        .replace(/[\s　]+/g, "")
        .replace(/^[《「『"'【\[（(]+|[》」』"'】\]）)]+$/g, "")
        .replace(/的$/, "")
        .toLowerCase();
}

/** 已判定对的判定结果：同义（canonical 同义词） / 不同义（记空串，
 *  防止同一对词每轮重问 AI）。 */
export function canonicalOf(data: KnowSynonymsData, raw: string): string | undefined {
    return data.entries[synKey(raw)]?.canonical;
}

/** 查表 → 归一链（纯函数）：同义表命中的规范词先替换，再走 `stem`
 *  （`KnowledgeNorm.normalizeKnowledge` 剥后缀）。未命中=原词归一。
 *  canonical 为空串（AI 判非同义）时原词归一——词表匹配照旧走既有
 *  精确口径，不额外拦（拦了会改变现有 textRefsFor 行为）。 */
export function synonymNormalize(raw: string, data: KnowSynonymsData, stem: (s: string) => string): string {
    const canonical = canonicalOf(data, raw);
    return stem(canonical ? canonical : raw);
}

export class KnowSynonymsStore {
    private data?: KnowSynonymsData;
    private loading?: Promise<KnowSynonymsData>;
    private dirty = false;
    /** 串行落盘链（同 KnowHash/RouteCache 模式）：并发 saveData 撞
     *  「内核 fetchSyncPost 并发互吞响应」会静默丢最后一份。 */
    private saveChain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (v: KnowSynonymsData) => Promise<unknown>
    ) {}

    private async table(): Promise<KnowSynonymsData> {
        if (this.data) return this.data;
        if (!this.loading) {
            this.loading = this.loadRaw()
                .then((raw) => {
                    // 纯派生可丢：读异常/形态不对一律归空表（覆写最坏代价
                    // 只是少数词对重问一次 AI）
                    this.data =
                        raw && typeof raw === "object" && (raw as KnowSynonymsData).entries
                            ? (raw as KnowSynonymsData)
                            : { version: 1, entries: {} };
                    return this.data;
                })
                .catch(() => {
                    this.data = { version: 1, entries: {} };
                    return this.data;
                })
                .finally(() => (this.loading = undefined));
        }
        return this.loading;
    }

    /** 全表快照（UI 展示；按写入时间倒序）。 */
    async list(): Promise<KnowSynonymEntry[]> {
        const t = await this.table();
        return Object.values(t.entries).sort((a, b) => b.at - a.at);
    }

    /** 条数（面板角标/通知文案用）。 */
    async size(): Promise<number> {
        return Object.keys((await this.table()).entries).length;
    }

    /** 装载后的表快照（**消费点一律走它**）。`peek` 只看内存，重载后
     *  盘上有表但尚未装载时它是空表——文本层据此查表就会漏掉存量判定，
     *  同一对词被重新问一遍 AI（Issue #3 审查修复：装载时序）。 */
    async snapshot(): Promise<KnowSynonymsData> {
        return this.table();
    }

    /** 同步窥视（未装载=空表；只作纯函数兜底的便利入口）。 */
    peek(): KnowSynonymsData {
        return this.data ?? { version: 1, entries: {} };
    }

    /** 写入一条判定（覆盖语义：同词对以最后一次为准）。 */
    async put(raw: string, canonical: string, source: "ai" | "manual" = "ai"): Promise<void> {
        const key = synKey(raw);
        if (!key) return;
        const t = await this.table();
        t.entries[key] = { key, raw: raw.trim(), canonical: canonical.trim(), source, at: Date.now() };
        this.dirty = true;
    }

    /** 批量写入（一轮 AI 判定收口）：一次 table() 一次 markDirty。 */
    async putMany(pairs: { raw: string; canonical: string }[], source: "ai" | "manual" = "ai"): Promise<void> {
        const t = await this.table();
        let touched = false;
        for (const p of pairs) {
            const key = synKey(p.raw);
            if (!key) continue;
            t.entries[key] = { key, raw: p.raw.trim(), canonical: p.canonical.trim(), source, at: Date.now() };
            touched = true;
        }
        if (touched) this.dirty = true;
    }

    /** 清空全表（UI「清空」入口；清空后词对需重新过 AI 判定）。 */
    async clear(): Promise<void> {
        const t = await this.table();
        t.entries = {};
        this.dirty = true;
        await this.flush();
    }

    /** 落盘（脏了才写；串行链）。 */
    async flush(): Promise<void> {
        if (!this.dirty || !this.data) return;
        const snap = this.data;
        this.dirty = false;
        const noop = (): void => undefined;
        const run = this.saveChain.then(() => this.saveRaw(snap));
        this.saveChain = run.then(noop, noop);
        await run.then(noop, noop);
    }
}

/** 模块级单例（index.ts onload 注入内核 IO；未初始化=测试环境，
 *  textRefsOf 自动退回纯 knKey 口径，零副作用）。 */
let instance: KnowSynonymsStore | undefined;

/** 插件装载时接线。顺带预热一次装载（表小、调用廉价）：文本关联在
 *  用户点「导入文档」时同步查表，预热把「首个消费点早于装载」这个竞态
 *  压到最小；真正的消费点仍走 {@link loadSynonyms} 等装载完成。 */
export function initKnowSynonyms(io: {
    load: () => Promise<unknown>;
    save: (v: KnowSynonymsData) => Promise<unknown>;
}): KnowSynonymsStore {
    instance = new KnowSynonymsStore(io.load, io.save);
    void instance.snapshot();
    return instance;
}

/** 取共享单例（弹窗/面板入口）。 */
export function knowSynonyms(): KnowSynonymsStore | undefined {
    return instance;
}

/** 装载后的单例表数据（异步消费点用；未接线/装载失败=空表，零副作用）。 */
export async function loadSynonyms(): Promise<KnowSynonymsData> {
    if (!instance) return { version: 1, entries: {} };
    return instance.snapshot();
}

/** 同步窥视单例数据（只作纯函数兜底；别用它做「表里有没有」的判断，
 *  未装载时一律是空表——见 {@link loadSynonyms}）。 */
export function peekSynonyms(): KnowSynonymsData {
    return instance?.peek() ?? { version: 1, entries: {} };
}
