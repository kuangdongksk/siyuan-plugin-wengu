import WORD_BOOK, {type WenguWordUnitMeta} from "./WordBook";

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

/** 插件存储（saveData("words")）里的单词进度。 */
export interface WenguWordProgress {
    version: 1;
    /** 下一个新词的扁平下标。 */
    cursor: number;
    /** 每日新词数。 */
    dailyNew: number;
    /** 词条状态，key 为扁平下标字符串。 */
    words: Record<string, WordState>;
    /** 今日打卡统计（跨天重置）。 */
    today: {key: string; newCount: number; revCount: number;};
}

/** 认识程度。 */
export type WordGrade = "no" | "fuzzy" | "know";

/** Leitner 档位对应的复习间隔（天），下标=档位-1。 */
const INTERVAL_DAYS = [1, 2, 4, 8, 16, 32];
/** 单次会话复习队列上限（防积压多日后一次爆量）。 */
const MAX_REVIEW_PER_SESSION = 100;

export function todayKey(ts = Date.now()): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function defaultProgress(): WenguWordProgress {
    return {version: 1, cursor: 0, dailyNew: 20, words: {}, today: {key: todayKey(), newCount: 0, revCount: 0}};
}

/** 组一次会话队列：到期复习词（书序，封顶 100）+ 今日剩余新词。 */
export function buildQueue(progress: WenguWordProgress, now = Date.now()): {review: number[]; fresh: number[];} {
    const review: number[] = [];
    for (const key of Object.keys(progress.words)) {
        const i = Number(key);
        if (progress.words[key][1] <= now) review.push(i);
    }
    review.sort((a, b) => a - b);
    if (review.length > MAX_REVIEW_PER_SESSION) review.length = MAX_REVIEW_PER_SESSION;
    const remainNew = Math.max(0, progress.dailyNew - progress.today.newCount);
    const fresh: number[] = [];
    for (let i = progress.cursor; i < WORD_BOOK.words.length && fresh.length < remainNew; i++) {
        if (!progress.words[String(i)]) fresh.push(i);
    }
    return {review, fresh};
}

/** 批改一次：更新档位与到期时间，返回是否算「学过」（新词计数用）。 */
export function applyGrade(
    progress: WenguWordProgress,
    index: number,
    grade: WordGrade,
    wasNew: boolean,
    now = Date.now(),
): void {
    const prev = progress.words[String(index)];
    const level = prev ? prev[0] : 0;
    let next: number;
    if (grade === "know") next = Math.min(INTERVAL_DAYS.length, level + 1);
    else if (grade === "fuzzy") next = Math.max(1, level);
    else next = 1;
    const days = INTERVAL_DAYS[next - 1];
    progress.words[String(index)] = [next, now + days * 86400_000];
    if (wasNew) {
        progress.today.newCount++;
        if (index >= progress.cursor) progress.cursor = index + 1;
    } else {
        progress.today.revCount++;
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
        private readonly saveRaw: (p: WenguWordProgress) => Promise<unknown>,
    ) {}

    async get(): Promise<WenguWordProgress> {
        if (this.cache) return this.cache;
        try {
            const data = await this.loadRaw() as WenguWordProgress | "" | null | undefined;
            this.cache = data && typeof data === "object" && data.version === 1 ?
                data :
                defaultProgress();
        } catch (_) {
            this.cache = defaultProgress();
        }
        const p = this.cache;
        const key = todayKey();
        if (p.today.key !== key) p.today = {key, newCount: 0, revCount: 0};
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
