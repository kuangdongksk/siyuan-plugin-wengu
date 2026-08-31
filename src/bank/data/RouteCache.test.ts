import { describe, expect, it } from "vitest";
import type { KnowledgeIndex } from "../../convert/service/KnowledgeLink";
import { ROUTE_CACHE_CAP, RouteCache, indexGenOf, initRouteCache, routeKnowledgeCached } from "./RouteCache";

/** 造 N 章索引：每章两小节（路由两级都用得到）。 */
function makeIndex(n: number): KnowledgeIndex {
    const chapters = [];
    for (let i = 1; i <= n; i++) {
        chapters.push({
            docId: `doc${i}`,
            title: `章${i}`,
            path: `章${i}`,
            sections: [
                { id: `s${i}a`, title: `节${i}甲`, path: `章${i}/节${i}甲` },
                { id: `s${i}b`, title: `节${i}乙`, path: `章${i}/节${i}乙` },
            ],
        });
    }
    return { chapters };
}

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

describe("indexGenOf（索引代数指纹）", () => {
    it("同结构稳定，结构变化（加章/改小节 path/删小节）必变", () => {
        const a = makeIndex(3);
        expect(indexGenOf(a)).toBe(indexGenOf(makeIndex(3)));

        const more = makeIndex(4);
        expect(indexGenOf(more)).not.toBe(indexGenOf(a));

        const edited = makeIndex(3);
        edited.chapters[1].sections[0].path = "章2/改名小节";
        expect(indexGenOf(edited)).not.toBe(indexGenOf(a));

        const dropped = makeIndex(3);
        dropped.chapters[2].sections.pop();
        expect(indexGenOf(dropped)).not.toBe(indexGenOf(a));
    });

    it("章 docId 变（根换血）也变——根集合由章集合覆盖", () => {
        const a = makeIndex(2);
        const b = makeIndex(2);
        b.chapters[0].docId = "docX";
        expect(indexGenOf(b)).not.toBe(indexGenOf(a));
    });
});

describe("RouteCache 存取", () => {
    it("未命中 → put → 命中（空数组也是有效答案）", async () => {
        const c = new RouteCache(
            () => Promise.resolve(""),
            () => Promise.resolve()
        );
        const gen = indexGenOf(makeIndex(2));
        await c.put("k", gen, []);
        await expect(c.get("k", gen)).resolves.toEqual([]);
        await c.put("k2", gen, [{ id: "s1a", title: "节1甲" }]);
        await expect(c.get("k2", gen)).resolves.toEqual([{ id: "s1a", title: "节1甲" }]);
    });

    it("代数不符：整表作废，旧键全部未命中", async () => {
        const c = new RouteCache(
            () => Promise.resolve(""),
            () => Promise.resolve()
        );
        const gen1 = indexGenOf(makeIndex(2));
        await c.put("k", gen1, [{ id: "s1a", title: "节1甲" }]);
        expect(await c.get("k", indexGenOf(makeIndex(3)))).toBeUndefined();
        // 回到旧代也不复活（表已清，重建从零开始）
        expect(await c.get("k", gen1)).toBeUndefined();
    });

    it("空表首见代数即采纳（put 先于 get 也落表）；非空旧代不收新结果", async () => {
        const c = new RouteCache(
            () => Promise.resolve(""),
            () => Promise.resolve()
        );
        const gen1 = indexGenOf(makeIndex(2));
        await c.put("k", gen1, []); // 空表：直接采纳 gen1
        await expect(c.get("k", gen1)).resolves.toEqual([]);
        await c.put("k2", indexGenOf(makeIndex(3)), []); // 非空旧代：丢弃
        await expect(c.get("k2", indexGenOf(makeIndex(3)))).resolves.toBeUndefined();
    });

    it("LRU 超容量淘汰最久未用", async () => {
        const c = new RouteCache(
            () => Promise.resolve(""),
            () => Promise.resolve()
        );
        const gen = indexGenOf(makeIndex(2));
        for (let i = 0; i <= ROUTE_CACHE_CAP; i++) await c.put(`k${i}`, gen, []);
        expect(await c.get("k0", gen)).toBeUndefined(); // 最老的被淘汰
        expect(await c.get(`k${ROUTE_CACHE_CAP}`, gen)).toEqual([]);
        expect(await c.get("k1", gen)).toEqual([]); // 命中即刷新时序
    });

    it("flush 只在脏时写一次；落盘数据重载可命中", async () => {
        const io = makeIo();
        const c = new RouteCache(io.load, io.save);
        const gen = indexGenOf(makeIndex(2));
        await c.put("k", gen, [{ id: "s1a", title: "节1甲" }]);
        await c.flush();
        await c.flush(); // 不脏不再写
        // 重载：新实例回放 saved
        const c2 = new RouteCache(io.load, io.save);
        await expect(c2.get("k", gen)).resolves.toEqual([{ id: "s1a", title: "节1甲" }]);
    });

    it("读异常归空表（纯缓存可丢，不上抛）", async () => {
        const c = new RouteCache(
            () => Promise.reject(new Error("io")),
            () => Promise.resolve()
        );
        const gen = indexGenOf(makeIndex(2));
        await expect(c.get("k", gen)).resolves.toBeUndefined();
        await c.put("k", gen, []);
        await expect(c.get("k", gen)).resolves.toEqual([]);
    });
});

describe("routeKnowledgeCached（三弹窗共用的带缓存路由）", () => {
    const INDEX = makeIndex(3);
    /** 两级路由替身：选 2 号章的 1 号小节，计 AI 调用数。 */
    const call =
        (state: { n: number; fail?: boolean }) =>
        async (msg: string): Promise<string> => {
            state.n++;
            if (state.fail) throw new Error("网络异常");
            return msg.includes("章节清单") ? '{"chapters":[2]}' : '{"sections":[1]}';
        };

    it("首跑两次 AI 调用并缓存；重跑零 AI 调用返回同结果", async () => {
        initRouteCache(makeIo());
        const st = { n: 0 };
        const a = await routeKnowledgeCached({ text: "题目原文", index: INDEX, modelId: "m1", call: call(st) });
        expect(st.n).toBe(2);
        expect(a).toEqual([{ id: "s2a", title: "节2甲" }]);
        const b = await routeKnowledgeCached({ text: "题目原文", index: INDEX, modelId: "m1", call: call(st) });
        expect(st.n).toBe(2); // 全缓存命中
        expect(b).toEqual(a);
    });

    it("AI 明确判零命中的空结果也缓存（不再白花两次调用）", async () => {
        initRouteCache(makeIo());
        const st = {
            n: 0,
        };
        const empty = async (): Promise<string> => {
            st.n++;
            return '{"chapters":[]}';
        };
        await routeKnowledgeCached({ text: "零命中题", index: INDEX, modelId: "m1", call: empty });
        const out = await routeKnowledgeCached({ text: "零命中题", index: INDEX, modelId: "m1", call: empty });
        expect(st.n).toBe(1); // 第二次零调用（单章才跳第一级；此处 3 章判空只花 1 次）
        expect(out).toEqual([]);
    });

    it("AI 调用失败不缓存：onFail 上报，重跑会再调且成功后可缓存", async () => {
        initRouteCache(makeIo());
        const st = { n: 0, fail: true };
        const fails: unknown[] = [];
        const out1 = await routeKnowledgeCached({
            text: "题目原文",
            index: INDEX,
            modelId: "m1",
            call: call(st),
            onFail: (f) => fails.push(f),
        });
        expect(out1).toEqual([]);
        expect(fails).toHaveLength(1);
        st.fail = false;
        const out2 = await routeKnowledgeCached({ text: "题目原文", index: INDEX, modelId: "m1", call: call(st) });
        expect(out2).toEqual([{ id: "s2a", title: "节2甲" }]);
        expect(st.n).toBe(3); // 失败 1 + 成功 2
        const out3 = await routeKnowledgeCached({ text: "题目原文", index: INDEX, modelId: "m1", call: call(st) });
        expect(out3).toEqual(out2);
        expect(st.n).toBe(3); // 此后缓存命中
    });

    it("换模型/索引结构变：各走各的缓存，互不串台", async () => {
        initRouteCache(makeIo());
        const st = { n: 0 };
        await routeKnowledgeCached({ text: "题目原文", index: INDEX, modelId: "m1", call: call(st) });
        // 换模型：同题重新路由
        await routeKnowledgeCached({ text: "题目原文", index: INDEX, modelId: "m2", call: call(st) });
        expect(st.n).toBe(4);
        // 两模型各自命中
        await routeKnowledgeCached({ text: "题目原文", index: INDEX, modelId: "m1", call: call(st) });
        await routeKnowledgeCached({ text: "题目原文", index: INDEX, modelId: "m2", call: call(st) });
        expect(st.n).toBe(4);
        // 索引结构变（加章）：代数失效整表作废，重新路由
        const index2 = makeIndex(4);
        await routeKnowledgeCached({ text: "题目原文", index: index2, modelId: "m1", call: call(st) });
        expect(st.n).toBe(6);
    });

    it("题目文本变化=不同指纹，不误用旧答案", async () => {
        initRouteCache(makeIo());
        const st = { n: 0 };
        await routeKnowledgeCached({ text: "题目甲", index: INDEX, modelId: "m1", call: call(st) });
        await routeKnowledgeCached({ text: "题目乙", index: INDEX, modelId: "m1", call: call(st) });
        expect(st.n).toBe(4);
    });
});
