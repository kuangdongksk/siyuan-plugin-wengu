import { describe, expect, it } from "vitest";
import {
    buildSectionLexicon,
    lexiconOfIndex,
    linkBankByText,
    parseFreeTags,
    setKnowledgeAttr,
    textRefsFor,
} from "./KnowLinkText";
import { QuestionBank, type BankData, type BankRecord } from "./QuestionBank";
import { synKey, type KnowSynonymsData } from "./KnowSynonyms";
import { TAG_MAX_CHARS } from "../../ai/prompts/common";

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

describe("同义表前置层（Issue #3）：原文 → 查表 → 剥后缀 → 精确相等", () => {
    /** 同义表数据替身（键走 synKey 口径）。 */
    const synWith = (raw: string, canonical: string): KnowSynonymsData => {
        const key = synKey(raw);
        return { version: 1, entries: { [key]: { key, raw, canonical, source: "ai", at: 1 } } };
    };

    it("跨写法对齐：表里「L'Hôpital 法则 → 洛必达法则」后，标签「洛必达」命中该小节", () => {
        const lex = buildSectionLexicon([{ id: "s1", title: "洛必达法则" }]);
        // 未挂表：拉丁写法对不上（改造前口径）
        expect(textRefsFor("L'Hôpital 法则", lex)).toEqual([]);
        // 挂表后命中（AI 已把两写法判定为同义）
        const syn = synWith("L'Hôpital 法则", "洛必达法则");
        expect(textRefsFor("L'Hôpital 法则", lex, syn)).toEqual([{ id: "s1", title: "洛必达法则" }]);
    });

    it("小节侧同样过表：词表建表时即对齐，同义写法的小节与标签落同键", () => {
        const syn = synWith("L'Hôpital 法则", "洛必达法则");
        const lex = buildSectionLexicon([{ id: "s1", title: "L'Hôpital 法则" }], syn);
        expect(textRefsFor("洛必达", lex, syn)).toEqual([{ id: "s1", title: "L'Hôpital 法则" }]);
        expect(textRefsFor("洛必达法则", lex, syn)).toEqual([{ id: "s1", title: "L'Hôpital 法则" }]);
    });

    it("判否（canonical 空串）不额外拦截：原词照走既有精确口径", () => {
        const lex = buildSectionLexicon([{ id: "s1", title: "极限的计算" }]);
        const syn = synWith("极限", "");
        expect(textRefsFor("极限", lex, syn)).toEqual([]); // 表判否，仍不越过宁漏勿错
        expect(textRefsFor("极限的计算", lex, syn)).toEqual([{ id: "s1", title: "极限的计算" }]);
    });

    it("歧义（多小节同键）经表对齐后仍不挂", () => {
        const syn = synWith("L'Hôpital 法则", "洛必达法则");
        const lex = buildSectionLexicon(
            [
                { id: "s1", title: "洛必达法则" },
                { id: "s2", title: "洛必达法则" },
            ],
            syn
        );
        expect(textRefsFor("L'Hôpital 法则", lex, syn)).toEqual([]);
    });

    it("过短闸按**归一后键**口径（<2 字不挂；表命中后键够长即照挂）", () => {
        const lex = buildSectionLexicon([{ id: "s1", title: "极限" }]);
        expect(textRefsFor("极", lex)).toEqual([]); // 裸 1 字不挂
        // 表命中后归一键是规范词（够长），照常挂——表只做对齐，不改闸口语义
        const syn = synWith("题", "极限");
        expect(textRefsFor("题", lex, syn)).toEqual([{ id: "s1", title: "极限" }]);
        // 表把短词映到同样短的词：归一后仍 <2 字，不挂
        const syn2 = synWith("题", "题本");
        expect(textRefsFor("题", lex, syn2)).toEqual([]);
    });
});

describe("lexiconOfIndex（按选中文档的索引出词表，匹配入口用）", () => {
    it("小节入表；无小节结构的章按文档根入表（不越权到别的登记根）", () => {
        const lex = lexiconOfIndex({
            chapters: [
                {
                    docId: "d1",
                    title: "章一",
                    path: "书/章一",
                    sections: [{ id: "s1", title: "洛必达法则", path: "章一/洛必达法则" }],
                },
                { docId: "d2", title: "章二", path: "书/章二", sections: [] },
            ],
        });
        expect(textRefsFor("洛必达", lex)).toEqual([{ id: "s1", title: "洛必达法则" }]);
        expect(textRefsFor("章二", lex)).toEqual([{ id: "d2", title: "章二" }]);
    });

    it("同义表前置层同样生效（syn 可选，不传=改造前口径）", () => {
        const index = {
            chapters: [
                {
                    docId: "d1",
                    title: "章一",
                    path: "书/章一",
                    sections: [{ id: "s1", title: "L'Hôpital 法则", path: "章一/L'Hôpital 法则" }],
                },
            ],
        };
        const syn = {
            version: 1 as const,
            entries: {
                [synKey("洛必达")]: {
                    key: synKey("洛必达"),
                    raw: "洛必达",
                    canonical: "L'Hôpital 法则",
                    source: "ai" as const,
                    at: 1,
                },
            },
        };
        expect(textRefsFor("洛必达", lexiconOfIndex(index))).toEqual([]);
        // 查询侧也要过表（两侧同链），与 buildSectionLexicon 的用法一致
        expect(textRefsFor("洛必达", lexiconOfIndex(index, syn), syn)).toEqual([{ id: "s1", title: "L'Hôpital 法则" }]);
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

    it("同义表前置层并入 linkBankByText 的文本层（表未接线=改造前口径，零副作用）", async () => {
        const bank = bankWith([rec("q1", "洛必达")]);
        const lex = buildSectionLexicon([{ id: "s1", title: "洛必达法则" }]);
        const out = await linkBankByText(bank, lex, {});
        expect(out.hit).toBe(1);
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

describe("自由标签限长与 prompt 同源（Issue #143 P3-6）", () => {
    it("截断长度 === TAG_MAX_CHARS（原先解析侧写死 24、prompt 侧写死 12）", () => {
        expect(parseFreeTags(`1|${"标".repeat(TAG_MAX_CHARS + 20)}`).get(1)?.length).toBe(TAG_MAX_CHARS);
    });
});
