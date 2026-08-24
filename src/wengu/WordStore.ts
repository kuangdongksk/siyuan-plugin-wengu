import WORD_BOOK, { type WenguWordUnitMeta } from "./WordBook";

/**
 * 单词复习的词表与进度存储。
 *
 * 词表数据是构建期内置的（src/wengu/data/words-p*.ts 分片，来源见
 * docs/wordbook-lxy.md），不落思源文档块；复习进度走插件数据
 * （saveData("words")，workspace data/storage/petal/<plugin>/words.json），
 * 与 HistoryStore 同一套整文件读写思路。
 */

/** 进度里一个词条的记忆状态：[Leitner 档位 1..6, 下次到期时间戳]。 */
type WordState = [number, number];

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
    version: 1;
    /** 下一个新词的扁平下标。 */
    cursor: number;
    /** 词条状态，key 为扁平下标字符串。 */
    words: Record<string, WordState>;
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
}

/** 认识程度。 */
export type WordGrade = "no" | "fuzzy" | "know";

/** Leitner 档位对应的复习间隔（天），下标=档位-1。 */
const INTERVAL_DAYS = [1, 2, 4, 8, 16, 32];

/** 默认每组单词数（AI 复盘粒度）。 */
const DEFAULT_GROUP_SIZE = 10;

export function todayKey(ts = Date.now()): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function defaultProgress(): WenguWordProgress {
    return {
        version: 1,
        cursor: 0,
        words: {},
        mistakes: {},
        simple: {},
        familiar: {},
        starred: {},
        log: {},
        today: { key: todayKey(), newCount: 0, revCount: 0 },
        timing: {},
        confusables: [],
        confNotes: {},
        groupSize: DEFAULT_GROUP_SIZE,
    };
}

/** 每组单词数（夹 5~20，缺省 10）。 */
export function groupSizeOf(p: WenguWordProgress): number {
    const n = p.groupSize;
    return Number.isFinite(n) && n !== undefined && n >= 5 ? Math.min(20, Math.floor(n)) : DEFAULT_GROUP_SIZE;
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

/** 组一次会话队列：全部到期复习词（书序）+ 全部未学新词（书序，不限量）。 */
export function buildQueue(progress: WenguWordProgress, now = Date.now()): { review: number[]; fresh: number[] } {
    const review: number[] = [];
    for (const key of Object.keys(progress.words)) {
        if (progress.simple[key] || progress.familiar[key]) continue;
        const i = Number(key);
        if (progress.words[key][1] <= now) review.push(i);
    }
    review.sort((a, b) => a - b);
    const fresh: number[] = [];
    for (let i = progress.cursor; i < WORD_BOOK.words.length; i++) {
        if (!progress.words[String(i)]) fresh.push(i);
    }
    return { review, fresh };
}

/** 明天要复习多少个：到期时间落在 (现在, 明天结束] 的词（随批改实时变）。 */
export function dueTomorrowCount(progress: WenguWordProgress, now = Date.now()): number {
    const endToday = new Date(now);
    endToday.setHours(23, 59, 59, 999);
    const end = endToday.getTime() + 86400_000;
    let count = 0;
    for (const key of Object.keys(progress.words)) {
        if (progress.simple[key] || progress.familiar[key]) continue;
        const due = progress.words[key][1];
        if (due > now && due <= end) count++;
    }
    return count;
}

/** 批改一次：更新档位与到期时间，返回是否算「学过」（新词计数用）。 */
export function applyGrade(
    progress: WenguWordProgress,
    index: number,
    grade: WordGrade,
    wasNew: boolean,
    now = Date.now()
): void {
    const prev = progress.words[String(index)];
    const level = prev ? prev[0] : 0;
    let next: number;
    if (grade === "know") next = Math.min(INTERVAL_DAYS.length, level + 1);
    else if (grade === "fuzzy") next = Math.max(1, level);
    else next = 1;
    const days = INTERVAL_DAYS[next - 1];
    progress.words[String(index)] = [next, now + days * 86400_000];
    if (grade === "no") {
        // 误认本：再次答错清空旧 AI 辨析、保留混淆自述由调用方回填
        const m = progress.mistakes[String(index)];
        progress.mistakes[String(index)] = { count: (m?.count ?? 0) + 1, lastTs: now };
    }
    if (wasNew) {
        progress.today.newCount++;
        if (index >= progress.cursor) progress.cursor = index + 1;
    } else {
        progress.today.revCount++;
    }
    // 打卡日志跟随（跨天批改前调用方应先 rollToday）
    rollToday(progress, now);
    progress.log[progress.today.key] = [progress.today.newCount, progress.today.revCount];
}

/* ── 熟 / 星标 / 误认自述 ── */

/** 标「熟」：退出复习循环（同太简单），今日计数与打卡照记。 */
export function markFamiliar(progress: WenguWordProgress, index: number, wasNew: boolean, now = Date.now()): void {
    progress.familiar[String(index)] = 1;
    if (wasNew) {
        progress.today.newCount++;
        if (index >= progress.cursor) progress.cursor = index + 1;
    } else {
        progress.today.revCount++;
    }
    rollToday(progress, now);
    progress.log[progress.today.key] = [progress.today.newCount, progress.today.revCount];
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

/** 星标词清单（书序）。 */
export function starredList(progress: WenguWordProgress): number[] {
    return Object.keys(progress.starred)
        .map(Number)
        .sort((a, b) => a - b);
}

/* ── 统计 ── */

/** 统计页数据（buildStats 一次遍历算齐）。 */
export interface WenguWordStats {
    total: number;
    learned: number;
    left: number;
    /** 档位 ≥5（巩固中）。 */
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
        const [level, due] = progress.words[key];
        if (level >= 5) mastered++;
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

/** AI 复盘结果落盘：档位动作（up/keep/down，Leitner 表内挪，不凭空
 * 给天数）+ 误认词辨析 tip；配对组由 WordConfusables.applyAi 落。 */
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
        if (it.act === "up") {
            const lv = Math.min(INTERVAL_DAYS.length, (st?.[0] ?? 0) + 1);
            progress.words[key] = [lv, now + INTERVAL_DAYS[lv - 1] * 86400_000];
        } else {
            // down：回 1 档、明天见（走神/误认的不对称成本，见任务书）
            progress.words[key] = [1, now + 86400_000];
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
            const data = (await this.loadRaw()) as WenguWordProgress | "" | null | undefined;
            this.cache = data && typeof data === "object" && data.version === 1 ? data : defaultProgress();
        } catch (_) {
            this.cache = defaultProgress();
        }
        const p = this.cache;
        if (!p.mistakes) p.mistakes = {}; // 旧数据回填（全字段：早期
        if (!p.simple) p.simple = {}; // 文件只写到 mistakes，familiar/
        if (!p.familiar) p.familiar = {}; // starred 缺失会让 buildQueue
        if (!p.starred) p.starred = {}; // 的 simple||familiar 判定炸掉）
        if (!p.log) p.log = {};
        if (!p.timing) p.timing = {};
        if (!p.confusables) p.confusables = [];
        if (!p.confNotes) p.confNotes = {};
        if (!p.notes) p.notes = {};
        const key = todayKey();
        if (p.today.key !== key) p.today = { key, newCount: 0, revCount: 0 };
        return p;
    }

    async save(p: WenguWordProgress): Promise<void> {
        try {
            await this.saveRaw(p);
        } catch (_) {
            // 尽力而为：写失败不阻断刷词
        }
    }
}
