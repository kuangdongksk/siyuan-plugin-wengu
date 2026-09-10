import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionBank, type BankData, type BankRecord } from "../data/QuestionBank";
import { buildSectionLexicon } from "../data/KnowLinkText";
import { initKnowSynonyms } from "../data/KnowSynonyms";
import { runSynonymPhase } from "./SynFlow";

Reflect.set(globalThis, "window", { setTimeout, clearTimeout });

/** AI 调用替身（判定唯一出口）：计数 + 可编程回复。 */
const ai = vi.hoisted(() => ({ calls: 0, reply: "" }));
vi.mock("../../ai/client", () => ({
    agentChatOnce: async (): Promise<string> => {
        ai.calls++;
        return ai.reply;
    },
}));

function rec(qid: string, knowledge?: string): BankRecord {
    return {
        qid,
        kramdown: `{{{row\n题干\n{: custom-plugin-wengu-part="stem"}\n}}}\n{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"${
            knowledge ? ` custom-plugin-wengu-knowledge="${knowledge}"` : ""
        }}`,
        type: "single",
        ...(knowledge ? { knowledge } : {}),
        kpRefs: [],
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
        knowHidden: [],
        docStats: {},
    };
    return new QuestionBank(
        async () => data,
        async () => undefined
    );
}

const ioOf = (): { load: () => Promise<unknown>; save: (v: unknown) => Promise<unknown> } => {
    const io = { saved: undefined as unknown };
    return {
        load: () => Promise.resolve(io.saved),
        save: (v) => {
            io.saved = v;
            return Promise.resolve();
        },
    };
};

const deps = (bank: QuestionBank, records: BankRecord[], lex: ReturnType<typeof buildSectionLexicon>) => ({
    bank,
    lex,
    records,
    modelId: "m1",
    stop: { signal: new AbortController().signal },
});

describe("runSynonymPhase（Issue #3：零 AI 文本层 + AI 判定 + 落表）", () => {
    beforeEach(() => {
        ai.calls = 0;
        ai.reply = "1|1";
        initKnowSynonyms(ioOf());
    });

    it("相内先跑文本层：AI 判定的命中当轮即挂引用", async () => {
        const bank = bankWith([rec("q1", "洛必达")]);
        const lex = buildSectionLexicon([{ id: "s1", title: "L'Hôpital 法则" }]);
        const out = await runSynonymPhase(deps(bank, [rec("q1", "洛必达")], lex));
        expect(ai.calls).toBe(1); // 只有同义层调用 AI
        expect(out.synHit).toBe(1);
        expect(out.rest).toHaveLength(0);
        expect((await bank.all()).records.q1.kpRefs).toEqual([{ id: "s1", title: "L'Hôpital 法则" }]);
    });

    it("文本层自己就能命中的题零 AI 挂上（不进同义队列）", async () => {
        const bank = bankWith([rec("q1", "洛必达")]);
        const lex = buildSectionLexicon([{ id: "s1", title: "洛必达法则" }]);
        const out = await runSynonymPhase(deps(bank, [rec("q1", "洛必达")], lex));
        expect(out.textHit).toBe(1);
        expect(out.synHit).toBe(0);
        expect(ai.calls).toBe(0);
    });

    it("第二轮同对词零 AI（表已沉淀判定）", async () => {
        const lex = buildSectionLexicon([{ id: "s1", title: "L'Hôpital 法则" }]);
        const io = ioOf();
        initKnowSynonyms(io);
        await runSynonymPhase(deps(bankWith([rec("q1", "洛必达")]), [rec("q1", "洛必达")], lex));
        expect(ai.calls).toBe(1);
        // 模拟重载：新 store 实例（盘上有表，未 await 过）
        initKnowSynonyms(io);
        const bank2 = bankWith([rec("q2", "洛必达")]);
        const out2 = await runSynonymPhase(deps(bank2, [rec("q2", "洛必达")], lex));
        expect(ai.calls).toBe(1); // 零新增
        expect(out2.rest).toHaveLength(0); // 靠查表命中挂上
        expect((await bank2.all()).records.q2.kpRefs).toEqual([{ id: "s1", title: "L'Hôpital 法则" }]);
    });

    it("歧义不挂（同义表命中也不越过宁漏勿错）", async () => {
        const lex = buildSectionLexicon([
            { id: "s1", title: "洛必达法则" },
            { id: "s2", title: "洛必达" },
        ]);
        const bank = bankWith([rec("q1", "洛必达")]);
        const out = await runSynonymPhase(deps(bank, [rec("q1", "洛必达")], lex));
        expect(out.textHit + out.synHit).toBe(0);
        expect(out.rest).toHaveLength(1);
    });

    it("**验收：跨语言对（「洛必达」↔「L'Hôpital 法则」）首轮挂上、重载后第二轮零 AI**", async () => {
        const io = ioOf();
        initKnowSynonyms(io);
        const lex = buildSectionLexicon([{ id: "s1", title: "L'Hôpital 法则" }]);
        // 首轮：文本层不命中（拉丁写法）→ 同义层问 AI（清单里逐条标题）命中
        const bank1 = bankWith([rec("q1", "洛必达")]);
        const r1 = await runSynonymPhase(deps(bank1, [rec("q1", "洛必达")], lex));
        expect(ai.calls).toBe(1);
        expect(r1.synHit).toBe(1);
        expect((await bank1.all()).records.q1.kpRefs).toHaveLength(1);
        // 第二轮（插件重载后）：盘上表生效 → 零 AI，且文本层直接挂上
        initKnowSynonyms(io);
        const bank2 = bankWith([rec("q2", "洛必达")]);
        const r2 = await runSynonymPhase(deps(bank2, [rec("q2", "洛必达")], lex));
        expect(ai.calls).toBe(1); // 零新增 AI 调用
        expect(r2.textHit).toBe(1);
        expect(r2.rest).toHaveLength(0);
    });

    it("**判否不固化错判**：AI 答「清单外写法」时不落表，下次仍会重问", async () => {
        const io = ioOf();
        const store = initKnowSynonyms(io);
        ai.reply = "1|某个不存在的写法";
        // 跨语言对才进得了 AI 队列（同语言对文本层自己就命中了）
        const lex = buildSectionLexicon([{ id: "s1", title: "L'Hôpital 法则" }]);
        const out = await runSynonymPhase({
            ...deps(bankWith([rec("q1", "洛必达")]), [rec("q1", "洛必达")], lex),
            completeLibrary: true,
        });
        expect(ai.calls).toBe(1);
        expect(out.rest).toHaveLength(1);
        expect(await store.size()).toBe(0); // 不落表
    });

    it("词表为空（无知识文档）→ 直通返回，不跑 AI", async () => {
        const bank = bankWith([rec("q1", "洛必达")]);
        const out = await runSynonymPhase(deps(bank, [rec("q1", "洛必达")], new Map()));
        expect(out).toEqual({ textHit: 0, synHit: 0, rest: out.rest });
        expect(out.rest).toHaveLength(1);
        expect(ai.calls).toBe(0);
    });
});
