/**
 * 音标数据生成脚本（一次性，重跑刷新）：从 ECDICT(MIT,
 * skywind3000/ECDICT) 的 ecdict.csv 提取 word→英式IPA，输出
 * src/word/data/phonetics-data.ts（单字符串 `key ipa\n` 行集，运行时
 * 惰性解析，见 service/WordPhonetics）。
 *
 * 口径：①学习词标签（zk/gk/cet4/cet6/ky/toefl/ielts/gre）②有词频
 * （bnc/frq>0）两档并集 ~3.8 万条 ~680KB——覆盖一切常见词书；内置书
 * 词全量兜底（书内词不受档位限制，csv 里查到音标即收）。key 用
 * wordKey 同款归一（小写去空格/连字符/撇号），与进度 key 对齐。
 *
 * 用法：node scripts/gen-phonetics.mjs /path/to/ecdict.csv
 * （下载：https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv ~63MB）
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const csvPath = process.argv[2];
if (!csvPath) {
    console.error("usage: node scripts/gen-phonetics.mjs <ecdict.csv>");
    process.exit(1);
}

/** 内置书词头（words-p*.ts 是纯 [["w","m"],…] 数组字面量，正则提取） */
function builtinWords() {
    const dir = join(root, "src/word/data");
    const set = new Set();
    for (const f of readdirSync(dir)) {
        if (!/^words-p\d+\.ts$/.test(f)) continue;
        const text = readFileSync(join(dir, f), "utf8");
        for (const m of text.matchAll(/\["([^"]+)",\s*"(?:[^"\\]|\\.)*"\]/g)) {
            set.add(m[1].toLowerCase().replace(/[\s'-]/g, ""));
        }
    }
    return set;
}

/** CSV 行前 n 列解析（状态机，处理 "" 转义与引号内逗号） */
function cols(line, n) {
    const out = [];
    let cur = "",
        q = false,
        f = 0;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else q = false;
            } else cur += c;
        } else if (c === '"') q = true;
        else if (c === ",") {
            out[f++] = cur;
            cur = "";
            if (f >= n) return out;
        } else cur += c;
    }
    out[f] = cur;
    return out;
}

const norm = (w) => w.toLowerCase().replace(/[\s'-]/g, "");
/** ecdict 音标风格 → 规范 IPA：' 重音 → ˈ，长音 : → ː */
const ipaNorm = (s) => s.trim().replace(/'/g, "ˈ").replace(/:/g, "ː");

const builtin = builtinWords();
const picked = new Map(); // key -> ipa
let needBuiltin = new Set(builtin); // 尚未命中的内置词（任意档兜底，全表扫完再补）

const lines = readFileSync(csvPath, "utf8").split(/\r?\n/);
for (const line of lines) {
    if (!line) continue;
    const c = cols(line, 10); // word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq
    const w = c[0],
        phRaw = c[1];
    if (!w || !phRaw) continue;
    if (!/^[a-zA-Z][a-zA-Z\s'-]*$/.test(w)) continue;
    const ipa = ipaNorm(phRaw);
    if (!ipa || ipa.length > 40) continue;
    const key = norm(w);
    if (picked.has(key)) continue;
    const tag = c[7] || "",
        bnc = +c[8] || 0,
        frq = +c[9] || 0;
    const study = /zk|gk|cet4|cet6|ky|toefl|ielts|gre/.test(tag);
    if (study || bnc > 0 || frq > 0) {
        picked.set(key, ipa);
        needBuiltin.delete(key);
    }
}
// 内置书词兜底：第二遍全表扫，档位不限
if (needBuiltin.size > 0) {
    for (const line of lines) {
        if (needBuiltin.size === 0) break;
        if (!line) continue;
        const c = cols(line, 2);
        const w = c[0],
            phRaw = c[1];
        if (!w || !phRaw) continue;
        const key = norm(w);
        if (!needBuiltin.has(key)) continue;
        const ipa = ipaNorm(phRaw);
        if (!ipa || ipa.length > 40) continue;
        picked.set(key, ipa);
        needBuiltin.delete(key);
    }
    console.log("builtin words not found in csv:", needBuiltin.size);
}

const body = [...picked.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k} ${v}`)
    .join("\n");
const esc = body.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const out = `/**
 * 生成文件（scripts/gen-phonetics.mjs 从 ECDICT(MIT) 提取，勿手改）：
 * 每行 "归一化词头 音标"，运行时惰性解析进 Map（service/WordPhonetics）。
 * 口径：学习词标签 ∪ 有词频 ∪ 内置书词全量兜底。
 */
// eslint-disable-next-line
export const PHONETICS_RAW = \`${esc}\`;
`;
writeFileSync(join(root, "src/word/data/phonetics-data.ts"), out);
console.log("entries:", picked.size, "bytes:", body.length, `(builtin ${builtin.size})`);
