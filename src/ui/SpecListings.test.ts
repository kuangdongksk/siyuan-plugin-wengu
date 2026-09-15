import { describe, expect, it } from "vitest";
import * as sass from "sass";

/**
 * 规范清单与代码同步门禁（Issue #120，规范 `docs/design-spec.md` §〇2 / §〇5）。
 *
 * §〇2 把「i18n 键 / CSS 令牌 / sprite id」归为**同类静默失败**：
 * 引用写错不报错，只是观感/文案落空 ⇒「凡带清单的引用，必须有清单 + 断言」。
 * §6.2 与 §1.1 各落了一张清单（sprite id 全表、令牌全名白名单），本文件把
 * 「代码里的每个引用都在清单内」变成 CI 会红的东西——**清单滞后于代码**正是
 * 整改 E 复核时抓到的实际缺陷（三个在用 id 曾不在表内）。
 *
 * ⚠️ 读取口径（同 `ButtonVariants.test.ts` / `StartPanelStyle.test.ts`）：
 * - md / ts / svelte 走 vitest 的 `?raw`；**scss 的 `?raw` 恒为空串**
 *   （vitest 默认 `css:false`），故 scss 只取 **glob key 当文件清单**、
 *   内容交给 `sass.compile` 真编译（编译产物才是真落进页面的东西）。
 * - 本仓无 `@types/node`，不引 `node:fs` / `node:url`。
 */

const RAW = import.meta.glob("../**/*.{ts,svelte}", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

/** 规范文本（docs/ 在 src 之外，单独 glob 一条）。 */
const SPEC_RAW =
    (
        import.meta.glob("../../docs/design-spec.md", { query: "?raw", import: "default", eager: true }) as Record<
            string,
            string
        >
    )["../../docs/design-spec.md"] ?? "";

/** scss 文件清单（`?raw` 对 scss 恒空串，故只借 key 当路径表）。 */
const SCSS_FILES = Object.keys(
    import.meta.glob("../**/*.scss", { query: "?raw", import: "default", eager: true }) as Record<string, string>
);

/** glob key → 「项目根相对路径」（本文件在 `src/ui/`，故键以 `../` 起步）。 */
const relOf = (k: string): string => `src/${k.replace(/^\.\.\//, "")}`;

/** 「项目代码」语料：排除测试与 i18n 字典（它们不是引用方）。 */
const CODE = Object.entries(RAW)
    .filter(([k]) => !/\.test\.ts$/.test(k))
    .filter(([k]) => !/^src\/i18n\//.test(relOf(k)))
    .map(([k, v]) => [relOf(k), v] as const);

/** 规范 §6.2 的 sprite id 清单（代码块内的 `icon*`）。 */
function specIconIds(): Set<string> {
    const sec = SPEC_RAW.split("### 6.2")[1]?.split("### 6.3")[0] ?? "";
    const fence = /```([\s\S]*?)```/.exec(sec)?.[1] ?? "";
    return new Set(fence.match(/icon[A-Za-z]+/g) ?? []);
}

/**
 * 规范 §1.1 的令牌白名单。
 *
 * ⚠️ 表格用**缩写记法**列出：`` `--b3-theme-primary` / `-light` ``。续写项有两种
 * 真实语义——「追加」（`--b3-theme-primary` + `-light`）与「换尾段」
 * （`--b3-theme-on-background` → `-on-surface`，实际是 `--b3-theme-on-surface`，
 * 不是 `…-on-background-on-surface`），另有 `--b3-border-radius` → `-radius-b`
 * 这类「截一段再接」。
 *
 * 故对每个续写项，把**基名的各段前缀**都拼一遍取并集（`--b3`、
 * `--b3-theme`、`--b3-theme-on` …）。白名单是**允许集**：多收只降低严格度、
 * 不产生误报；而「代码用了表外令牌」这个真信号仍由被列出的名字守住。
 */
function specTokens(): Set<string> {
    const sec = SPEC_RAW.split("### 1.1")[1]?.split("### 1.2")[0] ?? "";
    const out = new Set<string>();
    for (const line of sec.split("\n")) {
        if (!line.trim().startsWith("|") || !line.includes("--b3-")) continue;
        const cell = line.split("|")[1] ?? "";
        let base: string | undefined;
        for (const part of cell.split("/").map((p) => p.trim())) {
            const full = /^`(--b3-[a-z0-9-]+)`/.exec(part);
            if (full) {
                base = full[1];
                out.add(full[1]);
                continue;
            }
            const suffix = /^`(-[a-z0-9-]+)`/.exec(part);
            if (!suffix || !base) continue;
            out.add(`${base}${suffix[1]}`); // 追加式
            const segs = base.slice(2).split("-"); // 去 `--` 后按段切
            for (let i = 1; i <= segs.length; i++) {
                out.add(`--${segs.slice(0, i).join("-")}${suffix[1]}`); // 各段前缀 + 续写
            }
        }
    }
    return out;
}

/** 代码在用的 sprite id（`svgIcon("…")` 等字面量 + 裸 `<use>` 的 href）。 */
function usedIconIds(): Map<string, string> {
    const hits = new Map<string, string>();
    for (const [rel, src] of CODE) {
        for (const m of src.matchAll(/["'`](icon[A-Za-z]+)["'`]/g)) hits.set(m[1], rel);
        for (const m of src.matchAll(/xlink:href="#(icon[A-Za-z]+)"/g)) hits.set(m[1], rel);
    }
    return hits;
}

/** 剥**注释**（块 / 行）：注释里复述「写法」不算代码在用（同
 *  `ButtonVariants.test.ts` 与审计 #112 的「注释命中是假死键」口径）。 */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** 代码在用的 `--b3-*` 令牌：scss 走真编译，ts/svelte 走源码文本（剥注释）。 */
function usedTokens(): Map<string, string> {
    const hits = new Map<string, string>();
    for (const [rel, src] of CODE) {
        for (const m of stripComments(src).matchAll(/var\((--b3-[a-z0-9-]+)/g)) hits.set(m[1], rel);
    }
    for (const file of SCSS_FILES) {
        // 编译吃「项目根相对路径」（vitest 的 cwd 即仓库根）
        const css = sass.compile(relOf(file)).css;
        for (const m of css.matchAll(/var\((--b3-[a-z0-9-]+)/g)) hits.set(m[1], relOf(file));
    }
    return hits;
}

describe("规范 §6.2 · sprite id 清单与代码同步", () => {
    it("代码在用的每个 icon id 都在规范清单内", () => {
        const listed = specIconIds();
        expect(listed.size).toBeGreaterThan(20); // 清单被读到，防「扫空即全绿」
        const missing = [...usedIconIds()].filter(([id]) => !listed.has(id));
        expect(missing.map(([id, rel]) => `${id} (${rel})`)).toEqual([]);
    });

    it("扫描面非空 + 捏造 id 必落空（防假阳性）", () => {
        const used = usedIconIds();
        expect(used.size).toBeGreaterThan(20);
        expect(used.has("__iconNotReal__")).toBe(false);
        expect(specIconIds().has("__iconNotReal__")).toBe(false);
    });
});

describe("规范 §1.1 · 令牌白名单与代码同步", () => {
    it("代码在用的每个 --b3-* 令牌都在白名单内", () => {
        const listed = specTokens();
        expect(listed.size).toBeGreaterThan(20);
        const tokens = usedTokens();
        expect(tokens.size).toBeGreaterThan(20);
        const missing = [...tokens].filter(([t]) => !listed.has(t));
        expect(missing.map(([t, rel]) => `${t} (${rel})`)).toEqual([]);
    });

    it("scss 编译面确实读到了令牌（防「scss 没读进来」的假阳性）", () => {
        const fromScss = SCSS_FILES.flatMap((f) => [
            ...sass.compile(relOf(f)).css.matchAll(/var\((--b3-[a-z0-9-]+)/g),
        ]).map((m) => m[1]);
        expect(SCSS_FILES.length).toBeGreaterThan(15);
        expect(fromScss.length).toBeGreaterThan(50);
        expect(fromScss).toContain("--b3-theme-primary");
    });
});
