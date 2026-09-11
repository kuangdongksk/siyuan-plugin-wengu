import { describe, expect, it } from "vitest";
import {
    extractRawEntries,
    hasRawEntries,
    isConfidentEntry,
    parseRawEntryLine,
    collectGlossMarks,
    GLOSS_MARK,
    parseGlossLines,
    planGlossLinks,
    prepareGlossBody,
    renderGlossBlock,
    splitGlossBlock,
    stripGlossMarks,
} from "./GlossEntry";

/**
 * 词条行保真（Issue #30）的纯逻辑面：行协议往返、`^{...}` 记号采集/剥除、
 * 正文词形精确匹配（含词边界与 possessive），以及「正文 + 尾部词表区」
 * 的幂等拆分。
 */

const SAMPLE =
    "Funding ^{补} is the key to research.\n\n" +
    "@@G funding | ['fʌndɪŋ'] | n. 资金；基金；提供基金\n" +
    "@@G crucial | ['kruːʃl'] | adj. 决定性的";

describe("renderGlossBlock / parseGlossLines：行协议往返", () => {
    it("三段竖线分隔，往返逐字一致", () => {
        const entries = [
            { word: "funding", phonetic: "['fʌndɪŋ']", meaning: "n. 资金；基金；提供基金" },
            { word: "crucial", phonetic: "['kruːʃl']", meaning: "adj. 决定性的" },
        ];
        const md = renderGlossBlock(entries);
        expect(md.split("\n")[0].startsWith(`${GLOSS_MARK} `)).toBe(true);
        expect(parseGlossLines(md)).toEqual(entries);
    });

    it("音标/释义缺省段为空串；无词形的行丢弃", () => {
        expect(parseGlossLines("@@G funding\n@@G  | ['x] | 释义")).toEqual([
            { word: "funding", phonetic: "", meaning: "" },
        ]);
    });

    it("释义含冒号/井号/分号原样保真（竖线才分隔）", () => {
        const e = { word: "ratio", phonetic: "['reɪʃɪəʊ]", meaning: "n. 比：# 比例；比率" };
        expect(parseGlossLines(renderGlossBlock([e]))).toEqual([e]);
    });

    it("内容里的裸竖线换全角（防段错位），换行折叠为空格", () => {
        const md = renderGlossBlock([{ word: "a|b", phonetic: "", meaning: "x\ny" }]);
        expect(md).toContain("a｜b");
        expect(md).not.toContain("\n2");
        expect(parseGlossLines(md)[0].meaning).toBe("x y");
    });

    it("非 @@G 行一律不认（正文里的 @@ 无关行不入词表）", () => {
        expect(parseGlossLines("@@Q type=single\n@@P stem\n@@G 词 | 音标 | 释义")).toEqual([
            { word: "词", phonetic: "音标", meaning: "释义" },
        ]);
    });
});

describe("collectGlossMarks / stripGlossMarks：^{...} 记号", () => {
    it("记号归属于它**前面**那个词（原卷 word ^{mark} 形态）", () => {
        const marks = collectGlossMarks("Funding ^{补} is the key.");
        expect(marks.get("funding")).toBe("补");
        expect(marks.get("key")).toBeUndefined(); // 记号只修饰前一个词
    });

    it("同词多记号取首个；大小写归一作键；中文/数字记号都认", () => {
        const marks = collectGlossMarks("Funding ^{补} and FUNDING ^{2} and x^{n}");
        expect(marks.get("funding")).toBe("补");
        expect(marks.get("x")).toBe("n");
    });

    it("剥除记号后正文干净、其它内容逐字保留", () => {
        expect(stripGlossMarks("Funding ^{补} is $x^2$ ok ^{2}")).toBe("Funding is $x^2$ ok");
    });

    it("数学/代码区间**不受影响**（$x^{2}$ 是 LaTeX 指数，不是词条记号）", () => {
        expect(stripGlossMarks("$x^{2}$ 与 a^b")).toBe("$x^{2}$ 与 a^b");
        expect(stripGlossMarks("$$\\int x^{n} dx$$")).toBe("$$\\int x^{n} dx$$");
        expect(stripGlossMarks("由 $a^{n}+b^{2}$ 得 $$x^{3}$$")).toBe("由 $a^{n}+b^{2}$ 得 $$x^{3}$$");
        expect(stripGlossMarks("`y^{2}` 与 funding ^{补}")).toBe("`y^{2}` 与 funding");
        expect(stripGlossMarks("```\na^{b}\n```\nc^{补}")).toBe("```\na^{b}\n```\nc");
    });

    it("数学区间外的记号照剥（与数学同段共存时各归各）", () => {
        expect(stripGlossMarks("求 $x^{2}$ 的导数。funding ^{补}")).toBe("求 $x^{2}$ 的导数。funding");
        // 未闭合的 $：本行余下按普通文本走（与 MdRender 同口径），记号照剥
        expect(stripGlossMarks("价 $5 与 ^{补}")).toBe("价 $5 与");
    });

    it("数学/代码区间内的 ^{...} 不采集（不挂到数学符号上）", () => {
        const marks = collectGlossMarks("$x^{2}$ 与 funding ^{补} 与 `y^{3}`");
        expect([...marks.keys()]).toEqual(["funding"]);
    });

    it("记号归属只在同行内判定（跨行不误挂）", () => {
        expect(collectGlossMarks("funding\n^{补}")).toEqual(new Map());
    });
});

describe("splitGlossBlock / prepareGlossBody：正文与词表区拆分", () => {
    it("词表行从正文摘掉，正文行序与内容保留", () => {
        const s = splitGlossBlock(SAMPLE);
        expect(s.body).toBe("Funding ^{补} is the key to research.");
        expect(s.entries).toEqual([
            { word: "funding", phonetic: "['fʌndɪŋ']", meaning: "n. 资金；基金；提供基金" },
            { word: "crucial", phonetic: "['kruːʃl']", meaning: "adj. 决定性的" },
        ]);
    });

    it("无词表时正文逐字节不变（存量材料零迁移）", () => {
        const plain = "阅读正文第一段\n\n第二段";
        expect(splitGlossBlock(plain)).toEqual({ body: plain, entries: [] });
    });

    it("prepareGlossBody：剥记号 + 拆词表 + 返回记号表（幂等）", () => {
        const p = prepareGlossBody(SAMPLE);
        expect(p.body).toBe("Funding is the key to research.");
        expect(p.entries).toHaveLength(2);
        expect(p.marks.get("funding")).toBe("补");
        const twice = prepareGlossBody(p.body);
        expect(twice.body).toBe(p.body);
        expect(twice.entries).toEqual([]);
    });
});

describe("planGlossLinks：正文词形精确匹配", () => {
    const entries = [
        { word: "funding", phonetic: "", meaning: "" },
        { word: "crucial", phonetic: "", meaning: "" },
    ];

    it("每词取首次出现，序号按词表序", () => {
        const hits = planGlossLinks("Funding is crucial; funding again is crucial again.", entries);
        expect(hits.map((h) => [h.text, h.start, h.order])).toEqual([
            ["Funding", 0, 1],
            ["crucial", 11, 2],
        ]);
    });

    it("大小写不敏感", () => {
        expect(planGlossLinks("FUNDING matters", entries)[0].text).toBe("FUNDING");
    });

    it("屈折变形不命中（不做词干还原，宁缺勿错）", () => {
        expect(planGlossLinks("The funds are fundings.", entries)).toEqual([]);
        expect(planGlossLinks("He funded the project.", entries)).toEqual([]);
    });

    it("词边界对齐：前缀/后缀误伤一律不命中", () => {
        expect(planGlossLinks("prefunding and fundinglike", entries)).toEqual([]);
    });

    it("连字符算词边界（复合词照命中，与 `prefunding` 区分）", () => {
        expect(planGlossLinks("funding-based approach", entries).map((h) => h.text)).toEqual(["funding"]);
        expect(planGlossLinks("co-funding rocks", entries).map((h) => h.text)).toEqual(["funding"]);
    });

    it("possessive 词形整体命中", () => {
        const pos = [{ word: "Newton's", phonetic: "", meaning: "" }];
        const hits = planGlossLinks("Newton's law holds.", pos);
        expect(hits[0].text).toBe("Newton's");
        expect(hits[0].end).toBe(8);
    });

    it("词表里没有的词、未命中的词都不产出（不报错）", () => {
        expect(planGlossLinks("nothing here", entries)).toEqual([]);
    });

    it("重叠命中只保留先出现者（防嵌套手术）", () => {
        const over = [
            { word: "fund", phonetic: "", meaning: "" },
            { word: "funding", phonetic: "", meaning: "" },
        ];
        // "fund" 落在 "funding" 内部：词边界拦掉，改取句尾那个独立 fund
        expect(planGlossLinks("funding is fund.", over).map((h) => [h.text, h.order])).toEqual([
            ["funding", 2],
            ["fund", 1],
        ]);
        expect(planGlossLinks("a fund and funding.", over).map((h) => [h.text, h.order])).toEqual([
            ["fund", 1],
            ["funding", 2],
        ]);
    });

    it("空正文/空词表零动作", () => {
        expect(planGlossLinks("", entries)).toEqual([]);
        expect(planGlossLinks("funding", [])).toEqual([]);
    });
});

describe("parseRawEntryLine / extractRawEntries：原卷词条行（确定性）", () => {
    it("考研真相形态：词 + ^{记号} + 音标 + 释义", () => {
        expect(parseRawEntryLine("funding ^{补} ['fʌndɪŋ] n. 资金；基金；提供基金")).toEqual({
            word: "funding",
            phonetic: "['fʌndɪŋ]",
            meaning: "n. 资金；基金；提供基金",
        });
    });

    it("无音标/无释义/斜杠音标都认", () => {
        expect(parseRawEntryLine("crucial ^{2} adj. 决定性的")).toEqual({
            word: "crucial",
            phonetic: "",
            meaning: "adj. 决定性的",
        });
        expect(parseRawEntryLine("crucial ^{2} /ˈkruːʃl/")).toEqual({
            word: "crucial",
            phonetic: "/ˈkruːʃl/",
            meaning: "",
        });
        expect(parseRawEntryLine("crucial ^{2}")).toEqual({ word: "crucial", phonetic: "", meaning: "" });
    });

    it("短语词条（两个词）与缩进/引用前缀都认", () => {
        expect(parseRawEntryLine("  > in particular ^{同} [ɪn pəˈtɪkjələ] adv. 尤其")?.word).toBe("in particular");
    });

    it("正文句子不当词条：无记号 / 记号后无词性且无中文", () => {
        expect(parseRawEntryLine("funding is the key to the research.")).toBeUndefined();
        expect(parseRawEntryLine("funding ^{补} is the key to research")).toBeUndefined();
        expect(parseRawEntryLine("")).toBeUndefined();
    });

    it("置信判据：带音标或词性标签才算真词条（数学/正文伪词条被滤掉）", () => {
        expect(isConfidentEntry({ word: "funding", phonetic: "['fʌndɪŋ]", meaning: "" })).toBe(true);
        expect(isConfidentEntry({ word: "crucial", phonetic: "", meaning: "adj. 决定性的" })).toBe(true);
        expect(isConfidentEntry({ word: "ratio", phonetic: "", meaning: "n. 比；比率" })).toBe(true);
        expect(isConfidentEntry({ word: "in particular", phonetic: "", meaning: "adv. 尤其" })).toBe(true);
        expect(isConfidentEntry({ word: "a", phonetic: "", meaning: "表示 n 次幂" })).toBe(false);
    });

    it("extractRawEntries：按出现序、同词形去重、忽略非词条行", () => {
        const md = [
            "Funding ^{补} is the key.",
            "funding ^{补} ['fʌndɪŋ] n. 资金",
            "crucial ^{2} adj. 决定性的",
            "FUNDING ^{补} ['fʌndɪŋ] n. 资金",
        ].join("\n");
        expect(extractRawEntries(md).map((e) => e.word)).toEqual(["funding", "crucial"]);
        expect(hasRawEntries(md)).toBe(true);
        expect(hasRawEntries("no entries here")).toBe(false);
    });
});
