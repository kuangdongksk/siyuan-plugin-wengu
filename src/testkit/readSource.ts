/**
 * 源级断言的读源码工具（Issue #189 处置）。
 *
 * ## 为什么需要它
 *
 * 本仓**没有 `@types/node`**，`node:fs` / `node:url` 这类 Node 内置在
 * `src/**` 里过不了 `svelte-check`（`Cannot find name 'fs'`）——vitest 跑得过、
 * CI 会红，两把尺子不同步，最容易漏（见 `.agents/memory/env-debugging.md`）。
 * 既有口径是 vitest 的 `?raw` 与 `import.meta.glob`。
 *
 * 但**「先红后实现」的阶段一红测试**有第二个坑：目标源码文件**尚不存在**，
 * 于是静态 `import` / `import.meta.glob` 两种取法会各踩一个雷
 * （#189 首轮即此，CI `check` 阶段红在 `Cannot find module './QuizTimer'`）：
 *
 * - **静态 `import`**：文件不在 → 类型图里 `Cannot find module`，CI 红在
 *   「模块缺失」而不是「断言未过」，红清单看着像编译器报错；
 * - **`?raw` + `eager: true` + basename 查表**：文件不在 → 静默落成
 *   `undefined`，`.not.toContain(...)` 类反向断言**静默变绿**，红清单缺条目。
 *
 * 且 `eager` 形态的键是**相对本文件的模块名**，跨层同名文件（
 * `src/quiz/index.ts` 与 `src/index.ts`）只能靠「取最后一段」查表，于是
 * 要么撞车取错文件、要么得为每个目录层各写一条 glob 再拼表——口径脆。
 *
 * ## 本模块的口径
 *
 * 改用 **`import.meta.glob` 的懒加载形态**（不带 `eager`），键是
 * **相对仓根的路径**（如 `/src/quiz/render/NumRail.ts`），于是：
 *
 * 1. **路径即键**：`read("/src/quiz/index.ts")` 与 `read("/src/index.ts")`
 *    各取各的文件，跨层同名不再撞车，也**不必**按目录层拼多张 glob 表；
 * 2. **取不到就抛错**（`mustHave`）：`src/` 下搜不到该路径即报「文件不在」，
 *    红测试清单**不会缺条目**，也**不会静默变绿**；
 * 3. 零新增类型豁免、零依赖变动 —— 只用仓库已在用的 `?raw` 与
 *    `import.meta.glob`（声明见 `src/declarations.d.ts`）。
 *
 * ## 实测踩到的两个细节（可复现，别走回头路）
 *
 * - **懒加载的 `?raw` 返回值是「原始字符串本身」**，不是 `{ default: string }`
 *   模块壳（`eager` 形态才是模块壳）。故取值处两种都认，别只解 `.default`。
 * - **`?raw` 的 glob 只认 `.ts` / `.svelte` 这些「非样式」扩展名**，
 *   `.scss` 一律要 `sass.compile` 真编译（`?raw` 对它恒空串）——本条与
 *   既有口径一致，此处只作提醒。
 */

/** 懒加载取值的两种形态：`eager` 是模块壳、非 `eager` 的 `?raw` 是裸字符串。 */
type Loader = () => Promise<unknown>;

/** `import.meta.glob` 的模式必须是**字面量**，故此处把 `src/` 各层列全。 */
const TABLES: Record<string, Loader>[] = [
    import.meta.glob("/src/*.{ts,svelte}", { query: "?raw", import: "default" }),
    import.meta.glob("/src/*/*.{ts,svelte}", { query: "?raw", import: "default" }),
    import.meta.glob("/src/*/*/*.{ts,svelte}", { query: "?raw", import: "default" }),
    import.meta.glob("/src/*/*/*/*.{ts,svelte}", { query: "?raw", import: "default" }),
    import.meta.glob("/src/*/*/*/*/*.{ts,svelte}", { query: "?raw", import: "default" }),
    import.meta.glob("/src/*/*/*/*/*/*.{ts,svelte}", { query: "?raw", import: "default" }),
] as unknown as Record<string, Loader>[];

let cache: Map<string, Loader> | null = null;

function index(): Map<string, Loader> {
    if (!cache) {
        cache = new Map();
        for (const t of TABLES) for (const [k, v] of Object.entries(t)) cache.set(normalize(k), v as Loader);
    }
    return cache;
}

/** 统一成「`/src/...`」的路径口径：接受 `src/…`、`/src/…`、`./src/…`。 */
function normalize(path: string): string {
    const p = path.replace(/^\.\//, "").replace(/^src\//, "/src/");
    return p.startsWith("/") ? p : `/${p}`;
}

/** 命中项（加载器）；未命中返回 `undefined`（＝该源码文件不存在）。 */
function hit(path: string): Loader | undefined {
    const want = normalize(path);
    const direct = index().get(want);
    if (direct) return direct;
    // 容忍省略扩展名/写错层级：按「以该路径结尾」兜一层，仍不唯一即不命中。
    const tail = `/${want.replace(/^\//, "")}`;
    const cands = [...index().entries()].filter(([k]) => k === tail || k.endsWith(tail));
    return cands.length === 1 ? cands[0][1] : undefined;
}

/** 源码在不在（`src/` 下的路径口径）。 */
export function hasSource(path: string): boolean {
    return hit(path) !== undefined;
}

/**
 * 源码原文（如 `/src/quiz/render/NumRail.ts`）。
 * ⚠️ **文件不在即抛错**（不是回落空串）：静默取不到会让正向断言与反向断言
 * 一起失真，红测试清单就会缺条目——这是本模块存在的首要理由。
 */
export function read(path: string): Promise<string> {
    const loader = hit(path);
    if (!loader) throw new Error(`源文件不在：${normalize(path)}（「先红后实现」的阶段一红测试，此处红是预期的）`);
    return loader().then((loaded) => {
        if (typeof loaded === "string") return loaded; // 非 eager 的 `?raw` 裸字符串
        const d = (loaded as { default?: unknown } | undefined)?.default;
        if (typeof d !== "string") throw new Error(`取源码失败（非字符串）：${normalize(path)}`);
        return d;
    });
}

/**
 * 在场闸：文件不在即抛错。**待产出文件必先过这一道**，再谈断言——
 * 「先红后实现」的红清单否则会静默缺条目（见文件头注）。
 */
export function mustHave(path: string): void {
    if (!hasSource(path)) {
        throw new Error(`源文件不在：${normalize(path)}（「先红后实现」的阶段一红测试，此处红是预期的）`);
    }
}

/**
 * 「先红后实现」的**红清单自检**：清单里的每个待产出文件都必须**仍不在**。
 *
 * 为什么需要（#189 教训）：阶段一的红测试是**暂时的**——阶段二实现落地后，
 * 这些反向断言（`.not.toContain` / `not.toMatch`）会随源码改完而逐个变绿，
 * 但**红清单本身不会自己提醒你**。少了这道自检，会出现两种情况且都难查：
 *   ① 实现漏了某一条，对应红测仍红 —— 看着「还有红」，其实是没做完；
 *   ② 实现补齐了，红测全绿 —— 你无法区分「做完了」与「断言被写松了」。
 * 故红清单必须**显式登记**在测试里：`expectRed(["…"])` 保证它现在红得名副其实，
 * 且 Phase 2 收口时删掉这一条即是一次有意识的动作。
 *
 * ⚠️ 阶段一用；**阶段二实现落地后连同其调用点一起删**。
 * 好消息是它**会自己催你收口**：实现落地后文件就在了，这里直接抛错
 * （「文件已存在」），红得明明白白，不会留成一条永远绿的空断言。
 */
export function expectRed(paths: string[]): void {
    for (const p of paths) {
        if (hasSource(p)) {
            throw new Error(
                `红清单自检失败：${normalize(p)} 已存在 —— 阶段一此文件应尚未产出。` +
                    "若阶段二已实现它，请把该条从 expectRed 清单里删掉（收口动作），" +
                    "别让它留在这儿空转。"
            );
        }
    }
}
