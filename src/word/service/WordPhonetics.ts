import { PHONETICS_RAW } from "../data/phonetics-data";
import { wordKey } from "./WordBook";

/**
 * 词头音标（20260901 听音选义展示读音）：自带 ECDICT(MIT) 提取的
 * 音标表（data/phonetics-data.ts，生成文件勿手改，学习词∪有词频∪
 * 内置书兜底 ~4.7 万条），按归一化词头查——零网络零费用，导入书同权
 * （词典 API 在本机网络不通，见 scripts/gen-phonetics.mjs 头注）。
 * 整表惰性解析：bundle 里只是一段字符串，首次展示音标才 split 建
 * Map（~5 万行，一次几十 ms，单词面板首卡可感知而已）。
 */

let map: Map<string, string> | undefined;
let pending: Promise<void> | undefined;

function parseRaw(raw: string): Map<string, string> {
    const m = new Map<string, string>();
    for (const line of raw.split("\n")) {
        const i = line.indexOf(" ");
        if (i <= 0) continue;
        const k = line.slice(0, i);
        const v = line.slice(i + 1);
        if (v && !m.has(k)) m.set(k, v);
    }
    return m;
}

/** 确保音标表已解析（幂等；展示侧 await 后再读 phoneticsOf）。 */
export function phoneticsReady(): Promise<void> {
    if (!pending) {
        pending = Promise.resolve().then(() => {
            map = parseRaw(PHONETICS_RAW);
        });
    }
    return pending;
}

/** 查词头音标（表未就绪返回 undefined）。 */
export function phoneticsOf(word: string): string | undefined {
    return map?.get(wordKey(word));
}

/** 测试注入口：直接以行集替换整表（生产走 phoneticsReady）。 */
export function loadPhoneticsRaw(raw: string): void {
    map = parseRaw(raw);
}
