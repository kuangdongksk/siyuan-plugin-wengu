import { KernelQuery } from "../../siyuan/query";
import { KernelBlock } from "../../siyuan/block";
import { errText, isLifecycleGone } from "../../ui/shared";
import { notifyError } from "../../ui/Notify";

/**
 * 知识索引快照（Issue #39，20260912）：登记根的文档标题树**一次性捕获**
 * 进本店（saveData("know-index")），此后面板/路由/词表装载全读快照——
 * **零内核 SQL**。捕获是唯一标题查询场景（懒捕获：装载遇快照缺根 →
 * 现场捕获并落库，存量登记根零用户动作）。
 *
 * 快照即**全量原始树**（不引入确定性过滤、不加 filtered 清单）：被 AI
 * 索引滤掉的题干/例题/空壳噪音天然可从快照找回；节点 id=**真实标题块
 * id**（源指针），天然兼容四条外键链（kpRefs 往返、col-kp-{id}、
 * kp:{id}、route-cache）——零迁移零悬空。
 *
 * 树形与 buildSectionTree 的就近挂靠口径一致（h1~h6 按级别挂前方最近的
 * 更高级标题；捕获后现场装载不再建树）。**落库即冻结**：节点 id 是源块
 * id，捕获只读内核、零 AI。
 *
 * 数据演进：新店上线即配版本闩（装载遇未来 version 拒写），字段只加
 * 不改名不删。
 */

/** 快照节点（id=真实标题块 id）。 */
export interface KnowIndexNode {
    id: string;
    title: string;
    children: KnowIndexNode[];
}

/** 一个文档的标题树快照。 */
export interface KnowIndexDoc {
    docId: string;
    title: string;
    hPath: string;
    children: KnowIndexNode[];
}

/** 一个登记根的捕获结果。 */
export interface KnowIndexRoot {
    capturedAt: number;
    docs: KnowIndexDoc[];
}

/** 快照店（saveData("know-index")）。 */
export interface KnowIndexData {
    version: 1;
    roots: Record<string, KnowIndexRoot>;
}

/** 空快照（读异常/未装载归空）。 */
export function emptyKnowIndex(): KnowIndexData {
    return { version: 1, roots: {} };
}

/** 本版已知的存储版本（装载遇更大值 = 未来版本，拒写）。 */
const KNOWN_VERSION = 1;

/** SQL 查询（工厂 rowsMap：code!==0 抛错由调用方降级）。 */
const sql = KernelQuery.rowsMap;

/** rowsMap 行（KernelQuery 工厂的 Map 行别名）。 */
type KnowRow = Map<string, string>;

/** 根块行 + 其全部后代文档行（同笔记本递归 path LIKE，含书/章中间层）。
 *  根非文档/已删/SQL 失败返回 null，调用方各自降级。 */
async function knowDocRows(rootId: string): Promise<{ root: KnowRow; rows: KnowRow[] } | null> {
    let root: KnowRow | undefined;
    try {
        root = (
            await sql(`SELECT id, box, path, content, hpath FROM blocks WHERE id = '${rootId}' AND type = 'd' LIMIT 1`)
        )[0];
    } catch (_) {
        return null;
    }
    if (!root?.get("box")) return null;
    const dir = root.get("path").replace(/\.sy$/, "");
    const rows = await KernelQuery.rowsMapAll(
        `SELECT id, path, content, hpath FROM blocks WHERE type = 'd' AND box = '${root.get(
            "box"
        )}' AND path LIKE '${dir}/%.sy' ORDER BY hpath`
    );
    return { root, rows };
}

/** 批量拉文档的 h1~h6 标题块（按 root_id 分组；逐文档以 KernelBlock.docOrder
 *  回排成真文档序——SQL 的 ORDER BY sort 在导入语料上是任意顺序，乱序会让
 *  子标题先于父标题到达、就近挂靠后层级塌平）。 */
async function headingsByRoot(
    docIds: string[]
): Promise<Map<string, { id: string; content: string; level: number }[]>> {
    const byRoot = new Map<string, { id: string; content: string; level: number }[]>();
    if (docIds.length === 0) return byRoot;
    const ids = docIds.map((x) => `'${x}'`).join(",");
    for (const h of await KernelQuery.rowsMapAll(
        `SELECT root_id, id, content, subtype FROM blocks WHERE type = 'h' AND subtype IN ('h1','h2','h3','h4','h5','h6') AND root_id IN (${ids}) ORDER BY root_id, sort`
    )) {
        const k = h.get("root_id");
        const arr = byRoot.get(k) ?? [];
        arr.push({
            id: h.get("id"),
            content: h.get("content"),
            level: Number(h.get("subtype")?.replace("h", "")) || 1,
        });
        byRoot.set(k, arr);
    }
    for (const [docId, arr] of byRoot) {
        const order = await KernelBlock.docOrder(docId);
        const pos = (id: string): number => order.get(id) ?? Number.MAX_SAFE_INTEGER;
        arr.sort((a, b) => pos(a.id) - pos(b.id));
    }
    return byRoot;
}

/** 平铺标题列表 → 嵌套快照树（纯函数）：与 buildSectionTree 的就近挂靠
 *  口径逐字一致（h1~h6 按级别挂前方最近的更高级标题；跳级照常收编为
 *  子级）。导出供单测。 */
export function nestHeads(heads: { id: string; title: string; level: number }[]): KnowIndexNode[] {
    const roots: KnowIndexNode[] = [];
    /** 各级别最近一个节点（栈式：新同级顶替、更深级清空）。 */
    const last: (KnowIndexNode | undefined)[] = [];
    for (const h of heads) {
        const node: KnowIndexNode = { id: h.id, title: h.title, children: [] };
        last[h.level] = node;
        for (let lv = h.level + 1; lv < last.length; lv++) last[lv] = undefined;
        let parent: KnowIndexNode | undefined;
        for (let lv = h.level - 1; lv >= 1; lv--) {
            if (last[lv]) {
                parent = last[lv];
                break;
            }
        }
        (parent ? parent.children : roots).push(node);
    }
    return roots;
}

/** 捕获一个登记根的文档标题树（唯一标题查询场景）。根查无/SQL 失败返回
 *  null（调用方降级为「本次装载无此根」，不误写空快照）。 */
export async function captureRoot(rootId: string): Promise<KnowIndexRoot | null> {
    const hit = await knowDocRows(rootId);
    if (!hit) return null;
    const docs = [hit.root, ...hit.rows];
    const byRoot = await headingsByRoot(docs.map((d) => d.get("id")));
    return {
        capturedAt: Date.now(),
        docs: docs.map((d) => ({
            docId: d.get("id"),
            title: d.get("content") || d.get("hpath") || d.get("id"),
            hPath: d.get("hpath") ?? "",
            children: nestHeads(
                (byRoot.get(d.get("id")) ?? []).map((h) => ({ id: h.id, title: h.content, level: h.level }))
            ),
        })),
    };
}

/** 快照里某文档的章节标题（叶子文档判定用：有后代文档即非叶子）。 */
export function leafDocsOf(root: KnowIndexRoot): KnowIndexDoc[] {
    const dirs = new Set<string>();
    for (const d of root.docs) {
        const p = d.hPath ?? "";
        const i = p.lastIndexOf("/");
        if (i > 0) dirs.add(p.slice(0, i));
    }
    const leaves = root.docs.filter((d) => !dirs.has(d.hPath ?? ""));
    return leaves.length > 0 ? leaves : root.docs.length > 0 ? [root.docs[0]] : [];
}

/** 快照店：懒捕获 + 版本闩 + 串行落盘。 */
export class KnowIndexStore {
    private data?: KnowIndexData;
    private loading?: Promise<KnowIndexData>;
    private dirty = false;
    /** 版本闩：装载遇未来 version → 内存按空起步 + 拒绝一切落盘。 */
    private foreign = false;
    /** 串行落盘链（同 KnowHash/RouteCache 模式）：并发 saveData 撞「内核
     *  fetchSyncPost 并发互吞响应」会静默丢最后一份。 */
    private saveChain: Promise<unknown> = Promise.resolve();
    /** 同一根的捕获单飞（并发装载同根只捕获一次）。 */
    private capturing = new Map<string, Promise<KnowIndexRoot | null>>();

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (v: KnowIndexData) => Promise<unknown>
    ) {}

    private async table(): Promise<KnowIndexData> {
        if (this.data) return this.data;
        if (!this.loading) {
            this.loading = this.loadRaw()
                .then((raw) => {
                    const r = raw as KnowIndexData | "" | null | undefined;
                    if (r && typeof r === "object" && typeof r.version === "number" && r.version > KNOWN_VERSION) {
                        // 版本闩：未来版本写盘格式未知，读成空 + 拒写（防覆写清库）
                        this.foreign = true;
                        this.data = emptyKnowIndex();
                        notifyError({ key: "notifyStoreForeign", vars: { store: "know-index" } });
                        return this.data;
                    }
                    this.data =
                        r && typeof r === "object" && r.roots && typeof r.roots === "object" ? r : emptyKnowIndex();
                    return this.data;
                })
                .catch(() => {
                    this.data = emptyKnowIndex();
                    return this.data;
                })
                .finally(() => (this.loading = undefined));
        }
        return this.loading;
    }

    /** 是否处于「遇到未来版本」的拒写态。 */
    isForeign(): boolean {
        return this.foreign;
    }

    /** 全表快照（版本闩拒写态下为只读空表）。 */
    async snapshot(): Promise<KnowIndexData> {
        return this.table();
    }

    /** 取某根的快照；缺根且 lazy 时现场捕获并落库（存量登记根零用户
     *  动作）。捕获失败返回 null（调用方降级）。
     *  ⚠️ 返回的是**店内缓存的活引用**（同 QuestionBank.all 口径）：消费点
     *  只读；要改先自己拷一份，别就地改——改了会污染内存快照。 */
    async root(rootId: string): Promise<KnowIndexRoot | null> {
        const t = await this.table();
        const hit = t.roots[rootId];
        if (hit) return hit;
        const running = this.capturing.get(rootId);
        if (running) return running;
        const p = this.capture(rootId);
        this.capturing.set(rootId, p);
        try {
            return await p;
        } finally {
            this.capturing.delete(rootId);
        }
    }

    /** 在**全部已捕获根**里找某文档的快照（AI 索引挂源指针用：归纳的
     *  文档可能只是登记根子树里的后代，不一定是根自身）。零内核查询；
     *  没捕获过就返回 null——别为此扩大捕获面（挂指针是锦上添花，跳源
     *  无 srcId 自会降级跳章文档）。 */
    async findDoc(docId: string): Promise<KnowIndexDoc | null> {
        const t = await this.table();
        for (const root of Object.values(t.roots)) {
            const hit = root.docs.find((d) => d.docId === docId);
            if (hit) return hit;
        }
        return null;
    }

    /** 现场捕获并落库（外部显式「重扫」入口与懒捕获共用）。 */
    private async capture(rootId: string): Promise<KnowIndexRoot | null> {
        const cap = await captureRoot(rootId).catch((): null => null);
        if (!cap) return null;
        await this.put(rootId, cap);
        return cap;
    }

    /** 写入一个根的快照（覆盖语义=重扫）。版本闩拒写态下只更内存不落盘。 */
    async put(rootId: string, root: KnowIndexRoot): Promise<void> {
        const t = await this.table();
        t.roots[rootId] = root;
        this.dirty = true;
        await this.flush();
    }

    /** 显式重扫（面板「重扫」/ staleness 手动刷新）：强制重新捕获。 */
    async rescan(rootId: string): Promise<KnowIndexRoot | null> {
        return this.capture(rootId);
    }

    /** 丢掉某根的快照（退册时清账；纯派生可重建）。 */
    async drop(rootId: string): Promise<void> {
        const t = await this.table();
        if (!t.roots[rootId]) return;
        delete t.roots[rootId];
        this.dirty = true;
        await this.flush();
    }

    /** 落盘（脏了才写；串行链；版本闩拒写）。 */
    async flush(): Promise<void> {
        if (this.foreign || !this.dirty || !this.data) return;
        const snap = this.data;
        this.dirty = false;
        const noop = (): void => undefined;
        const run = this.saveChain.then(() => this.saveRaw(snap));
        this.saveChain = run.then(noop, noop);
        // 生命周期闸（410）：旧实例残骸的预期失败静默，其余记日志不上抛
        await run.then(noop, (e: unknown): void => {
            if (!isLifecycleGone(e)) console.warn("[wengu] 知识索引快照落盘失败", errText(e));
        });
    }
}

/** 模块级单例（index.ts onload 注入内核 IO；未初始化=测试环境）。 */
let instance: KnowIndexStore | undefined;

/** 插件装载时接线。 */
export function initKnowIndex(io: {
    load: () => Promise<unknown>;
    save: (v: KnowIndexData) => Promise<unknown>;
}): KnowIndexStore {
    instance = new KnowIndexStore(io.load, io.save);
    return instance;
}

/** 取共享单例（未接线=undefined）。⚠️ 消费点**没有**现场 SQL 兜底：未
 *  接线时装载归空——插件 onload 必先 initKnowIndex，未接线只出现在测试/
 *  异常环境，此时宁可为空也不偷偷回退打 SQL（捕获是唯一标题查询场景）。 */
export function knowIndex(): KnowIndexStore | undefined {
    return instance;
}
