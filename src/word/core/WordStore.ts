import WORD_BOOK, { type WenguWordUnitMeta } from "../service/WordBook";

/**
 * 单词复习的词表与进度存储（schema v2，20260828 redesign §三）：
 * 排期层换 FSRS（每词 d/s/due，步进在 WordFsrs），新学滚动梯的在学
 * 进度持久化在 ladder（词→[step,errs]）。
 *
 * 词表数据是构建期内置的（src/wengu/data/words-p*.ts 分片，来源见
 * docs/wordbook-lxy.md），不落思源文档块；复习进度走插件数据
 * （saveData("words")，workspace data/storage/petal/<plugin>/words.json），
 * 与 HistoryStore 同一套整文件读写思路。
 */

/** 进度里一个词条的 FSRS 记忆状态（v2；步进见 WordFsrs）。 */
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

/** 易混组：一组互相易混的词（docs/confusable-words.md，不分形近/音近）。 */
export interface WenguConfusableGroup {
    /** 组内词条（扁平下标升序；evidence 的 B 不在词书时可仅 1 个 + raw）。 */
    ids: number[];
    src: "preset" | "ai" | "evidence";
    /** 混淆对象不在词书时的原文（小写）。 */
    raw?: string;
}

/** 插件存储（saveData("words")）里的单词进度。 */
export interface WenguWordProgress {
    version: 2;
    /** 下一个新词的扁平下标（开词即前移）。 */
    cursor: number;
    /** 词条 FSRS 状态，key 为扁平下标字符串。 */
    words: Record<string, WenguWordFsrs>;
    /** 新学滚动梯的在学词（key → [已完成步数, 整梯重来次数]，存在即在窗口）。 */
    ladder: Record<string, [number, number]>;
    /** 逐词复习流水（为将来 FSRS 参数优化留料）。 */
    reviews: Record<string, WenguReviewRec[]>;
    /** 误认词记录，key 为扁平下标字符串。 */
    mistakes: Record<string, WenguWordMistake>;
    /** 「太简单」集合（不再进复习），key 为扁平下标字符串。 */
    simple: Record<string, 1>;
    /** 「熟」集合（用户判定已掌握，不再复习），key 为扁平下标字符串。 */
    familiar: Record<string, 1>;
    /** 星标集合（重点词，可单独刷），key 为扁平下标字符串。 */
    starred: Record<string, 1>;
    /** 打卡日志：日期 key → [当日新学数, 当日复习数]。 */
    log: Record<string, [number, number]>;
    /** 今日打卡统计（跨天重置）。 */
    today: { key: string; newCount: number; revCount: number };
    /** 每词最近作答计时（key 扁平下标，保留最近 5 条）。 */
    timing?: Record<string, WenguTimingRec[]>;
    /** 实证/AI 判定的易混组（预置组在 data/confusables.ts，不在此）。 */
    confusables?: WenguConfusableGroup[];
    /** 易混组辨析笔记（用户手写），key = 组 ids 升序逗号串。 */
    confNotes?: Record<string, string>;
    /** 词级笔记（用户手写，任何词可写），key 为扁平下标字符串。 */
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

export function todayKey(ts = Date.now()): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function defaultProgress(): WenguWordProgress {
    return {
        version: 2,
        cursor: 0,
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
    const key = String(index);
    const arr = p.timing![key] ?? [];
    arr.push(rec);
    p.timing![key] = arr.slice(-5);
}

/** 易混组笔记 key：ids 升序逗号串。 */
export function confKey(ids: number[]): string {
    return [...ids].sort((a, b) => a - b).join(",");
}

/** 跨天翻转：面板隔夜不关也正确（paint/批改前调用，翻过返回 true）。 */
export function rollToday(progress: WenguWordProgress, now = Date.now()): boolean {
    const key = todayKey(now);
    if (progress.today.key === key) return false;
    progress.today = { key, newCount: 0, revCount: 0 };
    return true;
}

/** 组会话队列：到期复习词（书序）+ 剩余新词数（新学走滚动窗口，不在此）。 */
export function buildQueue(progress: WenguWordProgress, now = Date.now()): { review: number[]; freshLeft: number } {
    const review: number[] = [];
    for (const key of Object.keys(progress.words)) {
        if (progress.simple[key] || progress.familiar[key]) continue;
        if (progress.words[key].due <= now) review.push(Number(key));
    }
    review.sort((a, b) => a - b);
    let freshLeft = 0;
    for (let i = progress.cursor; i < WORD_BOOK.words.length; i++) {
        if (!progress.words[String(i)] && !progress.ladder[String(i)]) freshLeft++;
    }
    return { review, freshLeft };
}

/** 明天要复习多少个：到期时间落在 (现在, 明天结束] 的词（随批改实时变）。 */
export function dueTomorrowCount(progress: WenguWordProgress, now = Date.now()): number {
    const endToday = new Date(now);
    endToday.setHours(23, 59, 59, 999);
    const end = endToday.getTime() + 86400_000;
    let count = 0;
    for (const key of Object.keys(progress.words)) {
        if (progress.simple[key] || progress.familiar[key]) continue;
        const due = progress.words[key].due;
        if (due > now && due <= end) count++;
    }
    return count;
}

/** 书级剩余未学（头部「剩」的书口径，redesign §二.6）。 */
export function bookLeftOf(progress: WenguWordProgress): number {
    const known = new Set([
        ...Object.keys(progress.words),
        ...Object.keys(progress.simple),
        ...Object.keys(progress.familiar),
        ...Object.keys(progress.ladder),
    ]);
    return Math.max(0, WORD_BOOK.words.length - known.size);
}

/** 稳定度 → 伪档位（1~6，统计/AI 展示口径沿用旧阶梯的天数带）。 */
export function pseudoLevelOf(s: number): number {
    return s >= 32 ? 6 : s >= 16 ? 5 : s >= 8 ? 4 : s >= 4 ? 3 : s >= 2 ? 2 : 1;
}

/** 标「熟」：退出复习循环（同太简单），今日计数与打卡照记。 */
export function markFamiliar(progress: WenguWordProgress, index: number, wasNew: boolean, now = Date.now()): void {
    progress.familiar[String(index)] = 1;
    delete progress.ladder[String(index)];
    if (wasNew) progress.today.newCount++;
    else progress.today.revCount++;
    rollToday(progress, now);
    progress.log[todayKey(now)] = [progress.today.newCount, progress.today.revCount];
}

/** 星标开关，返回切换后是否已星标。 */
export function toggleStar(progress: WenguWordProgress, index: number): boolean {
    const key = String(index);
    if (progress.starred[key]) {
        delete progress.starred[key];
        return false;
    }
    progress.starred[key] = 1;
    return true;
}

/** 星标词清单（书序；在学梯内的词排除——归滚动窗口管）。 */
export function starredList(progress: WenguWordProgress): number[] {
    return Object.keys(progress.starred)
        .map(Number)
        .filter((i) => !progress.ladder[String(i)])
        .sort((a, b) => a - b);
}

/* ── 统计 ── */

/** 统计页数据（buildStats 一次遍历算齐）。 */
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
    const dayEnd = (offset: number) => {
        const d = new Date(now);
        d.setHours(23, 59, 59, 999);
        return d.getTime() + offset * 86400_000;
    };
    const next7 = new Array(8).fill(0);
    let mastered = 0;
    for (const key of Object.keys(progress.words)) {
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
    let mistakesPending = 0;
    for (const key of Object.keys(progress.mistakes)) {
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
    const learned = Object.keys(progress.words).length;
    return {
        total: WORD_BOOK.words.length,
        learned,
        left: WORD_BOOK.words.length - learned,
        mastered,
        simple: Object.keys(progress.simple).length,
        familiar: Object.keys(progress.familiar).length,
        starred: Object.keys(progress.starred).length,
        mistakes: Object.keys(progress.mistakes).length,
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
 *  没有 FSRS 态，只吃 tip 不动排期（归滚动窗口管）。 */
export function applyAiReview(
    progress: WenguWordProgress,
    items: { index: number; act: "up" | "keep" | "down"; tip?: string; confused?: string }[],
    now = Date.now()
): void {
    for (const it of items) {
        const key = String(it.index);
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

/** 词条所属单元（边界表小，线性找即可）。 */
export function unitOf(index: number): WenguWordUnitMeta | undefined {
    return WORD_BOOK.units.find((u) => index >= u.start && index < u.start + u.count);
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
        try {
            const data = (await this.loadRaw()) as unknown;
            const ver = data && typeof data === "object" ? (data as { version?: number }).version : undefined;
            // v1→v2 迁移已在 20260828 落盘后移除（用户确认存量已保存）；
            // 认不出 v2 的文件按新进度起步（version 字段留给将来的 v3
            // 多词书词头化迁移用）
            this.cache = ver === 2 ? (data as WenguWordProgress) : defaultProgress();
        } catch (_) {
            this.cache = defaultProgress();
        }
        this.backfill(this.cache);
        const key = todayKey();
        if (this.cache.today.key !== key) this.cache.today = { key, newCount: 0, revCount: 0 };
        return this.cache;
    }

    /** 旧文件缺字段回填（v1 早期文件只写到 mistakes）。 */
    private backfill(p: WenguWordProgress): void {
        if (!p.mistakes) p.mistakes = {};
        if (!p.simple) p.simple = {};
        if (!p.familiar) p.familiar = {};
        if (!p.starred) p.starred = {};
        if (!p.log) p.log = {};
        if (!p.timing) p.timing = {};
        if (!p.confusables) p.confusables = [];
        if (!p.confNotes) p.confNotes = {};
        if (!p.notes) p.notes = {};
        if (!p.words) p.words = {};
    }

    async save(p: WenguWordProgress): Promise<void> {
        try {
            await this.saveRaw(p);
        } catch (_) {
            // 尽力而为：写失败不阻断刷词
        }
    }
}
