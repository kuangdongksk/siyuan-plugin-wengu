import WORD_BOOK from "./WordBook";
import { rollToday, todayKey, type WenguWordProgress } from "../core/WordStore";

/**
 * 不背单词进度导入（PDF 文字层 / txt）。
 *
 * 不背按学习状态分别导出 PDF（标题如「…·未学习」，词条两栏：
 * 编号+单词 | 释义），是 App 生成的文本 PDF——本模块自解析文字层：
 * 流解压走浏览器原生 DecompressionStream，中文经 ToUnicode CMap
 * 映射，单词直接取 ASCII 词元；扫描件（无文字层）明确报错引导转 txt。
 */

/** 四种导入状态。 */
export type WordImportStatus = "unlearned" | "reviewing" | "done" | "familiar";

export interface WordImportResult {
    /** 词书命中数。 */
    hit: number;
    /** 未匹配数（不在词书里）。 */
    miss: number;
    /** 未匹配示例（前 5 个）。 */
    missSample: string[];
    /** 自动识别出的状态（null=未识别，按用户选择处理）。 */
    autoStatus: WordImportStatus | null;
    /** 提取失败原因（有值即失败）。 */
    error?: string;
}

/* ── PDF 文字层提取 ── */

/** 找出全部 stream 的原始字节（dictText 用于类型判断；负向断言避开 endstream）。 */
function collectStreams(bytes: Uint8Array): { dict: string; data: Uint8Array }[] {
    const latin = new TextDecoder("latin1").decode(bytes);
    const out: { dict: string; data: Uint8Array }[] = [];
    const re = /(?<!end)stream\r?\n/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(latin)) !== null) {
        const end = latin.indexOf("endstream", m.index + m[0].length);
        if (end < 0) break;
        const dictStart = Math.max(0, m.index - 600);
        out.push({
            dict: latin.slice(dictStart, m.index),
            data: bytes.subarray(m.index + m[0].length, end),
        });
        re.lastIndex = end;
    }
    return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
    // 流数据与 endstream 间常有换行，先裁掉再解压；失败再逐步多裁
    let cut = data.length;
    while (cut > 0 && [10, 13, 32].includes(data[cut - 1])) cut--;
    for (let extra = 0; extra <= 2 && cut - extra > 0; extra++) {
        try {
            const ds = new DecompressionStream("deflate");
            const part = data.subarray(0, cut - extra);
            const stream = new Blob([part as unknown as BlobPart]).stream().pipeThrough(ds);
            const buf = await new Response(stream).arrayBuffer();
            return new Uint8Array(buf);
        } catch (_) {
            // 继续尝试
        }
    }
    return null;
}

/** CMap：CID(hex) → Unicode。多字体流合并。 */
function parseCMaps(text: string): Map<number, string> {
    const map = new Map<number, string>();
    const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
    let m: RegExpExecArray | null;
    while ((m = bfchar.exec(text)) !== null) {
        for (const pair of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
            const cid = parseInt(pair[1], 16);
            const hex = pair[2];
            let uni = "";
            for (let i = 0; i + 3 < hex.length + 1 && i < hex.length; i += 4) {
                uni += String.fromCharCode(parseInt(hex.slice(i, i + 4).padEnd(4, "0"), 16));
            }
            if (!map.has(cid)) map.set(cid, uni);
        }
    }
    const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = bfrange.exec(text)) !== null) {
        for (const r of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
            const lo = parseInt(r[1], 16);
            const hi = parseInt(r[2], 16);
            const base = parseInt(r[3], 16);
            for (let c = lo; c <= hi && c - lo < 65536; c++) {
                if (!map.has(c)) map.set(c, String.fromCharCode(base + (c - lo)));
            }
        }
    }
    return map;
}

/** 解码一个 PDF 文字串字面量（括号串处理转义；十六进制串走 CMap）。 */
function decodeStr(raw: string, cmaps: Map<number, string>): string {
    if (raw.startsWith("(")) {
        const body = raw.slice(1, -1);
        return body.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e: string) => {
            if (e === "n") return "\n";
            if (e === "r") return "\r";
            if (e === "t") return "\t";
            if (e.length <= 3 && /^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
            return e;
        });
    }
    const hex = raw.slice(1, -1).replace(/\s+/g, "");
    // 2 字节 CID 逐个映射；映射不到按 UTF-16BE 兜底（ASCII 场景已够）
    let out = "";
    for (let i = 0; i + 4 <= hex.length; i += 4) {
        const cid = parseInt(hex.slice(i, i + 4), 16);
        out += cmaps.get(cid) ?? (cid < 256 ? String.fromCharCode(cid) : "");
    }
    return out;
}

/** 全部内容流 → 纯文本：定位/换行操作符原位替换为换行，再逐行取字面量。 */
function contentToText(content: string, cmaps: Map<number, string>): string {
    const marked = content.replace(/\b(Td|TD|T\*|BT|ET)\b/g, "\n");
    const re = /(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>)/g;
    return marked
        .split("\n")
        .map((line) => {
            let out = "";
            let m: RegExpExecArray | null;
            re.lastIndex = 0;
            while ((m = re.exec(line)) !== null) out += decodeStr(m[1], cmaps);
            return out;
        })
        .filter((l) => l.length > 0)
        .join("\n");
}

/** PDF → 文本（无文字层返回空串）。 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
    const streams = await Promise.all(
        collectStreams(bytes).map(async (s) => {
            // Flate 解压失败(如误判)回退原始字节，文本流未压缩也能出字
            const data = s.dict.includes("FlateDecode") ? ((await inflate(s.data)) ?? s.data) : s.data;
            return data ? new TextDecoder("latin1").decode(data) : "";
        })
    );
    const cmaps = parseCMaps(streams.join(""));
    let text = "";
    for (const s of streams) {
        if (/\bTj\b|\bTJ\b/.test(s)) text += contentToText(s, cmaps) + "\n";
    }
    return text;
}

/* ── 词条解析与状态应用 ── */

const STATUS_KEYWORDS: [WordImportStatus, string][] = [
    ["unlearned", "未学习"],
    ["reviewing", "复习中"],
    ["done", "复习完成"],
    ["familiar", "已标熟"],
];

/** 从文本抽候选单词（每行「编号 单词」或行首独立英文词元）。 */
function extractWords(text: string): string[] {
    const words: string[] = [];
    for (const line of text.split(/\n|\r/)) {
        const m = line.match(/^\s*\d{1,4}[\s.、]+([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,2})/);
        if (m) {
            words.push(m[1].trim());
            continue;
        }
        const w = line.match(/^\s*([A-Za-z][A-Za-z'\-]{2,})\s*$/);
        if (w) words.push(w[1].trim());
    }
    return words;
}

/** 词书字母桶索引（懒建，模糊匹配用）。 */
let letterBuckets: Map<string, { i: number; w: string }[]> | undefined;
function buildBuckets(): Map<string, { i: number; w: string }[]> {
    const lb = new Map<string, { i: number; w: string }[]>();
    WORD_BOOK.words.forEach((e, i) => {
        const k = e.w[0].toLowerCase();
        if (!lb.has(k)) lb.set(k, []);
        lb.get(k)!.push({ i, w: e.w.toLowerCase() });
    });
    return lb;
}
function bucketOf(w: string): { i: number; w: string }[] {
    letterBuckets ??= buildBuckets();
    return letterBuckets!.get(w[0]) ?? [];
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

/** 导入：file(.pdf/.txt/.csv) + 状态(auto=按标题识别)，返回结果并落进度。 */
export async function runWordImport(
    file: File,
    status: WordImportStatus | "auto",
    p: WenguWordProgress
): Promise<WordImportResult> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text: string;
    const isTextFile = /\.(txt|csv)$/i.test(file.name);
    if (isTextFile) {
        text = new TextDecoder("utf-8").decode(bytes);
    } else {
        text = await extractPdfText(bytes);
        // PDF 空文本 = 无文字层（扫描件）；txt 路径不做此判（小清单也合法）
        if (extractWords(text).length < 5) {
            return { hit: 0, miss: 0, missSample: [], autoStatus: null, error: "noTextLayer" };
        }
    }
    let autoStatus: WordImportStatus | null = null;
    if (status === "auto") {
        for (const [k, kw] of STATUS_KEYWORDS) {
            if (text.includes(kw)) {
                autoStatus = k;
                break;
            }
        }
    }
    const apply = status === "auto" ? (autoStatus ?? "unlearned") : status;
    // 匹配词书（精确优先，lev≤1 兜底）
    const hits = new Set<number>();
    const miss: string[] = [];
    for (const w of extractWords(text)) {
        const lw = w.toLowerCase();
        let idx = WORD_BOOK.words.findIndex((e) => e.w.toLowerCase() === lw);
        if (idx < 0) {
            idx = bucketOf(lw).find((b) => lev1(b.w, lw))?.i ?? -1;
        }
        if (idx >= 0) hits.add(idx);
        else if (miss.length < 50) miss.push(w);
    }
    if (hits.size === 0)
        return { hit: 0, miss: miss.length, missSample: miss.slice(0, 5), autoStatus, error: "noMatch" };
    applyStatus(p, hits, apply);
    // cursor = 书序上第一个未学词
    for (let i = 0; i < WORD_BOOK.words.length; i++) {
        if (!p.words[String(i)]) {
            p.cursor = i;
            break;
        }
    }
    return { hit: hits.size, miss: miss.length, missSample: miss.slice(0, 5), autoStatus };
}

/** 按状态写进度（不触碰误认本）。 */
function applyStatus(p: WenguWordProgress, idxs: Set<number>, apply: WordImportStatus): void {
    const now = Date.now();
    for (const i of idxs) {
        const key = String(i);
        if (apply === "unlearned") {
            delete p.words[key];
            delete p.simple[key];
            delete p.familiar[key];
        } else if (apply === "reviewing") {
            p.words[key] = [2, now + 86400_000];
            delete p.familiar[key];
            delete p.simple[key];
        } else if (apply === "done") {
            p.words[key] = [5, now + 8 * 86400_000];
            delete p.familiar[key];
            delete p.simple[key];
        } else {
            p.words[key] = [6, now + 32 * 86400_000];
            p.familiar[key] = 1;
        }
    }
    rollToday(p, now);
    p.log[todayKey(now)] = [p.today.newCount, p.today.revCount];
}
