import { describe, expect, it, vi } from "vitest";
import type { JevAnswer, JudgeJevOpts } from "../../ai/jev/client";
import { JevNetworkError, JevProtocolError } from "../../ai/jev/client";
import { SYN_OPTIONS, SYN_VERDICTS, synVerdictEntersTable } from "../../ai/jev/policy";
import {
    answersToWrites,
    judgeSynonymsJev,
    synItems,
    synPairQuestion,
    synQuestions,
    synState,
    synBatches,
    SYN_JEV_BATCH,
    SYN_JEV_MAX_CANDIDATES,
    type SynJevItem,
} from "./KnowSynJev";
import { KnowSynonymsStore } from "./KnowSynonyms";
import type { LexSection } from "./KnowLinkText";
import type { SynPair } from "./KnowSynJudge";
import { mustHave, read } from "../../testkit/readSource";

/** 存储替身：真表（不落盘），断言直接读 entries。 */
const store = (): KnowSynonymsStore =>
    new KnowSynonymsStore(
        () => Promise.resolve(""),
        () => Promise.resolve("")
    );

const POOL: LexSection[] = [
    { id: "s1", title: "洛必达法则" },
    { id: "s2", title: "导数定义" },
];

/** choice 答案替身（choice = **选项原文**：三档判定字面量）。 */
const pick = (choice: string, confidence = 0.9): JevAnswer => ({
    kind: "choice",
    choice,
    probabilities: {},
    confidence,
});

/** 判定替身：记录每次调用、按脚本回答案（脚本用完重复最后一条）。 */
function mockJudge(script: JevAnswer[][]) {
    const calls: JudgeJevOpts[] = [];
    let i = 0;
    const fn = async (opts: JudgeJevOpts): Promise<JevAnswer[]> => {
        calls.push(opts);
        const out = script[Math.min(i, script.length - 1)];
        i++;
        return out;
    };
    return { fn, calls };
}

const itemsOf = (labels: string[], section: LexSection): SynJevItem[] =>
    labels.map((raw) => ({ pair: { raw } as SynPair, section }));

describe("问题组装（逐对问：标签 × 候选小节）", () => {
    it("每个「词对 × 候选」一个问题，选项取自 policy 三档常量", () => {
        const qs = synQuestions(itemsOf(["洛必达"], { id: "s1", title: "L'Hôpital 法则" }));
        expect(qs).toHaveLength(1);
        const q = qs[0];
        expect(q.kind).toBe("choice");
        if (q.kind !== "choice") return;
        expect(q.options).toEqual(SYN_OPTIONS);
        expect(q.question).toContain("洛必达");
        expect(q.question).toContain("L'Hôpital 法则"); // 候选进问题正文（逐对材料）
    });

    it("问题正文三档齐备 + 明令「拿不准选 related」（不诱导放宽）", () => {
        const q = synPairQuestion("洛必达", "导数定义");
        for (const v of SYN_OPTIONS) expect(q).toContain(v);
        expect(q).toContain(SYN_VERDICTS.same);
        expect(q).toContain(SYN_VERDICTS.related);
        expect(q).toContain(SYN_VERDICTS.different);
    });

    it("state 只放共用材料（本批标签），逐对材料在问题正文里", () => {
        const s = synState(["洛必达", "洛必达", "导数"]);
        expect(s).toContain("洛必达");
        expect(s).toContain("导数");
        expect(s).not.toContain("L'Hôpital");
    });
});

describe("synItems（候选裁剪：近邻优先 + 上限）", () => {
    it("词对 × 候选展开，近邻标题优先排前", () => {
        const pool: LexSection[] = [
            { id: "a", title: "导数定义" },
            { id: "b", title: "洛必达法则" },
        ];
        const items = synItems([{ raw: "洛必达" } as SynPair], pool);
        expect(items.map((it) => it.section.title)).toEqual(["洛必达法则", "导数定义"]);
        expect(items.every((it) => it.pair.raw === "洛必达")).toBe(true);
    });

    it("**跨语言对**：正确项在裁剪后的候选里（旧版 4 条候选的坑不复现）", () => {
        const pool: LexSection[] = [
            ...Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, title: `小节${i}` })),
            { id: "sh", title: "L'Hôpital 法则" },
        ];
        const items = synItems([{ raw: "洛必达" } as SynPair], pool);
        expect(items.map((it) => it.section.title)).toContain("L'Hôpital 法则");
    });

    it("超上限截断（逐对问的成本 = 候选数，必须有闸）", () => {
        const pool = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, title: `小节${i}` }));
        const items = synItems([{ raw: "洛必达" } as SynPair], pool);
        expect(items).toHaveLength(SYN_JEV_MAX_CANDIDATES);
    });
});

describe("synBatches（歧义口径的前提：一个标签的候选不跨批）", () => {
    it("**常量不变量**：单组上限 ≤ 批上限（否则组必然被劈开）", () => {
        expect(SYN_JEV_MAX_CANDIDATES).toBeLessThanOrEqual(SYN_JEV_BATCH);
    });

    it("一个标签的全部候选落在同一批（池子大到必须分多批时）", () => {
        const pool: LexSection[] = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, title: `节${i}` }));
        const pairs: SynPair[] = [0, 1, 2].map((g) => ({ raw: `标签${g}` }));
        const batches = synBatches(pairs, pool);
        expect(batches.length).toBeGreaterThan(1); // 确实分了两批
        for (const b of batches) {
            const labels = new Set(b.map((it) => it.pair.raw));
            // 批内每个标签的候选数 = 该标签的全部候选（没有半截组）
            for (const l of labels) expect(b.filter((it) => it.pair.raw === l)).toHaveLength(25);
        }
        // 每个标签只出现在一个批里
        const seen = new Set<string>();
        for (const b of batches)
            for (const it of new Set(b.map((x) => x.pair.raw))) {
                expect(seen.has(it)).toBe(false);
                seen.add(it);
            }
        expect(seen.size).toBe(pairs.length);
    });

    it("单组大于批上限时独占一批（宁可超限，不拆歧义判据）", () => {
        const pool: LexSection[] = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, title: `节${i}` }));
        const batches = synBatches([{ raw: "标签A" } as SynPair], pool, 10);
        expect(batches).toHaveLength(1);
        expect(batches[0]).toHaveLength(25);
    });

    it("空组（池子空）不产生空批", () => {
        expect(synBatches([{ raw: "标签A" } as SynPair], [])).toEqual([]);
    });
});

describe("answersToWrites（口径：只有 same 且唯一才落表）", () => {
    it("same + 高置信 → 落表，canonical 取**该问的候选项原文**（不许造词）", () => {
        const items = itemsOf(["洛必达"], { id: "s1", title: "洛必达法则" });
        expect(answersToWrites(items, [pick(SYN_VERDICTS.same)])).toEqual([{ raw: "洛必达", canonical: "洛必达法则" }]);
    });

    it("**related 不落表**（维持旧生成式通道的入表口径，不静默放宽）", () => {
        const items = itemsOf(["洛必达"], { id: "s1", title: "洛必达法则" });
        expect(answersToWrites(items, [pick(SYN_VERDICTS.related)])).toEqual([]);
        expect(synVerdictEntersTable(SYN_VERDICTS.related)).toBe(false);
    });

    it("different 不落表", () => {
        const items = itemsOf(["洛必达"], { id: "s1", title: "洛必达法则" });
        expect(answersToWrites(items, [pick(SYN_VERDICTS.different)])).toEqual([]);
        expect(synVerdictEntersTable(SYN_VERDICTS.different)).toBe(false);
    });

    it("低置信（<0.5）→ 不落表（回落现状 = 下次重问）", () => {
        const items = itemsOf(["洛必达"], { id: "s1", title: "洛必达法则" });
        expect(answersToWrites(items, [pick(SYN_VERDICTS.same, 0.4)])).toEqual([]);
        expect(answersToWrites(items, [pick(SYN_VERDICTS.same, 0.5)])).toHaveLength(1);
    });

    it("置信度缺失按低置信处置（不落表）", () => {
        const items = itemsOf(["洛必达"], { id: "s1", title: "洛必达法则" });
        const noConf: JevAnswer = {
            kind: "choice",
            choice: SYN_VERDICTS.same,
            probabilities: {},
            confidence: Number.NaN,
        };
        expect(answersToWrites(items, [noConf])).toEqual([]);
    });

    it("**同一标签两个候选都判 same = 歧义 → 整对不落表**（落错词比不落更糟）", () => {
        const items: SynJevItem[] = [
            { pair: { raw: "洛必达" } as SynPair, section: { id: "s1", title: "洛必达法则" } },
            { pair: { raw: "洛必达" } as SynPair, section: { id: "s2", title: "洛必达定理" } },
        ];
        expect(answersToWrites(items, [pick(SYN_VERDICTS.same), pick(SYN_VERDICTS.same)])).toEqual([]);
    });

    it("同标签一 same 一 different → 按唯一命中落表", () => {
        const items: SynJevItem[] = [
            { pair: { raw: "洛必达" } as SynPair, section: { id: "s1", title: "洛必达法则" } },
            { pair: { raw: "洛必达" } as SynPair, section: { id: "s2", title: "导数定义" } },
        ];
        expect(answersToWrites(items, [pick(SYN_VERDICTS.same), pick(SYN_VERDICTS.different)])).toEqual([
            { raw: "洛必达", canonical: "洛必达法则" },
        ]);
    });

    it("缺答案（undefined）/ 类型不对 → 不落表", () => {
        const items = itemsOf(["洛必达"], { id: "s1", title: "洛必达法则" });
        expect(answersToWrites(items, [undefined])).toEqual([]);
        expect(answersToWrites(items, [{ kind: "noul", noul: 0.9 }])).toEqual([]);
    });

    it("多标签各自唯一命中（互不干扰）", () => {
        const items: SynJevItem[] = [
            { pair: { raw: "洛必达" } as SynPair, section: { id: "s1", title: "洛必达法则" } },
            { pair: { raw: "导数" } as SynPair, section: { id: "s2", title: "导数定义" } },
        ];
        expect(answersToWrites(items, [pick(SYN_VERDICTS.same), pick(SYN_VERDICTS.same)])).toEqual([
            { raw: "洛必达", canonical: "洛必达法则" },
            { raw: "导数", canonical: "导数定义" },
        ]);
    });
});

describe("judgeSynonymsJev（批量 choice 解析 + 落表）", () => {
    it("same 落表 + 返回命中小节；一次请求问完整个词对×候选（纪律 5）", async () => {
        const st = store();
        // 近邻优先 → [洛必达法则, 导数定义]：第一问 same，第二问 different
        const { fn, calls } = mockJudge([[pick(SYN_VERDICTS.same), pick(SYN_VERDICTS.different)]]);
        const hits = await judgeSynonymsJev({
            pairs: [{ raw: "洛必达" } as SynPair],
            pool: POOL, // 近邻优先 → [洛必达法则, 导数定义]
            store: st,
            apiKey: "sk-test",
            signal: new AbortController().signal,
            judge: fn,
        });
        expect(calls).toHaveLength(1); // 一批一请求
        expect(calls[0].questions).toHaveLength(2);
        expect(calls[0].apiKey).toBe("sk-test");
        expect(hits.get("洛必达")).toEqual([{ id: "s1", title: "洛必达法则" }]);
        expect(st.peek().entries["洛必达"].canonical).toBe("洛必达法则");
        expect(st.peek().entries["洛必达"].source).toBe("ai");
    });

    it("related 按口径处理：既不落表也不当轮挂引用（下次重问）", async () => {
        const st = store();
        const { fn } = mockJudge([[pick(SYN_VERDICTS.related), pick(SYN_VERDICTS.related)]]);
        const hits = await judgeSynonymsJev({
            pairs: [{ raw: "洛必达" } as SynPair],
            pool: POOL,
            store: st,
            apiKey: "sk",
            signal: new AbortController().signal,
            judge: fn,
        });
        expect(hits.size).toBe(0);
        expect(st.peek().entries["洛必达"]).toBeUndefined();
        expect(await st.size()).toBe(0);
    });

    it("低置信不落表（回落现状：该对词下次仍会进队列）", async () => {
        const st = store();
        const { fn } = mockJudge([[pick(SYN_VERDICTS.same, 0.2), pick(SYN_VERDICTS.different)]]);
        const hits = await judgeSynonymsJev({
            pairs: [{ raw: "洛必达" } as SynPair],
            pool: POOL,
            store: st,
            apiKey: "sk",
            signal: new AbortController().signal,
            judge: fn,
        });
        expect(hits.size).toBe(0);
        expect(await st.size()).toBe(0);
    });

    it("**判定抛错走既有错误路径**：onFail 上报、不落表、不中断后续批", async () => {
        const st = store();
        let call = 0;
        const fails: Error[] = [];
        const fn = async (): Promise<JevAnswer[]> => {
            call++;
            if (call === 1) throw new JevNetworkError("内核转发失败");
            return [pick(SYN_VERDICTS.same)];
        };
        // 每对 1 个候选（pool 只留一条），故批 1 = 前 SYN_JEV_BATCH 对
        const pairs = [
            ...Array.from({ length: SYN_JEV_BATCH }, (_, i) => ({ raw: `批一词${i}` }) as SynPair),
            { raw: "洛必达" } as SynPair,
        ];
        const hits = await judgeSynonymsJev({
            pairs,
            pool: [{ id: "s1", title: "洛必达法则" }],
            store: st,
            apiKey: "sk",
            signal: new AbortController().signal,
            onFail: (e) => fails.push(e),
            judge: fn,
        });
        expect(call).toBe(2); // 失败批跳过，后一批照跑
        expect(fails).toHaveLength(1);
        expect(fails[0]).toBeInstanceOf(JevNetworkError);
        expect(hits.has("洛必达")).toBe(true); // 第二批照常落表
    });

    it("协议错同样只上报不落表（判定与写回失败不新增弹窗，需求 4）", async () => {
        const st = store();
        const fails: Error[] = [];
        const fn = async (): Promise<JevAnswer[]> => {
            throw new JevProtocolError("答案条数不匹配");
        };
        await judgeSynonymsJev({
            pairs: [{ raw: "洛必达" } as SynPair],
            pool: POOL,
            store: st,
            apiKey: "sk",
            signal: new AbortController().signal,
            onFail: (e) => fails.push(e),
            judge: fn,
        });
        expect(fails[0]).toBeInstanceOf(JevProtocolError);
        expect(await st.size()).toBe(0);
    });

    it("中止（signal）：批间停手，不发请求", async () => {
        const st = store();
        const ctrl = new AbortController();
        const { fn, calls } = mockJudge([[pick(SYN_VERDICTS.same)]]);
        ctrl.abort();
        const hits = await judgeSynonymsJev({
            pairs: [{ raw: "洛必达" } as SynPair],
            pool: POOL,
            store: st,
            apiKey: "sk",
            signal: ctrl.signal,
            judge: fn,
        });
        expect(calls).toHaveLength(0);
        expect(hits.size).toBe(0);
    });

    it("空词对/空词表：不发请求（纯函数短路）", async () => {
        const { fn, calls } = mockJudge([[]]);
        await judgeSynonymsJev({
            pairs: [],
            pool: POOL,
            store: store(),
            apiKey: "sk",
            signal: new AbortController().signal,
            judge: fn,
        });
        await judgeSynonymsJev({
            pairs: [{ raw: "洛必达" } as SynPair],
            pool: [],
            store: store(),
            apiKey: "sk",
            signal: new AbortController().signal,
            judge: fn,
        });
        expect(calls).toHaveLength(0);
    });

    it("答案条数少一条时按位取（缺者 undefined → 不落表，不整批作废）", async () => {
        const st = store();
        // pool 只有一条候选 → 每个标签只问一问；第二问缺答案
        const { fn } = mockJudge([[pick(SYN_VERDICTS.same)]]);
        await judgeSynonymsJev({
            pairs: [{ raw: "洛必达" } as SynPair, { raw: "导数" } as SynPair],
            pool: [{ id: "s1", title: "洛必达法则" }],
            store: st,
            apiKey: "sk",
            signal: new AbortController().signal,
            judge: fn,
        });
        expect(st.peek().entries["洛必达"].canonical).toBe("洛必达法则");
        expect(st.peek().entries["导数"]).toBeUndefined(); // 缺答案不落表，也不整批作废
    });

    it("**跨批歧义不落表**：同一标签两个 same 候选分落两批时，批界不许切开歧义判据", async () => {
        const st = store();
        // 池子 25 条 → 每对 25 问；3 对 = 75 问 > 60，必然分两批
        const pool: LexSection[] = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, title: `节${i}` }));
        const pairs: SynPair[] = [0, 1, 2].map((g) => ({ raw: `标签${g}` }));
        // 只让「标签2」命中两个候选（节0 / 节10）——若被批界切开，会各落一个（错）
        const judge = async (opts: JudgeJevOpts): Promise<JevAnswer[]> =>
            opts.questions.map((q) => {
                const label = /知识点标签：「([^」]+)」/.exec(q.question)?.[1];
                const cand = /候选小节写法：「([^」]+)」/.exec(q.question)?.[1];
                const hit = label === "标签2" && cand !== undefined && ["节0", "节10"].includes(cand);
                return pick(hit ? SYN_VERDICTS.same : SYN_VERDICTS.different);
            });
        const hits = await judgeSynonymsJev({
            pairs,
            pool,
            store: st,
            apiKey: "sk",
            signal: new AbortController().signal,
            judge,
        });
        expect(st.peek().entries["标签2"]).toBeUndefined(); // 歧义 → 整对不落表
        expect(hits.has("标签2")).toBe(false);
    });

    it('写回侧照旧 putMany(writes, "ai")：走 store 的批量入口', async () => {
        const st = store();
        const spy = vi.spyOn(st, "putMany");
        const { fn } = mockJudge([[pick(SYN_VERDICTS.same), pick(SYN_VERDICTS.different)]]);
        await judgeSynonymsJev({
            pairs: [{ raw: "洛必达" } as SynPair],
            pool: POOL,
            store: st,
            apiKey: "sk",
            signal: new AbortController().signal,
            judge: fn,
        });
        expect(spy).toHaveBeenCalledWith([{ raw: "洛必达", canonical: "洛必达法则" }], "ai");
        spy.mockRestore();
    });
});

describe("源级闸（Issue #188：分流单一落点、冻结清单不碰）", () => {
    it("分流只在 SynFlow 一处；判定与生成式通道互斥调用", async () => {
        mustHave("/src/bank/ui/SynFlow.ts");
        const src = await read("/src/bank/ui/SynFlow.ts");
        // 两个通道都在，且由同一个 if/else 决定（不是 AND 并列跑两条腿）
        expect(src).toMatch(/if \(isJevEnabled\(deps\.settings\)\) \{/);
        expect(src).toContain("judgeSynonymsJev(");
        expect(src).toContain("judgeSynonyms({");
        expect(src.indexOf("judgeSynonymsJev(")).toBeLessThan(src.indexOf("judgeSynonyms({"));
    });

    it("Jev 通道不 import 生成式通道（agentChatOnce / prompts），判定的供给方只剩 judgeJev", async () => {
        mustHave("/src/bank/data/KnowSynJev.ts");
        const src = await read("/src/bank/data/KnowSynJev.ts");
        expect(src).not.toContain("agentChatOnce");
        expect(src).not.toContain("prompts/");
        expect(src).not.toContain("aiTitle");
    });

    it('写回侧仍是 putMany(writes, "ai")，不新增存储键（缓存口径零变化）', async () => {
        mustHave("/src/bank/data/KnowSynJev.ts");
        const src = await read("/src/bank/data/KnowSynJev.ts");
        expect(src).not.toContain("saveData");
        // 冻结清单不碰：不出现哈希/键格式相关的符号
        for (const frozen of ["questionHash", "srcKey", "structuralChunks", "knKey", "wordKey"]) {
            expect(src).not.toContain(frozen);
        }
    });

    it("落点不自造阈值：置信度判据引用 policy helper", async () => {
        mustHave("/src/bank/data/KnowSynJev.ts");
        const src = await read("/src/bank/data/KnowSynJev.ts");
        // 不许出现裸阈值字面量（剥注释后判：注释里的「<0.5」是口径说明，不是判据）
        const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        expect(code).not.toMatch(/[<>=]=?\s*0\.[0-9]+/);
        expect(code).not.toMatch(/confidence\s*[<>=]=?/);
    });
});
