import { describe, expect, it } from "vitest";
import { normalizeKnowledge } from "./KnowledgeNorm";
import { canonicalOf, KnowSynonymsStore, loadSynonyms, peekSynonyms, synKey, synonymNormalize } from "./KnowSynonyms";

/** 内核 IO 替身：load 回放 saved，save 捕获快照。 */
function makeIo(): { load: () => Promise<unknown>; save: (v: unknown) => Promise<unknown> } {
    const io = { saved: undefined as unknown };
    return {
        load: () => Promise.resolve(io.saved),
        save: (v) => {
            io.saved = v;
            return Promise.resolve();
        },
    };
}

describe("synKey（同义表查表键）", () => {
    it("剥装饰 + 小写化（拉丁词大小写不改变等价）", () => {
        expect(synKey("L'Hôpital 法则")).toBe(synKey("l'hôpital法则"));
        expect(synKey("《洛必达法则》")).toBe("洛必达法则");
        expect(synKey("  洛必达 ")).toBe("洛必达");
    });

    it("只剥装饰不动词干（后缀由 KnowledgeNorm 那一层剥）", () => {
        expect(synKey("洛必达法则")).toBe("洛必达法则");
        expect(synKey("洛必达")).toBe("洛必达");
        expect(synKey("洛必达法则")).not.toBe(synKey("洛必达"));
    });

    it("空/纯装饰 → 空串", () => {
        expect(synKey("")).toBe("");
        expect(synKey("   ")).toBe("");
        expect(synKey("的")).toBe("");
    });
});

describe("canonicalOf / synonymNormalize（归一链前置层）", () => {
    const data = { version: 1 as const, entries: {} as Record<string, never> };
    const withEntry = (raw: string, canonical: string) => ({
        version: 1 as const,
        entries: {
            [synKey(raw)]: { key: synKey(raw), raw, canonical, source: "ai" as const, at: 1 },
        },
    });

    it("表未命中：原词直走归一链（= 改造前口径）", () => {
        expect(canonicalOf(data, "洛必达")).toBeUndefined();
        expect(synonymNormalize("洛必达", data, normalizeKnowledge)).toBe(normalizeKnowledge("洛必达"));
    });

    it("表命中：规范词先替换，再走旋后缀链（跨写法对齐）", () => {
        const d = withEntry("L'Hôpital 法则", "洛必达法则");
        expect(canonicalOf(d, "l'hôpital法则")).toBe("洛必达法则");
        expect(synonymNormalize("L'Hôpital 法则", d, normalizeKnowledge)).toBe("洛必达");
        expect(synonymNormalize("洛必达", d, normalizeKnowledge)).toBe("洛必达");
    });

    it("判否（canonical 空串）：原词归一，不额外拦截", () => {
        const d = withEntry("极限的计算", "");
        expect(canonicalOf(d, "极限的计算")).toBe("");
        expect(synonymNormalize("极限的计算", d, normalizeKnowledge)).toBe(normalizeKnowledge("极限的计算"));
    });

    it("peekSynonyms 未接线（测试环境）→ 空表，零副作用", () => {
        expect(peekSynonyms().entries).toEqual({});
        expect(peekSynonyms().version).toBe(1);
    });
});

describe("KnowSynonymsStore 存取", () => {
    it("put → 查表命中；落盘重载后仍生效（验收标准：重载插件后仍生效）", async () => {
        const io = makeIo();
        const s = new KnowSynonymsStore(io.load, io.save);
        await s.put("L'Hôpital 法则", "洛必达法则", "ai");
        await s.flush();
        expect(await s.size()).toBe(1);
        // 重载：新实例回放 saved
        const s2 = new KnowSynonymsStore(io.load, io.save);
        expect(await s2.size()).toBe(1);
        expect(canonicalOf(s2.peek(), "L'Hôpital 法则")).toBe("洛必达法则");
    });

    it("putMany 一次落表多对；同词对覆盖语义（以最后一次为准）", async () => {
        const s = new KnowSynonymsStore(
            () => Promise.resolve(""),
            () => Promise.resolve()
        );
        await s.putMany([
            { raw: "A", canonical: "B" },
            { raw: "C", canonical: "" },
        ]);
        await s.put("A", "B2");
        const list = await s.list();
        expect(list).toHaveLength(2);
        expect(canonicalOf(s.peek(), "A")).toBe("B2");
        expect(list.filter((e) => e.source === "manual")).toHaveLength(0);
    });

    it("put 同义（raw 键大小写/装饰不同）落同一键", async () => {
        const s = new KnowSynonymsStore(
            () => Promise.resolve(""),
            () => Promise.resolve()
        );
        await s.put(" 洛必达 ", "洛必达法则");
        expect(await s.size()).toBe(1);
        expect(canonicalOf(s.peek(), "《洛必达》")).toBe("洛必达法则");
    });

    it("空键/纯装饰不入表", async () => {
        const s = new KnowSynonymsStore(
            () => Promise.resolve(""),
            () => Promise.resolve()
        );
        await s.put("   ", "X");
        expect(await s.size()).toBe(0);
    });

    it("clear 清空并落盘", async () => {
        const io = makeIo();
        const s = new KnowSynonymsStore(io.load, io.save);
        await s.put("A", "B");
        await s.flush();
        await s.clear();
        expect(await s.size()).toBe(0);
        const s2 = new KnowSynonymsStore(io.load, io.save);
        expect(await s2.size()).toBe(0);
    });

    it("读异常归空表（纯派生可丢，不上抛）", async () => {
        const s = new KnowSynonymsStore(
            () => Promise.reject(new Error("io")),
            () => Promise.resolve()
        );
        await expect(s.size()).resolves.toBe(0);
        await s.put("A", "B");
        await expect(s.size()).resolves.toBe(1);
    });

    it("snapshot 等装载完成：重载后盘上有表、未 await 时 peek 空而 snapshot 有（装载时序回归）", async () => {
        const io = makeIo();
        const s1 = new KnowSynonymsStore(io.load, io.save);
        await s1.put("洛必达", "洛必达法则");
        await s1.flush();
        // 重载：新实例，盘上有表但一次都没 await
        const s2 = new KnowSynonymsStore(io.load, io.save);
        expect(s2.peek().entries).toEqual({}); // peek 是内存视角（未装载=空）
        expect(canonicalOf(await s2.snapshot(), "洛必达")).toBe("洛必达法则"); // 消费点走它
        expect(await s2.size()).toBe(1);
    });

    it("loadSynonyms 未接线 → 空表（零副作用）", async () => {
        await expect(loadSynonyms()).resolves.toEqual({ version: 1, entries: {} });
    });

    it("list 按写入时间倒序（UI 展示口径）", async () => {
        const s = new KnowSynonymsStore(
            () => Promise.resolve(""),
            () => Promise.resolve()
        );
        await s.put("old", "x");
        await new Promise((r) => setTimeout(r, 2));
        await s.put("new", "y");
        expect((await s.list())[0].raw).toBe("new");
    });
});
