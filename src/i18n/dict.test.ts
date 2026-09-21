import { describe, expect, it } from "vitest";
import zh from "./zh-CN.json";
import en from "./en.json";

/**
 * i18n 字典门禁（Issue #120，规范 `docs/design-spec.md` §8.1 / §8.3 / §8.4）。
 *
 * 这组断言锁的是**静默降级**这条通道：插件取词是 `i18n[k] || k`，
 * **缺键与空串值都会把键名直接渲染给用户**（truthy 回落），不报错。
 * 故字典的四条不变量必须机器守住，而不是靠人工盘点：
 *   1. 中英键集合相等（对称差 0）；
 *   2. 零空值；
 *   3. 占位符集合两语言对齐（`{n}` 只能对 `{n}`）；
 *   4. 死键清零（动态键族除外，见下登记表）。
 *
 * ⚠️ 源文件扫描经 vitest 的 `?raw` 导入（本仓无 `@types/node`，
 * 不用 `node:fs`，同 `SubheadHtml.test.ts` 的口径）。
 */

const ZH = zh as Record<string, string>;
const EN = en as Record<string, string>;

/** 动态键族登记表（规范 §8.3）：族名 + 数据源枚举出处。
 *  ⚠️ 拼出来的键无法静态判定死活，**新增动态族必须在此登记**，
 *  否则会被下面的死键断言误报（或真死键漏报）。 */
const DYNAMIC_FAMILIES: { pattern: RegExp; source: string }[] = [
    { pattern: /^weakCause/, source: "bank/data/WeaknessStore 的 WeakCause 枚举" },
    { pattern: /^matchFail_/, source: "convert/service/knowledge/KnowRoute 的 MatchFailKind 枚举" },
];

const placeholders = (s: string): string =>
    [...s.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(",");

/** 无参标题（动作名本身已是完整文案，如「变式重练」）。 */
const NO_ARG_TITLES = ["aiTitleVariant"];

describe("i18n 字典门禁", () => {
    it("中英键集合相等（对称差 0）", () => {
        const zk = Object.keys(ZH).sort();
        const ek = Object.keys(EN).sort();
        expect(zk.filter((k) => !(k in EN))).toEqual([]);
        expect(ek.filter((k) => !(k in ZH))).toEqual([]);
        expect(zk.length).toBe(ek.length);
    });

    it("零空值（缺键/空串都会把键名渲染给用户）", () => {
        expect(Object.entries(ZH).filter(([, v]) => !String(v).trim())).toEqual([]);
        expect(Object.entries(EN).filter(([, v]) => !String(v).trim())).toEqual([]);
    });

    it("占位符集合两语言对齐", () => {
        const bad = Object.keys(ZH).filter((k) => placeholders(ZH[k]) !== placeholders(EN[k]));
        expect(bad).toEqual([]);
    });
});

describe("AI 会话记录标题 i18n（规范 §8.6）", () => {
    it("aiTitle* 键族齐备且带 {name}/{n} 参数", () => {
        const keys = Object.keys(ZH).filter((k) => k.startsWith("aiTitle"));
        expect(keys.length).toBeGreaterThanOrEqual(23);
        for (const k of keys) {
            if (NO_ARG_TITLES.includes(k)) continue;
            expect(ZH[k], k).toMatch(/\{(name|n)\}/);
            expect(EN[k], k).toMatch(/\{(name|n)\}/);
        }
    });
});

/**
 * 死键清零 + **键名注册（反向）** + AI title 无硬编码：都要**扫全仓源码**。
 * 因无 `node:fs`，用 vitest 的 `import.meta.glob` + `?raw` 把源码读进来
 * （`eager` 同步可得）。
 *
 * ⚠️ 两个方向各一条闸，缺一不可（Issue #201 复核补齐反向）：原先只有
 * 「字典有、代码没用」（§8.4 死键），反方向「**代码用了、字典没有**」
 * 无闸——而它更致命：取词是 `i18n[k] || k`，缺键**不报错**，直接把键名
 * 当正文渲染给用户（#201 实测：A3 落点用了 `aiTitleJevChange` 而两字典
 * 都没这一键，面板那条记录的行名就是字面量 `aiTitleJevChange`；既有三条
 * 门禁逐条都扫不到它——死键闸方向相反、§8.6 只查 `title: "中文…"`
 * 硬编码、键族齐备闸只查字典内已有的键）。
 */
const SRC = import.meta.glob("../**/*.{ts,svelte}", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
>;

/** glob key 相对**本测试文件**（`./dict.test.ts` / `../ui/...`）——统一成
 *  「相对 src/」的展示名；i18n 域自身的文件（字典 + 本测试）不进扫描面。 */
const relOf = (k: string): string => (k.startsWith("./") ? `i18n/${k.slice(2)}` : k.replace(/^\.\.\//, ""));

const SOURCE_FILES = Object.entries(SRC)
    .filter(([k]) => !/\.json$/.test(k))
    .filter(([k]) => !/^i18n(\/|$)/.test(relOf(k)))
    .map(([k, v]) => [relOf(k), v] as const);

describe("死键清零（规范 §8.4）", () => {
    it("字典里的每个键都在源码里有引用（排除已登记的动态键族）", () => {
        const code = SOURCE_FILES.map(([, v]) => v).join("\n");
        const dead = Object.keys(ZH).filter((k) => {
            if (DYNAMIC_FAMILIES.some((f) => f.pattern.test(k))) return false;
            // 词边界命中即算「有引用」：字符串字面量、模板串、
            // `this.i18n.xxx` 的属性式访问三种形态都落在 \b 上。
            return !new RegExp(`\\b${k}\\b`).test(code);
        });
        expect(dead).toEqual([]);
    });

    it("动态键族登记表非空（新增动态族必须登记，否则上述断言会误报）", () => {
        expect(DYNAMIC_FAMILIES.length).toBeGreaterThan(0);
        for (const f of DYNAMIC_FAMILIES) expect(f.source.length).toBeGreaterThan(0);
    });

    it("扫描面非空 + 哨兵键能被判死（防「扫空即全绿」的假阳性）", () => {
        expect(SOURCE_FILES.length).toBeGreaterThan(150);
        const code = SOURCE_FILES.map(([, v]) => v).join("\n");
        // 真键必命中、捏造键必落空 —— 两条一起证明扫描面确实读到了源码
        expect(/\baiTitleConvert\b/.test(code)).toBe(true);
        expect(/\b__definitely_not_a_real_key__\b/.test(code)).toBe(false);
    });
});

describe("AI 会话 title 不再硬编码中文（规范 §8.6）", () => {
    it('源码里没有 `title: "中文…"` 形态的会话标题', () => {
        const hits: string[] = [];
        for (const [rel, src] of SOURCE_FILES) {
            if (/\.test\.ts$/.test(rel)) continue;
            // prompt 常量区与示例数据不在「用户可见文案」范围
            if (rel.startsWith("ai/prompts/") || rel.startsWith("word/data/")) continue;
            src.split("\n").forEach((line, i) => {
                if (/(^|\s)(title|label):\s*[`"'][^`"']*[\u4e00-\u9fa5]/.test(line)) {
                    hits.push(`${rel}:${i + 1} ${line.trim()}`);
                }
            });
        }
        // 已知合法例外：SettingsDialog 的 title 是 `${pluginName} · ${t("settingsTitle")}`
        // ——中文来自 t() 取词，不是硬编码；wordbook-meta 的 title 是**词书名**
        // （数据，不是 UI 文案）。
        expect(hits.filter((h) => !h.startsWith("ui/SettingsDialog") && !h.startsWith("word/data/"))).toEqual([]);
    });
});

describe("键名注册（反向门禁：用了就必须在字典里）", () => {
    /** 取词调用形态：`t("k")` / `tKey("k")` / `translate("k")`（第一实参）。 */
    const T_CALL = /\b(?:t|tKey|translate)\(\s*["'`]([a-zA-Z][A-Za-z0-9_]*)["'`]/g;
    /** 命名分域前缀（规范 §8.2 保留族）：这些族的字面量一律当 i18n 键。 */
    const FAMILY = /["'`]((?:aiTitle|aiKind|aiFlow)[A-Z][A-Za-z0-9_]*)["'`]/g;

    /** 剥注释（规范 §8.4 的既定口径："ts/svelte 走源码文本并剥注释"）。
     *  **本闸必须剥**：注释里拿反引号复述代码标识符（如 `\`aiFlowBegin\``
     *  指那个单飞闸函数）会被当成 i18n 键而误红——实测踩过。用一个
     *  状态机而不是正则，免得字符串里的 `//`（`https://…`）截断整行、
     *  连带吞掉同行后面的真键。 */
    const stripComments = (src: string): string => {
        let out = "";
        let i = 0;
        let quote = ""; // 当前所在字符串的引号（含反引号）
        while (i < src.length) {
            const c = src[i];
            const d = src[i + 1];
            if (quote) {
                if (c === "\\") {
                    out += c + (d ?? "");
                    i += 2;
                    continue;
                }
                if (c === quote) quote = "";
                out += c;
                i++;
                continue;
            }
            if (c === "/" && d === "*") {
                const end = src.indexOf("*/", i + 2);
                i = end < 0 ? src.length : end + 2;
                continue;
            }
            if (c === "/" && d === "/") {
                const end = src.indexOf("\n", i);
                i = end < 0 ? src.length : end;
                continue;
            }
            if (c === '"' || c === "'" || c === "`") quote = c;
            out += c;
            i++;
        }
        return out;
    };

    const scan = (): { n: number; missing: string[] } => {
        const missing: string[] = [];
        let n = 0;
        for (const [rel, src] of SOURCE_FILES) {
            if (/\.test\.(ts|svelte)$/.test(rel)) continue; // 捏造键是测试的正当手段
            const code = stripComments(src);
            for (const re of [T_CALL, FAMILY]) {
                for (const m of code.matchAll(new RegExp(re.source, "g"))) {
                    n++;
                    if (!(m[1] in ZH) || !(m[1] in EN)) missing.push(`${rel} -> ${m[1]}`);
                }
            }
        }
        return { n, missing };
    };

    it("源码里用的键全在字典里（两侧都缺＝用户看到键名）", () => {
        const { n, missing } = scan();
        // 扫描面非空自检：正则写坏会「扫 0 条 ⇒ 全绿」，故先钉住量级
        expect(n).toBeGreaterThan(800);
        expect([...new Set(missing)]).toEqual([]);
    });

    it("哨兵键能被判出（防正则失配的假阳性）", () => {
        // 反向证明扫描面真的读到了源码：捏造键必落空
        expect("aiTitle__definitely_missing__" in ZH).toBe(false);
        expect(/\b(?:t|tKey|translate)\(\s*["'`](x)/.test('t("x")')).toBe(true);
    });
});
