import { describe, expect, it } from "vitest";
import { WordStore, defaultProgress } from "./WordStore";

describe("WordStore 版本闩（version>3 = 更新版插件写的进度，停写保护）", () => {
    it("内存按空起步且 save 全程零落盘——防旧版覆写清库", async () => {
        let saved = 0;
        const store = new WordStore(
            async () => ({ version: 4, words: { abandon: { d: 5, s: 10, due: 0 } } }),
            async () => {
                saved++;
            }
        );
        const p = await store.get();
        expect(p.version).toBe(3);
        expect(p.words).toEqual({}); // 不识别的数据不进内存
        await store.save(p);
        expect(saved).toBe(0); // 停写保护，一次都不写
    });

    it("version 3 正常装载照常落盘（非闩）", async () => {
        let saved = 0;
        const store = new WordStore(
            async () => ({ version: 3, words: {} }),
            async () => {
                saved++;
            }
        );
        const p = await store.get();
        expect(p.version).toBe(3);
        await store.save(p);
        expect(saved).toBe(1);
    });

    it("缺 version 的旧档（v2 前一次性切割语义）按空起步但可正常落盘", async () => {
        let saved = 0;
        const store = new WordStore(
            async () => ({ words: { old: { d: 1, s: 1, due: 0 } } }),
            async () => {
                saved++;
            }
        );
        const p = await store.get();
        expect(p).toEqual(defaultProgress()); // backfill 后的完整空进度
        await store.save(p);
        expect(saved).toBe(1); // 与版本闩不同：这不是「更新版写的」，不禁写
    });
});
