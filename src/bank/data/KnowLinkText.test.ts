import { describe, expect, it } from "vitest";
import { buildSectionLexicon, linkBankByText, textRefsFor } from "./KnowLinkText";
import { QuestionBank, type BankData, type BankRecord } from "./QuestionBank";

// QuestionBank.markDirty 走 window.setTimeout 防抖（浏览器全局），node
// 测试环境补一个直通桩——flush 落到 saveRaw 桩，无副作用
Reflect.set(globalThis, "window", { setTimeout, clearTimeout });

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
    };
    return new QuestionBank(
        async () => data,
        async () => undefined
    );
}

describe("buildSectionLexicon / textRefsFor（确定性文本匹配）", () => {
    it("归一对齐：标签「洛必达」命中小节「洛必达法则」", () => {
        const lex = buildSectionLexicon([{ id: "s1", title: "洛必达法则" }]);
        expect(textRefsFor("洛必达", lex)).toEqual([{ id: "s1", title: "洛必达法则" }]);
        expect(textRefsFor("洛必达法则", lex)).toEqual([{ id: "s1", title: "洛必达法则" }]);
    });

    it("歧义不挂：两个小节归一到同键（宁漏勿错）", () => {
        const lex = buildSectionLexicon([
            { id: "s1", title: "洛必达法则" },
            { id: "s2", title: "洛必达" },
        ]);
        expect(textRefsFor("洛必达", lex)).toEqual([]);
    });

    it("过短（<2 字）与空不挂", () => {
        const lex = buildSectionLexicon([
            { id: "s1", title: "题" },
            { id: "s2", title: "极限" },
        ]);
        expect(textRefsFor("题", lex)).toEqual([]);
        expect(textRefsFor("", lex)).toEqual([]);
        expect(buildSectionLexicon([{ id: "s1", title: "题" }]).size).toBe(0); // 词表侧同限
    });

    it("装饰与尾缀两侧同剥：《洛必达法则》↔ 洛必达 命中", () => {
        const lex = buildSectionLexicon([{ id: "s1", title: "《洛必达法则》" }]);
        expect(textRefsFor("洛必达", lex)).toEqual([{ id: "s1", title: "《洛必达法则》" }]);
    });
});

describe("linkBankByText（全库文本关联）", () => {
    it("命中题挂引用：kramdown 注入引用行、kpRefs 合并；源块同步失败不阻断", async () => {
        const bank = bankWith([rec("q1", "洛必达"), rec("q2", "文言虚词"), rec("q3")]);
        const lex = buildSectionLexicon([
            { id: "s1", title: "洛必达法则" },
            { id: "s2", title: "文言虚词" },
        ]);
        const out = await linkBankByText(bank, lex, {});
        expect(out.hit).toBe(2);
        expect(out.miss).toBe(1); // q3 无 knowledge
        const data = await bank.all();
        expect(data.records.q1.kpRefs).toEqual([{ id: "s1", title: "洛必达法则" }]);
        expect(data.records.q1.kramdown).toContain("相关知识点：((s1");
    });

    it("默认跳过已挂引用的题（导入即关联的增量语义）", async () => {
        const linked = rec("q1", "洛必达", [{ id: "sx", title: "别处" }]);
        const bank = bankWith([linked, rec("q2", "洛必达")]);
        const lex = buildSectionLexicon([{ id: "s1", title: "洛必达法则" }]);
        const out = await linkBankByText(bank, lex, {});
        expect(out.skip).toBe(1);
        expect(out.hit).toBe(1);
        const data = await bank.all();
        expect(data.records.q1.kpRefs).toEqual([{ id: "sx", title: "别处" }]); // 原样不动
    });

    it("abort 后停止遍历", async () => {
        const bank = bankWith([rec("q1", "洛必达"), rec("q2", "洛必达"), rec("q3", "洛必达")]);
        const lex = buildSectionLexicon([{ id: "s1", title: "洛必达法则" }]);
        const ctrl = new AbortController();
        ctrl.abort();
        const out = await linkBankByText(bank, lex, { signal: ctrl.signal });
        expect(out.hit).toBe(0);
    });
});
