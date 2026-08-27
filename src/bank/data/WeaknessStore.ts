import { parseKpRefs } from "./BankParse";
import type { WenguSession } from "../../quiz/service/HistoryStore";
import { baseQid } from "../../types";
import type { WenguQuestion } from "../../types";

/**
 * 薄弱画像存储（插件数据 weakness 文件）：跨轮次按知识点聚合错/做题
 * 次数与错因，判卷数据从「散点会话」沉淀为结构化档案。
 *
 * 聚合键优先级（weakKeys）：题目解析里的知识点块引用（kp:标题块id，
 * 转换挂反链时注入）→ knowledge 属性（kn:）→ chapter 属性（ch:）。
 * 错因是 AI 归因的规范键（WeakCause），展示文案走 i18n。
 * 计数与错因分开防重入（applied / causeApplied 会话名单）：收卷即计
 * 数（本地、零 AI），错因随后异步补（brief 判分自带 + 客观错题批量
 * 归因一次），补不上不丢计数。
 */

/** 错因归类（AI 输出规整后的键；显示文案 i18n weakCause*）。 */
export type WeakCause = "concept" | "calc" | "method" | "formula" | "misread" | "other";

/** AI 错因文本 → 规范键（模糊匹配，未命中归 other）。 */
export function normalizeCause(text: string): WeakCause {
    const s = text.trim();
    if (/概念|定义|混淆|辨析/.test(s)) return "concept";
    if (/计算|运算|粗心|失误|符号|抄错/.test(s)) return "calc";
    if (/方法|思路|方向|选择错|选错/.test(s)) return "method";
    if (/公式|定理|记错|遗忘/.test(s)) return "formula";
    if (/审题|看错|漏|读题/.test(s)) return "misread";
    return "other";
}

/** 一个薄弱条目（按 key 聚合，key 见文件头）。 */
export interface WeakPointEntry {
    key: string;
    title: string;
    /** 累计错 + 半对次数（与统计口径一致：partial 记错）。 */
    wrong: number;
    /** 累计做题次数。 */
    total: number;
    lastWrongAt: number;
    causes: Partial<Record<WeakCause, number>>;
    /** 最近一次该点错题的 AI 评语（截 80 字）。 */
    aiNote?: string;
}

/** 插件存储（saveData("weakness")）里的画像。 */
export interface WeaknessData {
    version: 1;
    points: Record<string, WeakPointEntry>;
    /** 已计入次数的会话 id（防重入，滚动保留最近 300 个）。 */
    applied: string[];
    /** 已计入错因的会话 id。 */
    causeApplied: string[];
}

/** 报告展示行（同步快照，渲染不等待；key 供针对性生成回查）。 */
export interface WeakTopRow {
    key: string;
    title: string;
    wrong: number;
    total: number;
    topCause?: WeakCause;
    aiNote?: string;
}

/** 题目的聚合键列表（知识点引用优先，多个引用全计入）。 */
export function weakKeys(q: WenguQuestion): { key: string; title: string }[] {
    const out = parseKpRefs(q.solutionMd ?? "").map((k) => ({ key: `kp:${k.id}`, title: k.title }));
    if (out.length === 0 && q.knowledge) out.push({ key: `kn:${q.knowledge}`, title: q.knowledge });
    if (out.length === 0 && q.chapter) out.push({ key: `ch:${q.chapter}`, title: q.chapter });
    const seen = new Set<string>();
    return out.filter((k) => (seen.has(k.key) ? false : (seen.add(k.key), true)));
}

/** 一轮结果按题聚合（多步题 qid#k 合并：全步对才算对）。 */
export function roundAggByQid(s: WenguSession): Map<string, boolean> {
    const out = new Map<string, boolean>();
    for (const r of s.results) {
        const b = baseQid(r.qid);
        out.set(b, (out.get(b) ?? true) && r.ok);
    }
    return out;
}

/** 水位标记：`${会话id}#${已计结果条数}`——「结束本次做题」后同会话
 *  续刷再收卷，只把新增结果计入画像/错因；旧版纯 id 条目视为全量已计。 */
function watermarkOf(ids: string[], id: string, total: number): number {
    const hit = ids.find((x) => x === id || x.startsWith(`${id}#`));
    if (!hit) return 0;
    return hit === id ? total : Number(hit.slice(id.length + 1)) || 0;
}

function markApplied(ids: string[], id: string, count: number): void {
    const mark = `${id}#${count}`;
    const i = ids.findIndex((x) => x === id || x.startsWith(`${id}#`));
    if (i >= 0) ids[i] = mark;
    else ids.push(mark);
    if (ids.length > 300) ids.splice(0, ids.length - 300);
}

export class WeaknessStore {
    private cache?: WeaknessData;
    private snapshot: WeakTopRow[] = [];

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (v: WeaknessData) => Promise<unknown>
    ) {}

    private async all(): Promise<WeaknessData> {
        if (this.cache) return this.cache;
        try {
            const data = (await this.loadRaw()) as WeaknessData | "" | null | undefined;
            this.cache =
                data && typeof data === "object" && data.points
                    ? data
                    : { version: 1, points: {}, applied: [], causeApplied: [] };
        } catch (_) {
            this.cache = { version: 1, points: {}, applied: [], causeApplied: [] };
        }
        return this.cache;
    }

    /** 启动/装载时预热缓存并刷新同步快照。 */
    async preload(): Promise<void> {
        await this.all();
        this.refresh();
    }

    /** 同步取 Top-N 薄弱行（错数降序，其次最近出错）。 */
    topSync(n: number): WeakTopRow[] {
        return this.snapshot.slice(0, n);
    }

    /** 错因分布（统计总览用：全部薄弱点 causes 按六键求和，降序）。 */
    causeDistSync(): { cause: WeakCause; n: number }[] {
        const sum = new Map<WeakCause, number>();
        for (const e of Object.values(this.cache?.points ?? {})) {
            for (const [c, n] of Object.entries(e.causes ?? {})) {
                const key = c as WeakCause;
                sum.set(key, (sum.get(key) ?? 0) + (n ?? 0));
            }
        }
        return [...sum.entries()].map(([cause, n]) => ({ cause, n })).sort((a, b) => b.n - a.n);
    }

    /** 收卷即计数（本地聚合，零 AI；同会话按结果水位增量幂等）。 */
    async applyRound(s: WenguSession, list: WenguQuestion[]): Promise<void> {
        const data = await this.all();
        const from = watermarkOf(data.applied, s.id, s.results.length);
        if (from >= s.results.length) return;
        const agg = roundAggByQid({ ...s, results: s.results.slice(from) });
        const qById = new Map(list.map((q) => [q.id, q]));
        for (const [qid, ok] of agg) {
            const q = qById.get(qid);
            if (!q) continue;
            for (const k of weakKeys(q)) {
                const e = (data.points[k.key] ??= {
                    key: k.key,
                    title: k.title,
                    wrong: 0,
                    total: 0,
                    lastWrongAt: 0,
                    causes: {},
                });
                e.title = k.title;
                e.total++;
                if (!ok) {
                    e.wrong++;
                    e.lastWrongAt = Math.max(e.lastWrongAt, s.endedAt ?? Date.now());
                }
            }
        }
        markApplied(data.applied, s.id, s.results.length);
        await this.save(data);
    }

    /** 错因异步补记（brief 判分自带 + 客观错题批量归因；同会话按水位增量幂等）。 */
    async applyCauses(
        s: WenguSession,
        list: WenguQuestion[],
        causeByQid: Map<string, WeakCause>,
        noteByQid?: Map<string, string>
    ): Promise<void> {
        const data = await this.all();
        const from = watermarkOf(data.causeApplied, s.id, s.results.length);
        if (from >= s.results.length || causeByQid.size === 0) return;
        const inDelta = new Set(s.results.slice(from).map((r) => baseQid(r.qid)));
        const qById = new Map(list.map((q) => [q.id, q]));
        for (const [qid, cause] of causeByQid) {
            if (!inDelta.has(qid)) continue;
            const q = qById.get(qid);
            if (!q) continue;
            const note = noteByQid?.get(qid);
            for (const k of weakKeys(q)) {
                const e = (data.points[k.key] ??= {
                    key: k.key,
                    title: k.title,
                    wrong: 0,
                    total: 0,
                    lastWrongAt: 0,
                    causes: {},
                });
                e.causes[cause] = (e.causes[cause] ?? 0) + 1;
                if (note) e.aiNote = note.slice(0, 80);
            }
        }
        markApplied(data.causeApplied, s.id, s.results.length);
        await this.save(data);
    }

    /** 悬空对账：把 oldKey 的条目并入 newKey（统计合并），删除旧键。 */
    async remapKey(oldKey: string, newKey: string, newTitle: string): Promise<void> {
        const data = await this.all();
        const old = data.points[oldKey];
        if (!old) return;
        const cur = data.points[newKey];
        if (cur) {
            cur.wrong += old.wrong;
            cur.total += old.total;
            cur.lastWrongAt = Math.max(cur.lastWrongAt, old.lastWrongAt);
            for (const [c, n] of Object.entries(old.causes)) {
                cur.causes[c as WeakCause] = (cur.causes[c as WeakCause] ?? 0) + n;
            }
            if (old.aiNote) cur.aiNote = old.aiNote;
        } else {
            data.points[newKey] = { ...old, key: newKey, title: newTitle };
        }
        delete data.points[oldKey];
        await this.save(data);
    }

    private async save(data: WeaknessData): Promise<void> {
        try {
            await this.saveRaw(data);
        } catch (_) {
            // 尽力而为：写失败不阻断答题（内存态仍在）
        }
        this.refresh();
    }

    /** 由缓存刷新同步快照（有错次的才有意义）。 */
    private refresh(): void {
        if (!this.cache) return;
        this.snapshot = Object.values(this.cache.points)
            .filter((e) => e.wrong > 0)
            .sort((a, b) => b.wrong - a.wrong || b.lastWrongAt - a.lastWrongAt)
            .map((e) => ({
                key: e.key,
                title: e.title,
                wrong: e.wrong,
                total: e.total,
                topCause: Object.entries(e.causes).sort((a, b) => b[1] - a[1])[0]?.[0] as WeakCause | undefined,
                ...(e.aiNote ? { aiNote: e.aiNote } : {}),
            }));
    }
}
