#!/usr/bin/env node
/**
 * 「单文件 ≤500 行」红线门禁（规范 design-spec.md §11.1，Issue #135 顺带落地）。
 *
 * 此前这条只在文档里写着——`quiz/index.ts` 从「基线 574」静默长到 576
 * 就是「口径有、闸门无」的实证。本脚本把它变成 CI 会红的东西：
 *   - 默认红线 500 行；
 *   - **豁免额度即上限**（EXEMPTS 表）：豁免不是免死金牌，越线照样红；
 *   - 生成数据文件（`src/word/data/**`）不参与（脚本产出、勿手改）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// 用 fileURLToPath 而非 URL.pathname：Windows 下 pathname 会给出 `/C:/proj/`，
// 再交给 node:path 的 join 就拼成 `C:\C:\proj\src`，脚本直接崩（#135 复核）。
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LIMIT = 500;

/** 豁免表：路径（posix 相对仓库根）→ 上限（= 当前行数，只许减不许增）。 */
const EXEMPTS = new Map([
    ["src/quiz/index.ts", 574], // 编排内聚，访问器表+编排职责外移破坏内聚（#135 已压回 574）
    // 存量超线（规范 §11.1「❌ 待修」清单，未在 #135 改动面内）——额度＝当前行数，只许减不许增
    ["src/ai/core/SessionDetail.test.ts", 608],
    ["src/convert/service/run/ConvertBatch.ts", 503],
]);

/** 生成数据文件整目录豁免。 */
const GENERATED_PREFIXES = ["src/word/data/"];
const EXT = /\.(ts|svelte|scss)$/;

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, out);
        else if (EXT.test(name)) out.push(p);
    }
    return out;
}

/** 行数口径与 `wc -l` 一致：以换行符计（尾随换行不算多一行）。 */
function lineCount(abs) {
    const text = readFileSync(abs, "utf8");
    let n = 0;
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
    return text.length > 0 && !text.endsWith("\n") ? n + 1 : n;
}

const files = walk(join(ROOT, "src")).map((p) => relative(ROOT, p).split(sep).join("/"));
const bad = [];
const stale = [];
for (const rel of files) {
    if (GENERATED_PREFIXES.some((pre) => rel.startsWith(pre))) continue;
    const lines = lineCount(join(ROOT, rel));
    const cap = EXEMPTS.get(rel) ?? LIMIT;
    if (lines > cap) bad.push(`${rel}: ${lines} > ${cap}`);
}
// 反向检查：豁免额度若已高于实际，额度没收（防「豁免写了就不管」）
for (const [rel, cap] of EXEMPTS) {
    if (!files.includes(rel)) continue;
    const lines = lineCount(join(ROOT, rel));
    if (lines < cap - 5) stale.push(`${rel}: ${lines} 行，低于豁免额度 ${cap}（请同步收额度）`);
}

if (bad.length) {
    console.error("单文件行数超线（规范 §11.1）：\n  " + bad.join("\n  "));
    process.exit(1);
}
if (stale.length) console.warn("豁免额度可收紧：\n  " + stale.join("\n  "));
console.log(`line-limit ok：${files.length} 个文件全部在限内`);
