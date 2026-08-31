import { KernelQuery } from "../../siyuan/query";
import { questionHash } from "./BankParse";

/**
 * 知识小节内容哈希（数据自托管三期，20260831）：每个小节（标题块）按
 * 「包含式切段」记一份内容指纹——标题自身与其全部后代块（直到下一
 * 同级/更高级标题）的 content 归属该段；改小节正文/子标题，该节与全部
 * 祖先节指纹皆变。三个消费点：
 * - 知识面板 load：diffDocs 比对基线出 stale 徽标（一次性提示，比对后
 *   基线自推进——重开面板不再报，避免「用户没重关联就永远亮」死循环）；
 * - 导入/批量关联完成：baselineDocs 写基线；
 * - RouteCache.indexGenOf：小节内容哈希进索引代数指纹（小节正文变了
 *   路由缓存整表作废，宁漏勿错——ws-main update 链顺路 refreshDoc
 *   保表新鲜，见 index.ts 对账回调）。
 *
 * 存储放 saveData("know-hash")：基线可重建（丢=一次提示机会损失，无
 * 数据损失），读异常归空表。归一口径=questionHash（全局约束，
 * docs/incremental-hash-plan.md §三）。
 */

/** 小节哈希表（saveData("know-hash")）。 */
export interface KnowHashData {
    version: 1;
    /** 标题块 id → 段内容指纹。 */
    secs: Record<string, { hash: string; updatedAt: number }>;
    /** 文档 id → 登记根 id（ws-main update 事务反查「这个文档归哪个根」）。 */
    docRoots: Record<string, string>;
}

/** 文档块行（切段输入；按 sort 序传入）。 */
export interface SecBlock {
    id: string;
    type?: string;
    subtype?: string;
    content?: string;
}

/** 包含式切段哈希（纯函数）：每块 content 归属栈中全部祖先标题段，
 * 标题自身 content 也进自己的段。无标题文档返回空表。 */
export function sectionHashesOfDoc(blocks: SecBlock[]): Map<string, string> {
    const buf = new Map<string, string[]>();
    const stack: { level: number; id: string }[] = [];
    for (const b of blocks) {
        if (b.type === "h" && /^h[1-6]$/.test(b.subtype ?? "")) {
            const level = Number(b.subtype!.slice(1));
            while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
            stack.push({ level, id: b.id });
        }
        const text = (b.content ?? "").trim();
        if (!text || stack.length === 0) continue;
        for (const s of stack) {
            const arr = buf.get(s.id) ?? [];
            arr.push(text);
            buf.set(s.id, arr);
        }
    }
    const out = new Map<string, string>();
    for (const [id, parts] of buf) out.set(id, questionHash(parts.join("\n")));
    return out;
}

/** 拉一个文档的全部块并切段哈希（rowsMapAll 自动分页；按 sort 序）。 */
async function docSectionHashes(docId: string): Promise<Map<string, string>> {
    const rows = await KernelQuery.rowsMapAll(
        `SELECT id, type, subtype, content FROM blocks WHERE root_id = '${docId}' ORDER BY sort`
    );
    return sectionHashesOfDoc(
        rows.map((r) => ({
            id: r.get("id"),
            type: r.get("type"),
            subtype: r.get("subtype"),
            content: r.get("content"),
        }))
    );
}

export class KnowHashStore {
    private data?: KnowHashData;
    private dirty = false;
    private saveChain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (v: KnowHashData) => Promise<unknown>
    ) {}

    private async table(): Promise<KnowHashData> {
        if (this.data) return this.data;
        const raw = (await this.loadRaw().catch((): undefined => undefined)) as KnowHashData | "" | null | undefined;
        this.data =
            raw && typeof raw === "object" && raw.secs
                ? { version: 1, secs: raw.secs, docRoots: raw.docRoots ?? {} }
                : { version: 1, secs: {}, docRoots: {} };
        return this.data;
    }

    /** 同步窥视（RouteCache 代数指纹拼接用；未加载=空表）。 */
    peekHashes(): Map<string, string> {
        const out = new Map<string, string>();
        for (const [k, v] of Object.entries(this.data?.secs ?? {})) out.set(k, v.hash);
        return out;
    }

    /** 写基线（导入根/批量关联收尾）：rootId 登记进 docRoots。 */
    async baselineDocs(rootId: string, docIds: string[]): Promise<void> {
        const t = await this.table();
        for (const docId of docIds) {
            t.docRoots[docId] = rootId;
            try {
                for (const [secId, hash] of await docSectionHashes(docId)) {
                    t.secs[secId] = { hash, updatedAt: Date.now() };
                }
            } catch (_) {
                // 单文档失败保留旧基线，下次刷新再试
            }
        }
        this.dirty = true;
        await this.flush();
    }

    /** ws-main update 事务顺路刷新：该文档已登记过基线才重算（未登记
     *  的文档不在知识域，零成本跳过）。 */
    async refreshDoc(docId: string): Promise<void> {
        const t = await this.table();
        const rootId = t.docRoots[docId];
        if (!rootId) return;
        await this.baselineDocs(rootId, [docId]);
    }

    /** 比对基线出 stale 小节集合，随后基线自推进到现状（一次性提示：
     *  新哈希落表，重开面板不再报；无基线的小节=新标题，不算 stale）。 */
    async diffDocs(docIds: string[]): Promise<Set<string>> {
        const t = await this.table();
        const stale = new Set<string>();
        for (const docId of docIds) {
            let now: Map<string, string>;
            try {
                now = await docSectionHashes(docId);
            } catch (_) {
                continue;
            }
            for (const [secId, hash] of now) {
                const base = t.secs[secId];
                if (base && base.hash !== hash) stale.add(secId);
                if (!base || base.hash !== hash) {
                    t.secs[secId] = { hash, updatedAt: Date.now() };
                    this.dirty = true;
                }
            }
        }
        await this.flush();
        return stale;
    }

    /** 落盘（脏了才写；串行链防并发 saveData 互吞）。 */
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

/** 模块级单例（index.ts onload 注入内核 IO；未初始化=测试环境自动跳过）。 */
let instance: KnowHashStore | undefined;

/** 插件装载时接线。 */
export function initKnowHash(io: {
    load: () => Promise<unknown>;
    save: (v: KnowHashData) => Promise<unknown>;
}): KnowHashStore {
    instance = new KnowHashStore(io.load, io.save);
    return instance;
}

/** 取共享单例（面板/弹窗/对账链入口）。 */
export function knowHash(): KnowHashStore | undefined {
    return instance;
}
