import { describe, expect, it } from "vitest";
import { mustHave, read } from "../../testkit/readSource";
import zh from "../../i18n/zh-CN.json";
import en from "../../i18n/en.json";

/**
 * 六落点接线锁（Issue #201）：判定层都支持 `track` 了，但**没人传**的话
 * 面板里一条记录也不会出现——本文件把「每个落点确实把 track 传下去了」
 * 钉成机械断言（源级读源码：真跑六条业务链要拖进题库/文档/内核一大串）。
 *
 * 断言只认事实：该文件里存在 `track:`（或落点自己的组装函数调用）。
 */

const SITES: { path: string; needle: string }[] = [
    // A1 转换质检（重建链路）
    { path: "/src/convert/service/run/ConvertQc.ts", needle: 'track: jevTrackOf("aiTitleJevConvert", docTitle)' },
    // A2 切片预筛（重建链路窗口 + 增量链）
    { path: "/src/convert/service/run/ConvertQc.ts", needle: 'track: jevTrackOf("aiTitleJevScreen", docTitle)' },
    { path: "/src/convert/service/run/ConvertIncrement.ts", needle: 'jevTrackOf("aiTitleJevScreen", run.title)' },
    // A3 增量变更实质判定（编排层把标集名递下去）
    { path: "/src/convert/service/run/ConvertChangeScreen.ts", needle: "...(opts.track ? { track: opts.track } : {})" },
    { path: "/src/quiz/service/DocOps.ts", needle: 'aiTitle(t, "aiTitleJevChange"' },
    // A4 填空判同
    { path: "/src/quiz/service/GapJudge.ts", needle: "track: gapJudgeTrack(no)" },
    // A5 单词判档
    { path: "/src/word/service/WordAiJev.ts", needle: "track: wordReviewTrack(inputs.length)" },
    // A6 同义词判定
    { path: "/src/bank/data/KnowSynJev.ts", needle: 'aiTitle(tKey, "aiTitleJevSyn"' },
];

/** 全仓源码（源级扫描面；口径同 `i18n/dict.test.ts` 的死键扫描段）。 */
const SRC = import.meta.glob("../../**/*.{ts,svelte}", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
>;

/** glob key 相对本测试文件（`./x` / `../../x`）——统一成「相对 src/」的展示名；
 *  i18n 域与测试自身不进扫描面。 */
const relOf = (k: string): string => {
    const r = k.replace(/^\.\//, "").replace(/^\.\.\/\.\.\//, "");
    return r.replace(/^\.\.\//, "");
};

const SOURCE_FILES = Object.entries(SRC)
    .filter(([k]) => !/\.json$/.test(k))
    .map(([k, v]) => [relOf(k), v] as const)
    .filter(([k]) => !/^i18n(\/|$)/.test(k) && !/^\.\//.test(k));

describe("六落点接线（Issue #201）", () => {
    it("每个落点都把 track 传给判定层（缺一处 = 面板里永远看不到该类判定）", async () => {
        const cache = new Map<string, string>();
        for (const site of SITES) {
            mustHave(site.path);
            cache.set(site.path, cache.get(site.path) ?? (await read(site.path)));
            expect(cache.get(site.path), `${site.path} 缺 ${site.needle}`).toContain(site.needle);
        }
    });

    it("判定层四入口都留了 track 口子（可选，缺省=不登记）", async () => {
        for (const p of [
            "/src/ai/jev/client.ts",
            "/src/ai/jev/convertChecks.ts",
            "/src/ai/jev/chunkScreen.ts",
            "/src/ai/jev/changeJudge.ts",
        ]) {
            mustHave(p);
            expect(await read(p), p).toMatch(/track\?: JevTrack|track\?: \{ title: string/);
        }
    });

    it("同族键守卫：src 里引用的每个 `aiTitleJev*` 键必须两字典都在", async () => {
        // 幽灵键坑（ai.md #93 / Issue #201 复核）：`t()` 缺键回落**键名**，
        // 面板上直接显示字面量；dict.test 只锁中英对称，**两边都缺它不报**。
        // 故按「源里引用的键」反向核对字典（两个方向都查：源→字典）。
        const DICT = new Set([
            ...Object.keys(zh as Record<string, string>),
            ...Object.keys(en as Record<string, string>),
        ]);
        const ZH = zh as Record<string, string>;
        const EN = en as Record<string, string>;
        const seen = new Map<string, string[]>(); // key -> 引用它的文件
        for (const [rel, src] of SOURCE_FILES) {
            if (/\.test\.ts$/.test(rel)) continue;
            for (const m of src.matchAll(/["'`](aiTitleJev[A-Za-z0-9_]*)["'`]/g)) {
                const k = m[1];
                seen.set(k, [...(seen.get(k) ?? []), rel]);
            }
        }
        expect(seen.size).toBeGreaterThanOrEqual(5); // 扫描面哨兵：族里至少五键
        const missing: string[] = [];
        for (const [k, files] of seen) {
            if (!DICT.has(k)) missing.push(`${k}（引用于 ${[...new Set(files)].join(", ")}）`);
            else if (!(k in ZH) || !(k in EN)) missing.push(`${k}（两字典不对称：zh=${k in ZH} en=${k in EN}）`);
        }
        expect(missing).toEqual([]);
    });

    it("kind 只在 track.ts 一处写死（落点不许自己造类别词）", async () => {
        const src = await read("/src/ai/jev/track.ts");
        expect(src).toContain('store.begin(id, "jev",');
        // 落点侧不出现 `kind` 赋值之类自造类别（注释里复述口径是允许的，
        // 故只扫**代码行**：剥掉注释行与块注释体）
        const codeOf = (s: string): string =>
            s
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .split("\n")
                .filter((l) => !/^\s*\/\//.test(l))
                .join("\n");
        for (const p of [
            "/src/convert/service/run/ConvertQc.ts",
            "/src/quiz/service/GapJudge.ts",
            "/src/word/service/WordAiJev.ts",
            "/src/bank/data/KnowSynJev.ts",
        ]) {
            expect(codeOf(await read(p)), p).not.toMatch(/kind:\s*"jev"/);
        }
    });
});
