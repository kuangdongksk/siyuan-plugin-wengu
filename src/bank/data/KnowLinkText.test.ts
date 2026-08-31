import { describe, expect, it } from "vitest";
import { buildSectionLexicon, linkBankByText, parseFreeTags, setKnowledgeAttr, textRefsFor } from "./KnowLinkText";
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
        knowHidden: [],
        docStats: {},
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

describe("setKnowledgeAttr（容器 IAL 写标签）", () => {
    // eslint-disable-next-line quotes -- kramdown 多行模板必须反引号
    const bare = `{{{row\n题干\n{: custom-plugin-wengu-part="stem"}\n\n> 解析\n{: custom-plugin-wengu-part="solution"}\n}}}\n{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}`;

    it("无属性：容器属性行末尾追加", () => {
        const out = setKnowledgeAttr(bare, "洛必达法则");
        expect(out).toContain('custom-plugin-wengu-knowledge="洛必达法则"}');
        expect(out).toContain(
            'custom-plugin-wengu-q="1" custom-plugin-wengu-type="single" custom-plugin-wengu-knowledge'
        );
    });

    it("已有属性：原位替换值", () => {
        const tagged = setKnowledgeAttr(bare, "旧标签");
        const out = setKnowledgeAttr(tagged, "新标签");
        expect(out).toContain('custom-plugin-wengu-knowledge="新标签"');
        expect(out).not.toContain("旧标签");
    });

    it("空值原样返回（不写空属性）", () => {
        expect(setKnowledgeAttr(bare, "  ")).toBe(bare);
    });
});

describe("parseFreeTags（AI 自由标签输出解析）", () => {
    it("编号|标签 行 → 映射；『-』跳过", () => {
        const out = parseFreeTags("1|洛必达法则\n2|-\n3|等价无穷小\n废话行");
        expect(out.get(1)).toBe("洛必达法则");
        expect(out.has(2)).toBe(false);
        expect(out.get(3)).toBe("等价无穷小");
        expect(out.size).toBe(2);
    });

    it("超长标签截 24 字", () => {
        const long = "概".repeat(30);
        expect(parseFreeTags("1|" + long).get(1)?.length).toBe(24);
    });

    it("容错分隔符（全角｜冒号）与前后空白", () => {
        const out = parseFreeTags(" 1 ｜ 极限 \n2：导数");
        expect(out.get(1)).toBe("极限");
        expect(out.get(2)).toBe("导数");
    });

    it("空输出 → 空映射", () => {
        expect(parseFreeTags("没有合适标签")).toEqual(new Map());
    });
});
