import type { WenguWordUnitMeta } from "../service/WordBook";
import { wordLib } from "../service/WordLib";

/**
 * 单词复习的进度存储（schema v3，20260828 redesign §五）：**进度 key 从
 * 书内扁平下标改为归一化词头**（小写、去空格/连字符/撇号，见
 * WordBook.wordKey）——同词跨书共享进度；书本身的清单/切换在
 * service/WordLib（工作区 data/wengu/wordbooks/）。排期层 FSRS（每词
 * d/s/due，步进在 WordFsrs），新学滚动梯的在学进度持久化在 ladder。
 *
 * 词表数据是构建期内置的（data/words-p*.ts 分片，来源见
 * docs/wordbook-lxy.md），不落思源文档块；复习进度走插件数据
 * （saveData("words")，workspace data/storage/petal/<plugin>/words.json），
 * 与 HistoryStore 同一套整文件读写思路。队列/统计按**当前书**口径：
 * 不在当前书的 key 跳过（keyIndex undefined），「下一个新词」从全书
 * 扫描第一个无进度词（v2 的 cursor 字段随 key 词头化废除）。
 */

/** 进度里一个词条的 FSRS 记忆状态（v3；步进见 WordFsrs）。 */
export interface WenguWordFsrs {
    /** Difficulty 1~10（越大越难）。 */
    d: number;
    /** Stability（天）≈ 目标记忆率下的复习间隔。 */
    s: number;
    /** 下次到期时间戳。 */
    due: number;
    /** 最近一次复习时间戳（流水 dl 与 elapsed 用；新毕业无）。 */
    lr?: number;
    /** 复习次数 / 遗忘次数（Again 计一次 lapse）。 */
    r?: number;
    l?: number;
}

/** 逐词复习流水一条（rt=1|2|3 对应 Again/Hard/Good；dl=距上次复习天数）。 */
export interface WenguReviewRec {
    ts: number;
    rt: 1 | 2 | 3;
    dl: number;
}

/** 误认词记录（答错累计 + 用户自述「认成了什么」，AI 分析后附辨析）。 */
export interface WenguWordMistake {
    count: number;
    lastTs: number;
    /** 用户自述的混淆对象原文（英文单词或中文模糊描述，AI 负责推断）。 */
    confused?: string;
    /** AI 辨析提示（有值后不再重复分析，除非再次答错清空）。 */
    note?: string;
}

/** 单次作答计时（题型 + 有效停留毫秒 + 是否超时；spell 附错拼原文）。 */
export interface WenguTimingRec {
    mode: string;
    ms: number;
    over: 0 | 1;
    typed?: string;
}

/** 易混组：一组互相易混的词（docs/confusable-words.md，不分形近/音近）。
 *  ids 为归一化词头（跨书有效）；组内词不在当前书时展示侧跳过。 */
export interface WenguConfusableGroup {
    ids: string[];
    src: "preset" | "ai" | "evidence";
    /** 混淆对象不在词书时的原文（小写）。 */
    raw?: string;
}

/** 插件存储（saveData("words")）里的单词进度（key 一律归一化词头）。 */
export interface WenguWordProgress {
    version: 3;
    /** 词条 FSRS 状态。 */
    words: Record<string, WenguWordFsrs>;
    /** 新学滚动梯的在学词（词头 → [已完成步数, 整梯重来次数]，存在即在窗口）。 */
    ladder: Record<string, [number, number]>;
    /** 逐词复习流水（为将来 FSRS 参数优化留料）。 */
    reviews: Record<string, WenguReviewRec[]>;
    /** 误认词记录。 */
    mistakes: Record<string, WenguWordMistake>;
    /** 「太简单」集合（不再进复习）。 */
    simple: Record<string, 1>;
    /** 「熟」集合（用户判定已掌握，不再复习）。 */
    familiar: Record<string, 1>;
    /** 星标集合（重点词，可单独刷）。 */
    starred: Record<string, 1>;
    /** 打卡日志：日期 key → [当日新学数, 当日复习数]。 */
    log: Record<string, [number, number]>;
    /** 今日打卡统计（跨天重置）。 */
    today: { key: string; newCount: number; revCount: number };
    /** 每词最近作答计时（保留最近 5 条）。 */
    timing?: Record<string, WenguTimingRec[]>;
    /** 实证/AI 判定的易混组（预置组在 data/confusables.ts，不在此）。 */
    confusables?: WenguConfusableGroup[];
    /** 易混组辨析笔记（用户手写），key = 组 ids 排序逗号串。 */
    confNotes?: Record<string, string>;
    /** 词级笔记（用户手写，任何词可写）。 */
    notes?: Record<string, string>;
    /** 每组单词数（AI 复盘粒度，5~20）。 */
    groupSize?: number;
    /** 新学滚动窗口容量（3~10，缺省 5）。 */
    windowCap?: number;
}

/** 认识程度。 */
export type WordGrade = "no" | "fuzzy" | "know";

/** 默认每组单词数（AI 复盘粒度）。 */
const DEFAULT_GROUP_SIZE = 10;
/** 默认新学窗口容量。 */
export const DEFAULT_WINDOW_CAP = 5;

/* ── key 帮手（当前书口径；词头归一化在 WordBook.wordKey） ── */

/** 当前书下标 → 词头 key（越界返回空串=永无进度，调用方安全）。 */
export function keyOf(index: number): string {
    return wordLib().keyOf(index);
}

/** 词头 key → 当前书下标（不在书内 undefined）。 */
export function keyIndex(key: string): number | undefined {
    return wordLib().keyIndex(key);
}

export function todayKey(ts = Date.now()): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function defaultProgress(): WenguWordProgress {
    return {
        version: 3,
        words: {},
        ladder: {},
        reviews: {},
        mistakes: {},
        simple: {},
        familiar: {},
        starred: {},
        log: {},
        today: { key: todayKey(), newCount: 0, revCount: 0 },
        timing: {},
        confusables: [],
        confNotes: {},
        notes: {},
        groupSize: DEFAULT_GROUP_SIZE,
    };
}

/** 每组单词数（夹 5~20，缺省 10）。 */
export function groupSizeOf(p: WenguWordProgress): number {
    const n = p.groupSize;
    return Number.isFinite(n) && n !== undefined && n >= 5 ? Math.min(20, Math.floor(n)) : DEFAULT_GROUP_SIZE;
}

/** 新学窗口容量（夹 3~10，缺省 5）。 */
export function windowCapOf(p: WenguWordProgress): number {
    const n = p.windowCap;
    return Number.isFinite(n) && n !== undefined && n >= 3 ? Math.min(10, Math.floor(n)) : DEFAULT_WINDOW_CAP;
}

/** 记一条作答计时（每词保留最近 5 条）。 */
export function pushTiming(p: WenguWordProgress, index: number, rec: WenguTimingRec): void {
    const key = keyOf(index);
    if (!key) return;
    const arr = p.timing![key] ?? [];
    arr.push(rec);
    p.timing![key] = arr.slice(-5);
}

/** 易混组笔记 key：ids 排序逗号串（字符串序，确定性）。 */
export function confKey(ids: string[]): string {
    return [...ids].sort().join(",");
}

/** 跨天翻转：面板隔夜不关也正确（paint/批改前调用，翻过返回 true）。 */
export function rollToday(progress: WenguWordProgress, now = Date.now()): boolean {
    const key = todayKey(now);
    if (progress.today.key === key) return false;
    progress.today = { key, newCount: 0, revCount: 0 };
    return true;
}

/** 词是否已占用（有任一进度态——开词/在学/太简单/熟）。 */
function claimed(p: WenguWordProgress, key: string): boolean {
    return Boolean(p.words[key] || p.ladder[key] || p.simple[key] || p.familiar[key]);
}

/** 组会话队列：到期复习词（当前书书序）+ 剩余新词数（新学走滚动窗口，
 * 不在此）。到期/剩余都只算当前书的词（跨书共享进度，他书词不串场）。 */
export function buildQueue(progress: WenguWordProgress, now = Date.now()): { review: number[]; freshLeft: number } {
    const review: number[] = [];
    for (const key of Object.keys(progress.words)) {
        if (progress.simple[key] || progress.familiar[key]) continue;
        const i = keyIndex(key);
        if (i === undefined) continue;
        if (progress.words[key].due <= now) review.push(i);
    }
    review.sort((a, b) => a - b);
    return { review, freshLeft: bookLeftOf(progress) };
}

/** 明天要复习多少个：到期时间落在 (今日 24 点, 明日 24 点] 的词（当前
 *  书口径）。原口径 (现在, 明日 24 点] 把「今天稍后到期」的词也计进
 *  明天——它们今天稍后就会进复习队列（挂账「到期口径」清偿）。 */
export function dueTomorrowCount(progress: WenguWordProgress, now = Date.now()): number {
    const endToday = new Date(now);
    endToday.setHours(23, 59, 59, 999);
    const start = endToday.getTime();
    const end = start + 86400_000;
    let count = 0;
    for (const key of Object.keys(progress.words)) {
        if (progress.simple[key] || progress.familiar[key]) continue;
        if (keyIndex(key) === undefined) continue;
        const due = progress.words[key].due;
        if (due > start && due <= end) count++;
    }
    return count;
}

/** 书级剩余未学（头部「剩」的书口径，redesign §二.6；按当前书词扫）。 */
export function bookLeftOf(progress: WenguWordProgress): number {
    const book = wordLib().curBook();
    let left = 0;
    for (let i = 0; i < book.words.length; i++) {
        if (!claimed(progress, wordLib().keyOf(i))) left++;
    }
    return left;
}

/** 下一个新词下标（全书第一个无进度词；无返回 undefined）。 */
export function firstFresh(progress: WenguWordProgress): number | undefined {
    const book = wordLib().curBook();
    for (let i = 0; i < book.words.length; i++) {
        if (!claimed(progress, wordLib().keyOf(i))) return i;
    }
    return undefined;
}

/** 稳定度 → 伪档位（1~6，统计/AI 展示口径沿用旧阶梯的天数带）。 */
export function pseudoLevelOf(s: number): number {
    return s >= 32 ? 6 : s >= 16 ? 5 : s >= 8 ? 4 : s >= 4 ? 3 : s >= 2 ? 2 : 1;
}

/** 误认本记账（答「忘记/记错了」时；count 累计、重答错清旧 AI 辨析——
 * 自述由调用方随后回填）。76657bf FSRS 重写时曾误丢，20260828 恢复。 */
export function markMistake(progress: WenguWordProgress, index: number, now = Date.now()): void {
    const key = keyOf(index);
    if (!key) return;
    const m = progress.mistakes[key];
    progress.mistakes[key] = { count: (m?.count ?? 0) + 1, lastTs: now };
}

/** 标「熟」：退出复习循环（同太简单），今日计数与打卡照记。先 roll 再
 *  计数（与 WordFsrs.countInto 同构）——跨天后首张先加后 roll 会把计数
 *  清零、还写下 [0,0] 伪造打卡 streak（20260828 审查）。 */
export function markFamiliar(progress: WenguWordProgress, index: number, wasNew: boolean, now = Date.now()): void {
    const key = keyOf(index);
    if (!key) return; // keyOf 空串防护：空键会写进 familiar/log 污染进度
    progress.familiar[key] = 1;
    delete progress.ladder[key];
    rollToday(progress, now);
    if (wasNew) progress.today.newCount++;
    else progress.today.revCount++;
    progress.log[todayKey(now)] = [progress.today.newCount, progress.today.revCount];
}

/** 星标开关，返回切换后是否已星标。 */
export function toggleStar(progress: WenguWordProgress, index: number): boolean {
    const key = keyOf(index);
    if (!key) return false; // keyOf 空串防护
    if (progress.starred[key]) {
        delete progress.starred[key];
        return false;
    }
    progress.starred[key] = 1;
    return true;
}

/** 星标词清单（当前书书序；在学梯内的词排除——归滚动窗口管）。 */
export function starredList(progress: WenguWordProgress): number[] {
    const out: number[] = [];
    for (const key of Object.keys(progress.starred)) {
        const i = keyIndex(key);
        if (i !== undefined && !progress.ladder[key]) out.push(i);
    }
    return out.sort((a, b) => a - b);
}

/* ── 统计 ── */

/** 统计页数据（buildStats 一次遍历算齐；全部当前书口径）。 */
export interface WenguWordStats {
    total: number;
    learned: number;
    left: number;
    /** 稳定度 ≥16 天（巩固中）。 */
    mastered: number;
    simple: number;
    familiar: number;
    starred: number;
    mistakes: number;
    mistakesPending: number;
    todayNew: number;
    todayRev: number;
    dueNow: number;
    /** 未来 7 天到期分布，下标 0=今天剩余，1-7=之后逐日（更远不显示）。 */
    next7: number[];
    /** 连续打卡天数（今天没学则从昨天起算，不因未到晚上而断）。 */
    streak: number;
}

/** 汇总统计：多天未开时到期积压全部落在「今天剩余」里，如实呈现。 */
export function buildStats(progress: WenguWordProgress, now = Date.now()): WenguWordStats {
    rollToday(progress, now);
    const total = wordLib().curBook().words.length;
    const dayEnd = (offset: number) => {
        const d = new Date(now);
        d.setHours(23, 59, 59, 999);
        return d.getTime() + offset * 86400_000;
    };
    const next7 = new Array(8).fill(0);
    let mastered = 0;
    let learned = 0;
    const inBook = (key: string): boolean => keyIndex(key) !== undefined;
    for (const key of Object.keys(progress.words)) {
        if (!inBook(key)) continue;
        learned++;
        if (progress.simple[key] || progress.familiar[key]) continue;
        const { s, due } = progress.words[key];
        if (pseudoLevelOf(s) >= 5) mastered++;
        if (due <= now) next7[0]++;
        else {
            for (let i = 1; i <= 7; i++) {
                if (due <= dayEnd(i)) {
                    next7[i]++;
                    break;
                }
            }
        }
    }
    const countBook = (m: Record<string, unknown>): number => Object.keys(m).filter(inBook).length;
    let mistakesPending = 0;
    for (const key of Object.keys(progress.mistakes)) {
        if (!inBook(key)) continue;
        if (!progress.mistakes[key].note) mistakesPending++;
    }
    // 连续打卡：从今天往回数；今天没记录则从昨天起算
    const dayKey = (offset: number) => todayKey(now - offset * 86400_000);
    let streak = 0;
    const start = progress.log[dayKey(0)] ? 0 : 1;
    for (let i = start; i < 3660; i++) {
        if (progress.log[dayKey(i)]) streak++;
        else break;
    }
    return {
        total,
        learned,
        left: total - learned,
        mastered,
        simple: countBook(progress.simple),
        familiar: countBook(progress.familiar),
        starred: countBook(progress.starred),
        mistakes: countBook(progress.mistakes),
        mistakesPending,
        todayNew: progress.today.newCount,
        todayRev: progress.today.revCount,
        dueNow: next7[0],
        next7,
        streak,
    };
}

/** AI 复盘结果落盘：稳定度动作（up/keep/down 按比例挪，不凭空给天数）
 *  + 误认词辨析 tip；配对组由 WordConfusables.applyAi 落。在学梯内的词
 *  没有 FSRS 态，只吃 tip 不动排期（归滚动窗口管）。items 带**归一化
 *  词头**（构建时刻冻结）——不吃活下标：AI 往返期间切书的话 keyOf 会
 *  按新书把档位写到无关词上（20260828 审查）。 */
export function applyAiReview(
    progress: WenguWordProgress,
    items: { key: string; act: "up" | "keep" | "down"; tip?: string; confused?: string }[],
    now = Date.now()
): void {
    for (const it of items) {
        const key = it.key;
        if (it.tip) {
            const m = progress.mistakes[key];
            if (m) m.note = it.tip;
        }
        if (it.act === "keep") continue;
        const st = progress.words[key];
        if (!st) continue;
        if (it.act === "up") {
            st.s = Math.min(365, Math.max(st.s, 1) * 1.4);
            st.due = now + st.s * 86400_000;
        } else {
            // down：稳定度减半、明天见（走神/误认的不对称成本，见任务书）
            st.s = Math.max(0.3, st.s * 0.5);
            st.due = now + 86400_000;
        }
    }
}

/** 词条所属单元（边界表小，线性找即可；导入书无单元返回 undefined）。 */
export function unitOf(index: number): WenguWordUnitMeta | undefined {
    return wordLib()
        .curBook()
        .units?.find((u) => index >= u.start && index < u.start + u.count);
}

/** 进度存取：整文件读写 + 内存缓存（同 HistoryStore 模式）。 */
export class WordStore {
    private cache?: WenguWordProgress;

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (p: WenguWordProgress) => Promise<unknown>
    ) {}

    async get(): Promise<WenguWordProgress> {
        if (this.cache) return this.cache;
        // 只把「读到的东西不是 v3」当空起步；**读异常上抛不落缓存**——
        // 原归空后任意一次 save 把空进度覆写 words.json、全部进度清零
        // （HistoryStore 同坑 20260828 已修，20260829 三轮审查补齐本店；
        // loadRaw「文件不存在」约定返回空串/undefined，走 warn 分支不受影响）
        const data = (await this.loadRaw()) as unknown;
        const ver = data && typeof data === "object" ? (data as { version?: number }).version : undefined;
        // 仅认 v3（词头 key）。v2→v3 一次性迁移代码已于 20260829 确认
        // 存量落盘 v3 后移除（core/WordMigrate，同 v1→v2 先例）；再遇
        // 旧版本文件按空进度起步并告警（真机确认无 v2 存量）。
        if (data && ver !== 3) console.warn(`[wengu] words 进度版本非 v3（${String(ver)}），按空进度起步`);
        this.cache = ver === 3 ? (data as WenguWordProgress) : defaultProgress();
        this.backfill(this.cache);
        const key = todayKey();
        if (this.cache.today.key !== key) this.cache.today = { key, newCount: 0, revCount: 0 };
        return this.cache;
    }

    /** 旧文件缺字段回填。 */
    private backfill(p: WenguWordProgress): void {
        if (!p.mistakes) p.mistakes = {};
        if (!p.simple) p.simple = {};
        if (!p.familiar) p.familiar = {};
        if (!p.starred) p.starred = {};
        if (!p.ladder) p.ladder = {}; // 缺它 render/claimed/startFreshFor 全线 TypeError（20260828 审查）
        if (!p.log) p.log = {};
        if (!p.timing) p.timing = {};
        if (!p.confusables) p.confusables = [];
        if (!p.confNotes) p.confNotes = {};
        if (!p.notes) p.notes = {};
        if (!p.words) p.words = {};
    }

    /** 串行落盘链（同 ChatStore 模式）：调用方全是 void save()（不 await），
     *  并发写会撞「内核 fetchSyncPost 并发互吞响应」丢进度（卡片收尾与
     *  组边界 runGroup 两条并发源几乎必然重叠，20260828 审查）。 */
    private saveChain: Promise<unknown> = Promise.resolve();

    async save(p: WenguWordProgress): Promise<void> {
        const run = this.saveChain.then(() => this.saveRaw(p));
        const noop = (): void => undefined;
        this.saveChain = run.then(noop, noop);
        try {
            await run;
        } catch (_) {
            // 尽力而为：写失败不阻断刷词
        }
    }
}
