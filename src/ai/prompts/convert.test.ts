import { describe, expect, it } from "vitest";

/**
 * 转换域 prompt 的**死代码守卫**（Issue #143 P3-8）。
 *
 * `detectWindowPrompt` 是 20260910 前的独立前置检测 prompt，随检测整体
 * 退役后无人引用却留在 `convert.ts` 里（审计基线 7ca84d6 抓出）——它既
 * 不产出任何行为，又随每次 prompt 口径收口漂移（改规则时没人会改它）。
 * 本用例把「零引用」锁进测试：函数本体一旦复活即红。
 *
 * 走源码文本扫描（非 import）：死代码的特征就是**没有人 import 它**，
 * 用 import 反查不到；扫全 `src/` 的标识符出现次数才是对的口径。
 * 读源码用 vite 的 `?raw`（同 AiPanelGapRestore.test / SessionDetailCopy.test
 * 口径——`src/` 没有 @types/node，不能用 node:fs）。
 */

const SOURCES = import.meta.glob("../../**/*.{ts,svelte}", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

/** 只留产品源码（撤测试文件自身：断言串里写着被查的标识符）。 */
const PROD = Object.entries(SOURCES).filter(([k]) => !/\.test\.ts$/.test(k));

/** 剥注释后统计标识符在**全部产品源码**里的出现次数与命中文件。 */
function scan(id: string): { files: string[]; uses: number } {
    const files: string[] = [];
    let uses = 0;
    for (const [path, raw] of PROD) {
        const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
        const n = code.split(id).length - 1;
        if (n > 0) {
            files.push(path);
            uses += n;
        }
    }
    return { files, uses };
}

describe("转换域 prompt 死代码守卫（P3-8）", () => {
    it("扫描面覆盖到位：产品源码在册且 buildPrompt 能被扫到", () => {
        expect(PROD.length).toBeGreaterThan(100);
        const live = scan("buildPrompt");
        expect(live.files.length).toBeGreaterThan(0);
        expect(live.uses).toBeGreaterThan(0);
    });

    it("detectWindowPrompt 零命中（定义与引用都不许有）", () => {
        const { files, uses } = scan("detectWindowPrompt");
        expect(files, `残留于：${files.join(", ")}`).toEqual([]);
        expect(uses).toBe(0);
    });

    it("同批退役的 parseCount 同样零命中", () => {
        expect(scan("parseCount").files).toEqual([]);
    });
});
