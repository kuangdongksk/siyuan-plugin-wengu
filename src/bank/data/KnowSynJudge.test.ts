import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionBank, type BankData, type BankRecord } from "./QuestionBank";
import { buildSectionLexicon, lexiconOfRoots, linkRecordsByText } from "./KnowLinkText";
import { initKnowSynonyms, KnowSynonymsStore, loadSynonyms, type KnowSynonymEntry } from "./KnowSynonyms";
import { candidateList, candidatePool, judgeSynonyms, pendingPairs } from "./KnowSynJudge";

Reflect.set(globalThis, "window", { setTimeout, clearTimeout });

/** AI 调用替身：替掉 ai/client（判定的唯一出口）。 */
const ai = vi.hoisted(() => ({ calls: 0, reply: "" }));
vi.mock("../../ai/client", () => ({
    agentChatOnce: async (): Promise<string> => {
        ai.calls++;
        return ai.reply;
    },
}));

function rec(qid: string, knowledge?: string, kpRefs: { id: string; title: string }[] = []): BankRecord {
    return {
        qid,
        kramdown: `{{{row\n题干\n{: custom-plugin-wengu-part="stem"}\n\n> 解析\n{: custom-plugin-wengu-part="solution"}\n}}}\n{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"${
            knowledge ? ` custom-plugin-wengu-knowledge="${knowledge}"` : ""
        }}`,
        type: "single",
        ...(knowledge ? { knowledge } : {}),
        kpRefs,
        sourceDocId: "doc1",
        hash: qid,
        stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
    };
}

function bankWith(records: BankRecord[]): QuestionBank {
    const data: BankData = {
        version: 1,
        records: Object.fromEntries(records.map((r) => [r.qid, r])),
        collections: [],
        migratedDocs: [],
        hashed: {},
        knowRoots: [],
        folders: [],
        docStats: {},
    };
    return new QuestionBank(
        async () => data,
        async () => undefined
    );
}

/** 内核 IO 替身（同义表落盘）。 */
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

const entriesOf = (store: KnowSynonymsStore): Map<string, KnowSynonymEntry> =>
    new Map(Object.entries(store.peek().entries));

describe("pendingPairs（待判定词对）", () => {
    it("只收带标签、长度≥2、表里未判定、且词表里没有同键小节的记录；按 synKey 去重", () => {
        const lex = buildSectionLexicon([{ id: "s1", title: "洛必达法则" }]);
        const records = [rec("q1", "L'Hôpital 法则"), rec("q2", "l'hôpital 法则"), rec("q3", ""), rec("q4", "题")];
        const pairs = pendingPairs(records, lex, new Map());
        expect(pairs).toHaveLength(1);
        expect(pairs[0].raw).toBe("L'Hôpital 法则");
    });

    it("表里判过的（含判否）不再进队列——同对词第二轮零 AI 的入口", () => {
        const lex = buildSectionLexicon([{ id: "s1", title: "洛必达法则" }]);
        const judged = new Map<string, KnowSynonymEntry>([
            ["l'hôpital法则", { key: "x", raw: "x", canonical: "", source: "ai", at: 1 }],
        ]);
        expect(pendingPairs([rec("q1", "L'Hôpital 法则")], lex, judged)).toHaveLength(0);
    });

    it("标签在词表里已有同键小节（文本层自会命中）不进 AI 队列", () => {
        const lex = buildSectionLexicon([{ id: "s1", title: "洛必达法则" }]);
        expect(pendingPairs([rec("q1", "《洛必达法则》")], lex, new Map())).toHaveLength(0);
    });
});

describe("candidatePool / candidateList（共用编号清单）", () => {
    it("pool 按标题去重（规范词白名单）", () => {
        const lex = buildSectionLexicon([
            { id: "s1", title: "洛必达法则" },
            { id: "s2", title: "洛必达法则" },
            { id: "s3", title: "导数定义" },
        ]);
        const pool = candidatePool(lex);
        expect(pool.map((s) => s.title)).toEqual(["洛必达法则", "导数定义"]);
    });

    it("清单行号与 kept 一一对应，标签近邻标题优先入清单", () => {
        const pool = [
            { id: "a", title: "导数定义" },
            { id: "b", title: "洛必达法则" },
            { id: "c", title: "泰勒公式" },
        ];
        const { kept, list2, truncated } = candidateList(pool, ["洛必达"]);
        expect(kept[0].title).toBe("洛必达法则"); // 近邻优先
        expect(list2.split("\n")[0]).toBe("1|洛必达法则");
        expect(truncated).toBe(false);
    });

    it("**跨语言对**：清单含全部（预算内）小节，正确项不会像旧版那样被 4 条候选挤掉", () => {
        const pool = [
            ...Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, title: `小节${i}` })),
            { id: "sh", title: "L'Hôpital 法则" },
        ];
        const { kept } = candidateList(pool, ["洛必达"]);
        expect(kept.map((s) => s.title)).toContain("L'Hôpital 法则");
    });

    it("超预算截断：truncated=true（截断批的「不定」判定不落表）", () => {
        const pool = Array.from({ length: 400 }, (_, i) => ({
            id: `s${i}`,
            title: `很长的知识点小节标题占位符${i}`.repeat(2),
        }));
        const { kept, truncated } = candidateList(pool, []);
        expect(truncated).toBe(true);
        expect(kept.length).toBeGreaterThan(0);
    });
});

describe("judgeSynonyms（按批判定 + 落表）", () => {
    const store = (): KnowSynonymsStore =>
        new KnowSynonymsStore(
            () => Promise.resolve(""),
            () => Promise.resolve()
        );
    const pool = [{ id: "s1", title: "洛必达法则" }];

    beforeEach(() => {
        ai.calls = 0;
        ai.reply = "1|1";
    });

    it("同义命中（回清单编号）：写回表（canonical=清单侧标题原文）+ 返回命中小节", async () => {
        const st = store();
        const hits = await judgeSynonyms({
            pairs: [{ raw: "L'Hôpital 法则" }],
            pool,
            modelId: "m1",
            signal: new AbortController().signal,
            store: st,
            persistDeny: true,
        });
        expect(ai.calls).toBe(1);
        expect(hits.get("l'hôpital法则")).toEqual([{ id: "s1", title: "洛必达法则" }]);
        expect(st.peek().entries["l'hôpital法则"].canonical).toBe("洛必达法则");
        expect(st.peek().entries["l'hôpital法则"].source).toBe("ai");
    });

    it("容错：AI 不守编号协议但逐字抄了标题，也认", async () => {
        ai.reply = "1|洛必达法则";
        const st = store();
        const hits = await judgeSynonyms({
            pairs: [{ raw: "洛必达" }],
            pool,
            modelId: "m1",
            signal: new AbortController().signal,
            store: st,
            persistDeny: true,
        });
        expect(hits.size).toBe(1);
    });

    it("明确否（-）：记空串防重问，但不当轮挂引用", async () => {
        ai.reply = "1|-";
        const st = store();
        const hits = await judgeSynonyms({
            pairs: [{ raw: "极限的计算" }],
            pool,
            modelId: "m1",
            signal: new AbortController().signal,
            store: st,
            persistDeny: true,
        });
        expect(hits.size).toBe(0);
        expect(st.peek().entries["极限的计算"].canonical).toBe("");
    });

    it("**答非所问不落表**（回归：旧版把清单外写法当否固化，一次错判判死该词对）", async () => {
        ai.reply = "1|某个不存在的写法";
        const st = store();
        const hits = await judgeSynonyms({
            pairs: [{ raw: "洛必达" }],
            pool,
            modelId: "m1",
            signal: new AbortController().signal,
            store: st,
            persistDeny: true,
        });
        expect(hits.size).toBe(0);
        expect(st.peek().entries["洛必达"]).toBeUndefined(); // 不落表 → 下次重问
    });

    it("**词表非全库口径时判否也不落表**（匹配入口只含选中文档，否换个文档会翻案）", async () => {
        ai.reply = "1|-";
        const st = store();
        const hits = await judgeSynonyms({
            pairs: [{ raw: "极限的计算" }],
            pool,
            modelId: "m1",
            signal: new AbortController().signal,
            store: st,
            persistDeny: false,
        });
        expect(hits.size).toBe(0);
        expect(st.peek().entries["极限的计算"]).toBeUndefined(); // 不落表 → 下次重问
    });

    it("AI 失败：onFail 上报、不落表（重跑再试）", async () => {
        const st = store();
        const client = await import("../../ai/client");
        const spy = vi.spyOn(client, "agentChatOnce").mockImplementationOnce(async () => {
            throw new Error("网络异常");
        });
        const fails: Error[] = [];
        const out = await judgeSynonyms({
            pairs: [{ raw: "洛必达" }],
            pool,
            modelId: "m1",
            signal: new AbortController().signal,
            store: st,
            persistDeny: true,
            onFail: (e) => fails.push(e),
        });
        expect(fails).toHaveLength(1);
        expect(out.size).toBe(0);
        expect(st.peek().entries["洛必达"]).toBeUndefined(); // 失败不落表，重跑再试
        spy.mockRestore();
    });
});

describe("端到端：文本层不命中 → 同义层命中 → 第二轮零 AI（Issue #3 验收）", () => {
    it("「洛必达」对「L'Hôpital 法则」的跨语对：首轮 1 次 AI 并挂引用；重跑零 AI", async () => {
        const io = makeIo();
        const store = initKnowSynonyms(io);
        ai.calls = 0;
        ai.reply = "1|1"; // 清单第一项 = L'Hôpital 法则
        const bank = bankWith([rec("q1", "洛必达")]);
        // 词表小节标题与标签写法完全不同（拉丁写法），文本层不命中
        const lex = buildSectionLexicon([{ id: "s1", title: "L'Hôpital 法则" }]);

        // 首轮：文本层不命中 → missed；同义层问 AI 命中并挂引用
        const p1 = await linkRecordsByText(bank, lex, [rec("q1", "洛必达")], { skipLinked: false });
        expect(p1.miss).toBe(1);
        expect(ai.calls).toBe(0); // 文本层零 AI

        const pairs = pendingPairs(p1.missed, lex, entriesOf(store));
        expect(pairs).toHaveLength(1);
        const hits = await judgeSynonyms({
            pairs,
            pool: candidatePool(lex),
            modelId: "m1",
            signal: new AbortController().signal,
            store,
            persistDeny: true,
        });
        expect(ai.calls).toBe(1);
        expect(hits.get("洛必达")).toEqual([{ id: "s1", title: "L'Hôpital 法则" }]);
        await store.flush();

        // 第二轮（模拟插件重载）：新 store 实例回放盘上表，词对已判定
        const store2 = initKnowSynonyms(io);
        await store2.size();
        const again = pendingPairs(p1.missed, lex, entriesOf(store2));
        expect(again).toHaveLength(0);
        expect(ai.calls).toBe(1); // 零新增 AI 调用

        // 同义表落盘生效：文本层现在靠表查得到规范词 → 继续走归一链命中
        const p2 = await linkRecordsByText(bank, lex, [rec("q1", "洛必达")], { skipLinked: false });
        expect(p2.hit).toBe(1);
        expect(ai.calls).toBe(1);
    });

    it("歧义场景不挂引用（同义表命中也不越过宁漏勿错）", async () => {
        const io = makeIo();
        const store = initKnowSynonyms(io);
        await store.put("洛必达", "洛必达法则");
        const bank = bankWith([rec("q1", "洛必达")]);
        // 两个小节归一到同键 → 歧义，不挂
        const lex = buildSectionLexicon([
            { id: "s1", title: "洛必达法则" },
            { id: "s2", title: "洛必达法则" },
        ]);
        const out = await linkRecordsByText(bank, lex, [rec("q1", "洛必达")], { skipLinked: false });
        expect(out.hit).toBe(0);
        expect(out.miss).toBe(1);
    });

    it("现有行为不回归：表未接线/表为空时 textRefsFor 与改造前逐字一致", async () => {
        initKnowSynonyms(makeIo());
        const lex = buildSectionLexicon([{ id: "s1", title: "洛必达法则" }]);
        const bank = bankWith([rec("q1", "洛必达"), rec("q2", "文言虚词")]);
        const out = await linkRecordsByText(bank, lex, Object.values((await bank.all()).records), {
            skipLinked: false,
        });
        expect(out.hit).toBe(1);
        expect(out.miss).toBe(1);
    });

    it("**重载后首次文本关联即查得到盘上表**（回归：装载时序，旧版 peek 空表 → 重问 AI）", async () => {
        const io = makeIo();
        const s1 = initKnowSynonyms(io);
        await s1.put("洛必达", "洛必达法则");
        await s1.flush();
        // 插件重载：新实例。此前必须**先 await 一次**（旧版靠 peek，未装载即空表）
        initKnowSynonyms(io);
        ai.calls = 0;
        const bank = bankWith([rec("q1", "洛必达")]);
        // 建词表与文本关联都是异步消费点，一律等装载完成（loadSynonyms）
        expect((await lexiconOfRoots([])).size).toBe(0);
        const lex2 = buildSectionLexicon([{ id: "s1", title: "洛必达法则" }], await loadSynonyms());
        const out = await linkRecordsByText(bank, lex2, [rec("q1", "洛必达")], { skipLinked: false });
        expect(out.hit).toBe(1); // 表生效，零 AI
        expect(ai.calls).toBe(0);
    });
});
