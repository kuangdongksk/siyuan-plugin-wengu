import meta from "./data/wordbook-meta";
import parts from "./data/words-index";

/**
 * 内置词书组装层：词条分片（data/words-p*.ts）与单元元数据
 * （data/wordbook-meta.ts）都是脚本生成的，本文件只做拼接，
 * 换词书时重跑生成脚本即可，不手改。
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
    units: WenguWordUnitMeta[];
}

const WORD_BOOK: WenguWordBookData = {
    version: meta.version,
    id: meta.id,
    title: meta.title,
    words: parts.map(([w, m]) => ({ w, m })),
    units: meta.units.map(([u, start, count, title]) => ({ u, start, count, title })),
};

export default WORD_BOOK;
