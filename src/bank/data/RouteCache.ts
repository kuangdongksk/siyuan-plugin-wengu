import { routeKnowledgeDiag, type KnowRouteFail, type KnowledgeIndex } from "../../convert/service/KnowledgeLink";
import { questionHash } from "./BankParse";

/**
 * 路由结果按题哈希缓存（增量哈希一期，docs/incremental-hash-plan.md §二）：
 * 两级路由（章+小节）每题两次 AI 调用，MatchDialog/BatchLinkDialog/
 * TagDialog 重跑同一题时索引与模型没变、路由结果也不会变——按路由输入
 * 的内容指纹缓存命中小节，命中即零 AI 调用。
 *
 * 失效口径宁漏勿错：索引代数指纹覆盖全部章/小节的 id+path（增删章、
 * 改小节、退册根都必改变指纹）→ 整表作废重建，不复用过期路由；AI
 * 调用失败（超时/网络/模型失效）不缓存——只缓存完整跑完的结果，
 * AI 明确判「零命中」的空结果也是有效答案，照缓存。
 *
 * 存储放 saveData("route-cache")：纯缓存可丢（读异常归空表无损），LRU
 * 上限 {@link ROUTE_CACHE_CAP} 条；put 只进内存，一轮跑完 flush 落盘
 * （与题库 markDirty/flush 同节奏）。
 */

/** 缓存容量上限（LRU，超出按最久未用淘汰）。 */
export const ROUTE_CACHE_CAP = 2000;

/** 插件存储（saveData("route-cache")）里的路由缓存。 */
export interface RouteCacheData {
    version: 1;
    /** 索引结构指纹（不符即整表作废，见类注释）。 */
    indexGen: string;
    /** `${modelId}|${题指纹}` → 命中小节（[] = AI 明确判零命中）。 */
    entries: Record<string, { id: string; title: string }[]>;
}

/** 索引代数指纹：全部章节 docId+path 与小节 id+path 拼接后过
 *  questionHash——结构级变更（增删/改名/移动章或小节）必改变指纹。
 *  根集合不需要单独进指纹：根决定章集合，章 docId 已覆盖。纯函数。 */
export function indexGenOf(index: KnowledgeIndex): string {
    const parts: string[] = [];
    for (const c of index.chapters) {
        parts.push(`C|${c.docId}|${c.path}`);
        for (const s of c.sections) parts.push(`S|${s.id}|${s.path}`);
    }
    return questionHash(parts.join("\n"));
}

export class RouteCache {
    private data?: RouteCacheData;
    private loading?: Promise<RouteCacheData>;
    private dirty = false;
    /** 串行落盘链（同 HistoryStore 模式）：并发 saveData 撞「内核
     *  fetchSyncPost 并发互吞响应」会静默丢最后一份。 */
    private saveChain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (v: RouteCacheData) => Promise<unknown>
    ) {}

    private async table(): Promise<RouteCacheData> {
        if (this.data) return this.data;
        // in-flight 备忘：并发首载各自 loadRaw 后赋 data 会互相覆盖
        if (!this.loading) {
            this.loading = this.loadRaw()
                .then((raw) => {
                    // 纯缓存可丢：读异常/形态不对一律归空表（区别于历史库
                    // 的「读异常上抛」——这里覆写最坏代价只是重花 AI 调用）
                    this.data =
                        raw && typeof raw === "object" && typeof (raw as RouteCacheData).indexGen === "string"
                            ? (raw as RouteCacheData)
                            : { version: 1, indexGen: "", entries: {} };
                    return this.data;
                })
                .catch(() => {
                    this.data = { version: 1, indexGen: "", entries: {} };
                    return this.data;
                })
                .finally(() => (this.loading = undefined));
        }
        return this.loading;
    }

    /** 查缓存。代数不符先整表作废；命中刷新 LRU 时序。返回 undefined=
     *  未命中（照常路由）；数组（含空）=缓存答案。 */
    async get(key: string, indexGen: string): Promise<{ id: string; title: string }[] | undefined> {
        const t = await this.table();
        if (t.indexGen !== indexGen) {
            t.indexGen = indexGen;
            t.entries = {};
            this.dirty = true;
            return undefined;
        }
        const hit = t.entries[key];
        if (!hit) return undefined;
        // 删掉重插=移到最近使用（Record 保插入序）
        delete t.entries[key];
        t.entries[key] = hit;
        return hit.map((x) => ({ ...x }));
    }

    /** 写缓存。代数不符：空表（含首用）直接采纳新代；非空=旧代残留，
     *  本结果丢弃（get 会先整表作废，正常流程走不到这里）。 */
    async put(key: string, indexGen: string, refs: { id: string; title: string }[]): Promise<void> {
        const t = await this.table();
        if (t.indexGen !== indexGen) {
            if (Object.keys(t.entries).length > 0) return;
            t.indexGen = indexGen;
        }
        delete t.entries[key]; // 覆盖旧值时同步刷新时序
        t.entries[key] = refs.map((x) => ({ ...x }));
        const keys = Object.keys(t.entries);
        if (keys.length > ROUTE_CACHE_CAP) {
            for (const k of keys.slice(0, keys.length - ROUTE_CACHE_CAP)) delete t.entries[k];
        }
        this.dirty = true;
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
 *  routeKnowledgeCached 自动裸跑不缓存）。 */
let instance: RouteCache | undefined;

/** 插件装载时接线。 */
export function initRouteCache(io: {
    load: () => Promise<unknown>;
    save: (v: RouteCacheData) => Promise<unknown>;
}): RouteCache {
    instance = new RouteCache(io.load, io.save);
    return instance;
}

/** 取共享缓存单例（弹窗侧入口）。 */
export function routeCache(): RouteCache | undefined {
    return instance;
}

/**
 * 带缓存的两级路由（三弹窗共用）：命中零 AI 调用；未命中照常
 * routeKnowledgeDiag，完整跑完（含判零命中）才写缓存。返回小节引用
 * 列表（空=无命中）。onFail 语义与裸路由一致（AI 调用失败上报，
 * 失败结果不缓存，下次重跑再试）。
 */
export async function routeKnowledgeCached(opts: {
    text: string;
    index: KnowledgeIndex;
    modelId: string;
    call: (m: string) => Promise<string>;
    onFail?: (f: KnowRouteFail) => void;
}): Promise<{ id: string; title: string }[]> {
    const c = routeCache();
    const gen = indexGenOf(opts.index);
    const key = `${opts.modelId}|${questionHash(opts.text)}`;
    if (c) {
        const hit = await c.get(key, gen);
        if (hit) return hit;
    }
    let failed = false;
    const routed = await routeKnowledgeDiag(opts.text, opts.index, { call: opts.call }, (f) => {
        failed = true; // 失败结果不缓存
        opts.onFail?.(f);
    });
    const refs = [...routed.values()].map((s) => ({ id: s.id, title: s.title }));
    if (c && !failed) await c.put(key, gen, refs);
    return refs;
}
