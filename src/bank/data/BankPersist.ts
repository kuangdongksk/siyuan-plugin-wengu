import type { BankData } from "./QuestionBank";
import { notifyError } from "../../ui/Notify";
import { errText, isLifecycleGone, SaveChain } from "../../ui/shared";

/**
 * 题库落盘链（20260915 自 `QuestionBank` 拆出压 500 行红线，纯结构搬运、
 * 零行为变更）：缓存装载 / 脏标记防抖 / 串行落盘 / 版本闩四件事收在这里，
 * `QuestionBank` 只留领域方法（记录/专题/题集读写），持一份本类的协作
 * 对象——照 `AiSessions`/`HistoryStore`/`RouteCache` 家族模式。
 *
 * 三个不变量**一字未改**：
 *  1. **读异常上抛不落缓存**（`load()` 不 catch：原归空后任意
 *     markDirty→flush 会把空 records/collections 覆写落盘、千级题库
 *     静默清零）；
 *  2. **版本闩**（盘上 version 大于本版已知 → 内存按空起步 + 拒绝一切
 *     落盘，防两机插件版本错位时旧版覆写清库）；
 *  3. **串行落盘链**（`SaveChain`：防抖 flush 与关键节点直调 flush 可
 *     并发，两笔 saveData 在途且「先发后落」时盘面会短暂回退旧态）。
 */

/** 落盘防抖窗（毫秒）：千级记录 JSON 整写不能每次作答都写。 */
export const SAVE_DEBOUNCE_MS = 2000;

/** 空库起步形态（版本闩停写保护与坏数据归空共用）。 */
export function emptyBankData(): BankData {
    return {
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
}

export class BankPersist {
    private cache?: BankData;
    private dirty = false;
    /** 版本闩（数据演进守则，见 AGENTS.md）：盘上 version 大于本版已知
     *  （1）= 更新版插件写的题库——本版不识别其形态，内存按空起步但
     *  拒绝一切落盘，防两机插件版本错位时旧版覆写清库。 */
    private foreign?: boolean;
    private flushTimer?: number;
    /** 串行落盘链（同 AiSessions/HistoryStore/RouteCache 模式）。链面吞错
     *  保后续可排，错误在本笔 await 侧处理。 */
    private readonly saveChain = new SaveChain();

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (v: BankData) => Promise<unknown>
    ) {}

    /** 取缓存数据（装载/落盘/友元模块共用；读异常上抛不落缓存）。 */
    async load(): Promise<BankData> {
        if (this.cache) return this.cache;
        // 只把「读到的东西不是合法题库」当空；**读异常上抛不落缓存**
        // ——原归空后任意 markDirty→flush 会把空 records/collections 覆写
        // 落盘、千级题库静默清零（HistoryStore 同坑 20260828 已修，
        // 20260829 三轮审查补齐本店与 WeaknessStore；loadRaw「文件不
        // 存在」约定返回空串/undefined，进下方三元归空不受影响）
        const data = (await this.loadRaw()) as BankData | "" | null | undefined;
        const ver = data && typeof data === "object" ? (data as { version?: number }).version : undefined;
        if (typeof ver === "number" && ver > 1) {
            // 版本闩：数据来自更新版插件，停写保护（升级后自然解除）
            this.foreign = true;
            notifyError({ key: "notifyStoreForeign", vars: { store: "bank.json" } });
            this.cache = emptyBankData();
            return this.cache;
        }
        this.cache = data && typeof data === "object" && data.records ? data : emptyBankData();
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
        await this.load();
    }

    /** 已加载缓存的同步窥视（未就绪返回 undefined；UI 快照渲染用）。 */
    peek(): BankData | undefined {
        return this.cache;
    }

    /** 脏标记（供 BankMigrate 友元与领域方法调用）。 */
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
        // 载荷取守卫后的活引用：saveRaw 调用瞬间才序列化，链上排到的每笔
        // 写到的都是「它落笔那一刻」的最新内存态（不快照克隆——千级题库
        // 克隆太贵，且晚笔带更新态正是我们要的次序语义）。
        const cache = this.cache;
        try {
            await this.saveChain.enqueue(() => this.saveRaw(cache));
        } catch (e) {
            // 尽力而为：写失败保留脏标记并重排防抖——原只保留标记不清
            // 定时器，得等下一次 markDirty 才会再试（20260829 审查）；
            // 不再静默：落盘失败走思源通知（Notify 同文案 60s 冷却）。
            // 但 3.8.2 起实例被 dispose（petal 重载/页签销毁竞态）后
            // saveData 永久拒绝 410：旧实例残骸的预期失败，不弹不重排
            // （弹了只是调试重载期的噪音），保留脏标记即止。
            this.dirty = true;
            if (isLifecycleGone(e)) return;
            notifyError({ key: "notifySaveFailBank", vars: { msg: errText(e) } });
            this.flushTimer = window.setTimeout((): void => void this.flush(), SAVE_DEBOUNCE_MS);
        }
    }
}
