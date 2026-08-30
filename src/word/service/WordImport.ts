import { wordLib, type WordLib } from "./WordLib";
import { keyOf, rollToday, todayKey, type WenguWordProgress } from "../core/WordStore";
import { seedWord } from "../core/WordFsrs";

/**
 * 进度导入（TSV：制表符三列「单词 | 状态 | n天后复习」）。
 *
 * 一份文件覆盖全部词，状态行内自带（未学习/复习中/复习完成/已标熟，
 * 英文枚举同认），不再逐份导出+预选状态。第三列天数是**复习中的进度
 * 锚点**：填 n = n 天后到期；不填按**词书顺序**错峰打散（复习中 1+W
 * 天、复习完成 6+W 天，窗口 W 随量自适应）——避开同日到期洪峰，且
 * FSRS 首次真实复习即按评分校正，种子偏差短命（redesign §三）。
 * 编码 UTF-8 优先，解码失败回 GBK（Excel 中文另存常见 ANSI/GBK）。
 */

/** 四种导入状态。 */
export type WordImportStatus = "unlearned" | "reviewing" | "done" | "familiar";

/** 状态词表（中/英同认，行内第 2 列）。 */
const STATUS_WORDS: [WordImportStatus, string[]][] = [
    ["unlearned", ["未学习", "unlearned"]],
    ["reviewing", ["复习中", "reviewing"]],
    ["done", ["复习完成", "done"]],
    ["familiar", ["已标熟", "familiar"]],
];

/** 天数列合法范围（防手滑巨值）。 */
const DAYS_MAX = 365;

export interface WordImportResult {
    /** 词书命中数。 */
    hit: number;
    /** 未匹配数（不在词书里）。 */
    miss: number;
    /** 未匹配示例（前 5 个）。 */
    missSample: string[];
    /** 各状态命中数（明细文案用）。 */
    perStatus: Record<WordImportStatus, number>;
    /** 状态列未识别的行数（已跳过）。 */
    badStatus: number;
    badSample: string[];
    /** 失败原因（有值即失败）。 */
    error?: string;
}

/** 一行的解析产物（days=第 3 列天数，非法/缺失=undefined 走默认打散）。 */
interface TsvRow {
    w: string;
    st: WordImportStatus;
    days?: number;
}

/** TSV 文本 → 行产物：表头行（第 2 列=「状态」/「status」）跳过；
 * 状态不认识的行进 bad 计数不导入。导出供单测。 */
export function parseTsv(text: string): { rows: TsvRow[]; bad: number; badSample: string[] } {
    const rows: TsvRow[] = [];
    let bad = 0;
    const badSample: string[] = [];
    const clean = text.replace(/^\uFEFF/, "");
    for (const line of clean.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const cols = line.split("\t").map((c) => c.trim());
        const stWord = (cols[1] ?? "").toLowerCase();
        if (stWord === "状态" || stWord === "status") continue; // 表头
        const st = STATUS_WORDS.find(([, ws]) => ws.some((x) => x === stWord))?.[0];
        if (!st || !cols[0]) {
            bad++;
            if (badSample.length < 5) badSample.push(cols[0] || line.slice(0, 20));
            continue;
        }
        const dn = Number(cols[2]);
        const days = cols[2] && Number.isInteger(dn) && dn >= 1 && dn <= DAYS_MAX ? dn : undefined;
        rows.push({ w: cols[0], st, days });
    }
    return { rows, bad, badSample };
}

/** 词书字母桶索引（按当前书懒建，随换书失效；模糊匹配用）。 */
let letterBuckets: { stamp: number; map: Map<string, { i: number; w: string }[]> } | undefined;
function bucketOf(lib: WordLib, w: string): { i: number; w: string }[] {
    const stamp = lib.bookStamp();
    if (!letterBuckets || letterBuckets.stamp !== stamp) {
        const lb = new Map<string, { i: number; w: string }[]>();
        lib.curBook().words.forEach((e, i) => {
            const k = e.w[0].toLowerCase();
            if (!lb.has(k)) lb.set(k, []);
            lb.get(k)!.push({ i, w: e.w.toLowerCase() });
        });
        letterBuckets = { stamp, map: lb };
    }
    return letterBuckets.map.get(w[0]) ?? [];
}

function lev1(a: string, b: string): boolean {
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a === b) return true;
    let diff = 0;
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            i++;
            j++;
            continue;
        }
        if (++diff > 1) return false;
        if (a.length > b.length) i++;
        else if (a.length < b.length) j++;
        else {
            i++;
            j++;
        }
    }
    return diff <= 1;
}

/** 文件字节 → 文本（UTF-8 优先失败回 GBK，Excel 中文另存兼容）。 */
function decodeText(bytes: Uint8Array): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_) {
        return new TextDecoder("gbk").decode(bytes);
    }
}

/** 导入：file(.tsv/.csv/.txt)，状态行内自带，返回结果并落进度。 */
export async function runWordImport(file: File, p: WenguWordProgress): Promise<WordImportResult> {
    const empty: Record<WordImportStatus, number> = { unlearned: 0, reviewing: 0, done: 0, familiar: 0 };
    const parsed = parseTsv(decodeText(new Uint8Array(await file.arrayBuffer())));
    if (parsed.rows.length === 0) {
        return {
            hit: 0,
            miss: 0,
            missSample: [],
            perStatus: empty,
            badStatus: parsed.bad,
            badSample: parsed.badSample,
            error: "noRow",
        };
    }
    // 匹配词书（精确优先，lev≤1 兜底；按当前书）。精确匹配先建一次
    // 小写索引——原逐词全书 findIndex+toLowerCase，3000 词导入×6900 词
    // 书 ≈2×10⁷ 次比较，主线程秒级冻结（20260829 三轮审查）
    const lib = wordLib();
    const book = lib.curBook();
    const exact = new Map<string, number>();
    for (let i = 0; i < book.words.length; i++) {
        const lw = book.words[i].w.toLowerCase();
        if (!exact.has(lw)) exact.set(lw, i);
    }
    const hits: { i: number; st: WordImportStatus; days?: number }[] = [];
    const miss: string[] = [];
    for (const row of parsed.rows) {
        const lw = row.w.toLowerCase();
        let idx = exact.get(lw) ?? -1;
        if (idx < 0) {
            idx = bucketOf(lib, lw).find((b) => lev1(b.w, lw))?.i ?? -1;
        }
        if (idx >= 0) hits.push({ i: idx, st: row.st, days: row.days });
        else if (miss.length < 50) miss.push(row.w);
    }
    if (hits.length === 0) {
        return {
            hit: 0,
            miss: miss.length,
            missSample: miss.slice(0, 5),
            perStatus: empty,
            badStatus: parsed.bad,
            badSample: parsed.badSample,
            error: "noMatch",
        };
    }
    const perStatus = applyRows(p, hits, Date.now());
    return {
        hit: hits.length,
        miss: miss.length,
        missSample: miss.slice(0, 5),
        perStatus,
        badStatus: parsed.bad,
        badSample: parsed.badSample,
    };
}

/** 错峰窗口：按该状态命中量自适应（20260830 拍板——几千词挤 7 天
 *  仍是每日几百的洪峰）。目标单日到期 ≤100，窗口下限 7（小量导入
 *  紧凑起步）、上限 60（防整本大书手滑摊成俩月后）。导出供单测。 */
export function spreadWindow(n: number): number {
    return Math.min(60, Math.max(7, Math.ceil(n / 100)));
}

/** 按状态落进度（FSRS 种子态，redesign §三；不触碰误认本）：天数列
 * 是复习中的进度锚点，其余状态忽略；缺天数按词书序 i%W 错峰，W 随
 * 该状态量自适应（复习中 1+W 天、复习完成 6+W 天），已标熟固定 32
 * 天+标熟位；未学习=清进度。 */
function applyRows(
    p: WenguWordProgress,
    hits: { i: number; st: WordImportStatus; days?: number }[],
    now: number
): Record<WordImportStatus, number> {
    const perStatus: Record<WordImportStatus, number> = { unlearned: 0, reviewing: 0, done: 0, familiar: 0 };
    const wRev = spreadWindow(hits.filter((h) => h.st === "reviewing").length);
    const wDone = spreadWindow(hits.filter((h) => h.st === "done").length);
    for (const { i, st, days } of hits) {
        const key = keyOf(i);
        if (!key) continue;
        perStatus[st]++;
        if (st === "unlearned") {
            delete p.words[key];
            delete p.ladder[key];
            delete p.simple[key];
            delete p.familiar[key];
            continue;
        }
        // 天数列只对复习中生效（复习进度锚点，20260830 定稿）：复习完成
        // /已标熟是完成态，到期一律默认错峰，配天数只会看着矛盾
        let due: number;
        if (st === "reviewing") due = days ?? 1 + (i % wRev);
        else if (st === "done") due = 6 + (i % wDone);
        else due = 32;
        seedWord(p, i, due, due, now);
        delete p.familiar[key];
        delete p.simple[key];
        if (st === "familiar") p.familiar[key] = 1;
    }
    rollToday(p, now);
    // 只在有实际计数时记当日 log：无条件写 [0,0] 伪打卡，streak 只看
    // log 键真值会把没学习的导入日也续上（20260829 三轮审查）
    const cnt: [number, number] = [p.today.newCount, p.today.revCount];
    if (cnt[0] > 0 || cnt[1] > 0) p.log[todayKey(now)] = cnt;
    return perStatus;
}
