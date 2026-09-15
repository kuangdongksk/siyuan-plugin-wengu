import { describe, expect, it } from "vitest";
import { injectKnowledgeRefs, knowledgeRefLine, stripKnowledgeRefs } from "../knowledge/KnowRef";
import { parseQuestionKramdown } from "../../../bank/data/BankParse";

/**
 * 知识点引用行的注入/剥除往返（Issue #115）：本模块 93 行、四个导出全是
 * **纯文本**，但它是 kpRefs ↔ kramdown 的唯一真相——inject 写坏一行，
 * 题库解析器就读不出引用（反链空）、strip 少吞一个换行就会在重挂时把
 * 解析块的行尾 IAL 顶散（20260828 审查：越跑越坏）。这里锁三件事：
 *  ① knowledgeRefLine 的消毒与格式（引用前缀、标题引号/换行/超长）；
 *  ② strip∘inject 往返幂等（重复重挂不叠加引用行）；
 *  ③ inject 的两种落点（有解析块尾插 / 无解析块补独立块）与解析闭环
 *     （产物过 parseQuestionKramdown 能读出 kpRefs）。
 */

const refs = [
    { id: "20260901120000-aaaaaaa", title: "极限" },
    { id: "20260901120000-bbbbbbb", title: "导数" },
];

describe("knowledgeRefLine · 格式与消毒", () => {
    it("引用行带块引用前缀，格式与生成侧一致", () => {
        expect(knowledgeRefLine(refs)).toBe(
            '> 相关知识点：((20260901120000-aaaaaaa "极限")) ((20260901120000-bbbbbbb "导数"))'
        );
    });

    it("标题里的引号/尖括号/换行被消毒成空格（引用文本不破句）", () => {
        const line = knowledgeRefLine([{ id: "id-1", title: 'a"b<c>\nd' }]);
        expect(line).toBe('> 相关知识点：((id-1 "a b c d"))');
        expect(line).not.toContain("\n"); // 换行被折成空格，引用行仍是单行
    });

    it("超长标题截断到 50 字（锚文本不撑爆行）", () => {
        const line = knowledgeRefLine([{ id: "id-1", title: "x".repeat(80) }]);
        expect(line).toBe(`> 相关知识点：((id-1 "${"x".repeat(50)}"))`);
    });

    it("空清单出空引用行（调用方靠 inject 的长度判断短路）", () => {
        expect(knowledgeRefLine([])).toBe("> 相关知识点：");
    });
});

describe("stripKnowledgeRefs · 剥除", () => {
    it("剥掉引用行本身与它的尾随换行（不只删内容留空行）", () => {
        const kd = ["正文一", knowledgeRefLine(refs), "正文二"].join("\n");
        expect(stripKnowledgeRefs(kd)).toBe("正文一\n正文二");
        // 引用行后本就带空行时：连行尾换行一起吞，只留一个分隔空行
        const kd2 = ["正文一", knowledgeRefLine(refs), "", "正文二"].join("\n");
        expect(stripKnowledgeRefs(kd2)).toBe("正文一\n\n正文二");
    });

    it("缩进/多行引用都能剥（历史脏形态）", () => {
        const kd = ["正文", '\t> 相关知识点：((id-1 "极限"))', '   > 相关知识点：((id-2 "导数"))', "尾"].join("\n");
        expect(stripKnowledgeRefs(kd)).toBe("正文\n尾");
    });

    it("非引用行不受影响（正文里出现「相关知识点」字样也一样）", () => {
        const kd = "这一节的相关知识点：极限的定义\n正文";
        expect(stripKnowledgeRefs(kd)).toBe(kd);
    });

    it("把三段以上连续空行折成两段（剥后不留空窗）", () => {
        expect(stripKnowledgeRefs("a\n\n\n\nb")).toBe("a\n\nb");
    });

    it("无引用行时逐字节不变", () => {
        const kd = "题干\n\n解析";
        expect(stripKnowledgeRefs(kd)).toBe(kd);
    });
});

describe("injectKnowledgeRefs · 注入落点", () => {
    /** 契约形态的题目 kramdown（与题库解析器同构）。 */
    const kdWithSolution = [
        "{{{row",
        "{{{",
        "题干",
        '{: custom-plugin-wengu-part="stem"}',
        "}}}",
        "",
        "{{{",
        "解析",
        '{: custom-plugin-wengu-part="solution"}',
        "}}}",
        "}}}",
        '{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}',
    ].join("\n");

    it("空清单直接返回原文（零改动）", () => {
        expect(injectKnowledgeRefs(kdWithSolution, [])).toBe(kdWithSolution);
    });

    it("有解析块：引用行插在解析块尾、IAL 尾行之前（不顶到容器外）", () => {
        const out = injectKnowledgeRefs(kdWithSolution, refs);
        const idx = out.indexOf("相关知识点");
        const lastIal = out.lastIndexOf('{: custom-plugin-wengu-part="solution"}');
        expect(idx).toBeGreaterThan(out.indexOf("解析"));
        expect(idx).toBeLessThan(lastIal); // 引用行在解析块内、IAL 之前
    });

    it("无解析块：在容器尾补一个独立解析块，引用行落在其内", () => {
        const kd = [
            "{{{row",
            "{{{",
            "题干",
            '{: custom-plugin-wengu-part="stem"}',
            "}}}",
            "}}}",
            '{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}',
        ].join("\n");
        const out = injectKnowledgeRefs(kd, refs);
        const parsed = parseQuestionKramdown(out, "q1");
        expect(parsed).toBeDefined();
        expect(out).toContain('custom-plugin-wengu-part="solution"');
        expect(parsed?.solutionMd ?? "").toContain("相关知识点"); // 引用行在解析块内
        expect(parsed?.stemMd).toBe("题干"); // 题干不动
        // 剥回原题（往返闭合：只多出补写的那对解析 IAL 尾行，题面逐字不动）
        const back = stripKnowledgeRefs(out);
        expect(back).toContain(kd.split("\n").slice(0, 5).join("\n"));
        expect(back).not.toContain("相关知识点");
    });

    it("容器缺失（找不到 }}}）时原样返回（不拼出半截块）", () => {
        expect(injectKnowledgeRefs("裸文本", refs)).toBe("裸文本");
    });
});

describe("inject × strip × inject · 往返一致性", () => {
    const base = [
        "{{{row",
        "{{{",
        "题干",
        '{: custom-plugin-wengu-part="stem"}',
        "}}}",
        "",
        "{{{",
        "解析",
        '{: custom-plugin-wengu-part="solution"}',
        "}}}",
        "}}}",
        '{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}',
    ].join("\n");

    it("重复重挂：引用行不叠加（strip→inject 再来一遍仍只有一条）", () => {
        const once = injectKnowledgeRefs(base, refs);
        const twice = injectKnowledgeRefs(stripKnowledgeRefs(once), refs);
        expect(once.match(/相关知识点/g)!.length).toBe(1);
        expect(twice.match(/相关知识点/g)!.length).toBe(1);
        // 语义等价：两次产物解析出的引用行完全相同（空行分布会随重跑收敛）
        expect(twice.includes(knowledgeRefLine(refs))).toBe(true);
        expect(parseQuestionKramdown(twice, "q1")?.solutionMd ?? "").toContain('((20260901120000-aaaaaaa "极限"))');
    });

    it("换一组引用：旧的剥干净、新的落下（不残留两条引用行）", () => {
        const once = injectKnowledgeRefs(base, refs);
        const other = [{ id: "id-9", title: "新的知识点" }];
        const next = injectKnowledgeRefs(stripKnowledgeRefs(once), other);
        expect(next).not.toContain("极限");
        expect(next.match(/相关知识点/g)!.length).toBe(1);
        expect(next).toContain("新的知识点");
    });

    it("产物能被题库解析器读出（反链闭环：解析块内文本含引用行）", () => {
        const out = injectKnowledgeRefs(base, refs);
        const parsed = parseQuestionKramdown(out, "q1");
        expect(parsed?.solutionMd ?? "").toContain('((20260901120000-aaaaaaa "极限"))');
        expect(parsed?.stemMd).toBe("题干"); // 注引用不污染题干
    });

    it("strip 只摘引用行：题面/解析/容器 IAL 逐字保留", () => {
        const out = injectKnowledgeRefs(base, refs);
        const back = stripKnowledgeRefs(out);
        // 题面逐段保留（只少了引用行与它旁边那个空行）
        for (const line of ["{{{row", "题干", "解析", '{: custom-plugin-wengu-part="stem"}']) {
            expect(back).toContain(line);
        }
        expect(back).toContain('{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}'); // 容器 IAL 未悬空
        expect(back).not.toContain("相关知识点");
        expect(back).not.toContain("\n\n\n"); // 无残留空窗
    });
});
