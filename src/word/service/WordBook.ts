import meta from "../data/wordbook-meta";
import parts from "../data/words-index";

/**
 * 词书模型与内置书（redesign §四/§五，20260828）：运行时词书 =
 * {id,title,words,units?}（units 可缺——导入书无单元概念，干扰项回落
 * 全书池）；词条分片与单元元数据都是脚本生成的（data/words-p*.ts /
 * wordbook-meta.ts），换内置词书重跑生成脚本即可，不手改。
 *
 * 多词书的清单/落盘/切换在 service/WordLib.ts；本文件只管模型与
 * 内置书（首次启动由 WordLib 落盘成工作区文件，与导入书同权）。
 */

/** 词表里的一个词条：单词 + 释义（含词性前缀）。 */
export interface WenguWordEntry {
    w: string;
    m: string;
}

/** 词书单元。start/count 指向扁平词条数组的下标区间。 */
export interface WenguWordUnitMeta {
    u: number;
    title: string;
    start: number;
    count: number;
}

export interface WenguWordBookData {
    version: number;
    id: string;
    title: string;
    words: WenguWordEntry[];
    units?: WenguWordUnitMeta[];
}

/** 内置《你还在背单词吗》（刘晓艳·2026，词源见 docs/wordbook-lxy.md）。 */
export const BUILTIN_BOOK: WenguWordBookData = {
    version: 1,
    id: meta.id,
    title: meta.title,
    words: parts.map(([w, m]) => ({ w, m })),
    units: meta.units.map(([u, start, count, title]) => ({ u, start, count, title })),
};

/** 归一化词头（进度 key，redesign §五）：小写、去空格/连字符/撇号——
 * 同词跨书共享进度靠它对齐（拼写判定 spellMatches 同规则）。 */
export function wordKey(w: string): string {
    return w.toLowerCase().replace(/[\s\-']/g, "");
}

/** 词在书内的进度 key（idx 越界返回空串，调用方按无进度处理）。 */
export function keyOf(book: WenguWordBookData, idx: number): string {
    return book.words[idx] ? wordKey(book.words[idx].w) : "";
}

/* ── 词书文件的线上格式（data/wengu/wordbooks/{id}.json，紧凑数组） ── */

interface BookFile {
    version: number;
    id: string;
    name: string;
    words: [string, string][];
    units?: [number, number, number, string][];
}

/** 运行时词书 → 落盘 JSON 文本。 */
export function bookToFile(b: WenguWordBookData): string {
    const f: BookFile = {
        version: 1,
        id: b.id,
        name: b.title,
        words: b.words.map((e) => [e.w, e.m]),
    };
    if (b.units?.length) f.units = b.units.map((u) => [u.u, u.start, u.count, u.title]);
    return JSON.stringify(f);
}

/** 词书文件文本 → 运行时词书；格式不合法返回 undefined。 */
export function bookFromFile(text: string, fallbackId: string): WenguWordBookData | undefined {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (_) {
        return undefined;
    }
    const f = raw as Partial<BookFile>;
    if (!f || !Array.isArray(f.words) || f.words.length === 0) return undefined;
    const words = f.words
        .filter((p): p is [string, string] => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string")
        .map(([w, m]) => ({ w: w.trim(), m: m.trim() }))
        .filter((e) => e.w);
    if (words.length === 0) return undefined;
    return {
        version: 1,
        id: (typeof f.id === "string" && f.id.trim()) || fallbackId,
        title: (typeof f.name === "string" && f.name.trim()) || fallbackId,
        words,
        units: Array.isArray(f.units)
            ? f.units
                  .filter((u): u is [number, number, number, string] => Array.isArray(u) && u.length === 4)
                  .map(([u, start, count, title]) => ({ u, start, count, title }))
            : undefined,
    };
}
