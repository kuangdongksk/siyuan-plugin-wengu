import { describe, expect, it } from "vitest";
import { parseKpRefs, parseMaterialKramdown, parseQuestionKramdown, questionHash } from "./BankParse";
import { QuestionType } from "../../types";

/**
 * 题库侧 kramdown 解析（落盘即真相 → 结构化视图），语义与文档模式
 * hydrate 一一对应——两路并存，这里锁「题库路」不漂移。
 */

const singleKd = [
    "{{{row",
    "下列说法正确的是？",
    '{: custom-plugin-wengu-part="stem"}',
    "",
    "- A. 甲",
    '{: custom-plugin-wengu-part="option-0"}',
    "",
    "- B. 乙",
    '{: custom-plugin-wengu-part="option-1"}',
    "",
    "> B",
    '{: custom-plugin-wengu-part="answer"}',
    "",
    '见 ((20260821165017-abc123de "洛必达法则")) 与 ((20260821165017-abc123de "洛必达法则"))',
    '{: custom-plugin-wengu-part="solution"}',
    "}}}",
    '{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single" custom-plugin-wengu-difficulty="3" custom-plugin-wengu-knowledge="极限"}',
].join("\n");

describe("parseQuestionKramdown · 单题", () => {
    it("容器属性与子块 part 全量装配", () => {
        const q = parseQuestionKramdown(singleKd, "qid1", "root1");
        expect(q).toBeDefined();
        expect(q?.type).toBe(QuestionType.Single);
        expect(q?.difficulty).toBe(3);
        expect(q?.knowledge).toBe("极限");
        expect(q?.stemMd).toContain("下列说法正确的是");
        expect(q?.optionMd).toHaveLength(2);
        expect(q?.answer).toBe("B");
        expect(q?.solutionMd).toContain("洛必达法则");
    });
    it("解析里的知识点块引用按 id 去重", () => {
        const q = parseQuestionKramdown(singleKd, "qid1");
        expect(q?.kpRefs).toEqual([{ id: "20260821165017-abc123de", title: "洛必达法则" }]);
    });
    it("缺容器 IAL / 缺 type 返回 undefined", () => {
        expect(parseQuestionKramdown("没有容器的裸文本", "qid")).toBeUndefined();
        const noType = singleKd.replace(' custom-plugin-wengu-type="single"', "");
        expect(parseQuestionKramdown(noType, "qid")).toBeUndefined();
    });

    it("子块 IAL 残渣清理（列表项行内尾随/缩进行/块引用行，20260829 真机踩坑）", () => {
        // 思源 kramdown 读回的真实形态：列表项首段 IAL 行内尾随、条目自身
        // IAL 缩进独立成行、块引用子块 IAL 带 > 前缀——不清理会以
        // "updated=…"}A. 字面文本泄漏到渲染侧
        const kd = [
            "{{{row",
            "题干",
            '{: id="20260825115806-zjzkei2" updated="20260825115806" custom-plugin-wengu-part="stem"}',
            "",
            '- {: id="20260825115806-veod33h" updated="20260825115806"}A. 甲',
            '  {: id="20260825115806-hzinuke" updated="20260825115806"}',
            '- {: id="20260825115806-3p0lxmx" updated="20260825115806"}B. 乙',
            '  {: id="20260825115806-m43n61o" updated="20260825115806"}',
            '{: id="20260825115806-1sh94wt" updated="20260825115806" custom-plugin-wengu-part="option-0"}',
            "",
            "> 正确答案：A",
            '> {: id="20260825115806-rhlm2sz" updated="20260825115806"}',
            ">",
            '{: id="20260825115806-nklqlwa" updated="20260825115806" custom-plugin-wengu-part="answer"}',
            "",
            "解析 $x$",
            '{: id="20260825115806-4wsulpj" updated="20260825115806" custom-plugin-wengu-part="solution"}',
            "}}}",
            '{: id="20260825115806-0xnzdaj" updated="20260825115806" custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}',
        ].join("\n");
        const q = parseQuestionKramdown(kd, "qid1");
        expect(q).toBeDefined();
        const json = JSON.stringify(q);
        expect(json).not.toContain("{:");
        expect(json).not.toContain("updated=");
        expect(q?.optionMd).toEqual(["- A. 甲", "- B. 乙"]);
        expect(q?.answer).toBe("A");
    });
});

describe("parseQuestionKramdown · steps", () => {
    const stepsKd = [
        "{{{row",
        "计算题……",
        '{: custom-plugin-wengu-part="stem"}',
        "",
        "第 1 步 · 选方法",
        '{: custom-plugin-wengu-part="step-0-stem"}',
        "",
        "- 洛必达",
        '{: custom-plugin-wengu-part="step-0-option-0"}',
        "",
        "> AB",
        '{: custom-plugin-wengu-part="step-0-answer"}',
        "",
        "第 2 步 · 结果",
        '{: custom-plugin-wengu-part="step-1-stem"}',
        "",
        "> 0",
        '{: custom-plugin-wengu-part="step-1-answer"}',
        "}}}",
        '{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="steps" custom-plugin-wengu-steps="method|result"}',
    ].join("\n");
    it("steps 属性声明 kind，step-k-* 子块按步聚合", () => {
        const q = parseQuestionKramdown(stepsKd, "qid");
        expect(q?.steps).toHaveLength(2);
        expect(q?.steps?.[0].kind).toBe("method");
        expect(q?.steps?.[0].optionMd).toEqual(["- 洛必达"]);
        expect(q?.steps?.[0].answer).toBe("AB");
        expect(q?.steps?.[1].kind).toBe("result");
        expect(q?.steps?.[1].answer).toBe("0");
    });
});

describe("parseKpRefs", () => {
    it("块引用按 id 去重、按出现序返回", () => {
        const refs = parseKpRefs(
            '((20260821165017-aaa "甲")) 提到 ((20260821165017-bbb "乙")) 与 ((20260821165017-aaa "甲"))'
        );
        expect(refs).toEqual([
            { id: "20260821165017-aaa", title: "甲" },
            { id: "20260821165017-bbb", title: "乙" },
        ]);
    });
});

describe("questionHash", () => {
    it("块 id/updated 属性与空白差异不影响指纹（跨卷同题去重依据）", () => {
        const a =
            '{{{row\n题干\n{: custom-plugin-wengu-part="stem"}\n}}}\n{: id="20260821165017-aaa" updated="20260821165017"}';
        const b =
            '{{{row\n题干\n{:  custom-plugin-wengu-part="stem"}\n}}}\n{: id="20260999999999-zzz" updated="20260999999999"}';
        expect(questionHash(a)).toBe(questionHash(b));
    });
    it("内容不同指纹不同", () => {
        expect(questionHash("题干甲")).not.toBe(questionHash("题干乙"));
    });
    it("运行时统计属性剥除（自托管二期）：作答/改判不扰动指纹，存量残值不假漂移", () => {
        const base = '题干\n{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}';
        const answered =
            '题干\n{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single" custom-plugin-wengu-attempts="9" custom-plugin-wengu-wrong-count="3" custom-plugin-wengu-right="0" custom-plugin-wengu-last-answer="A" custom-plugin-wengu-step-right="10" custom-plugin-wengu-step-last="A|B" custom-plugin-wengu-slot-right="1" custom-plugin-wengu-slot-last="A" custom-plugin-wengu-total-time="120"}';
        expect(questionHash(base)).toBe(questionHash(answered));
    });
    it("契约属性保留参与指纹：type/knowledge/src-hash 变=内容真变了", () => {
        const a = '题干\n{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}';
        const b = '题干\n{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="judge"}';
        const c =
            '题干\n{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single" custom-plugin-wengu-knowledge="极限"}';
        const d =
            '题干\n{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single" custom-plugin-wengu-src-hash="abc-1"}';
        expect(questionHash(a)).not.toBe(questionHash(b));
        expect(questionHash(a)).not.toBe(questionHash(c));
        expect(questionHash(a)).not.toBe(questionHash(d));
    });
});

/* ── 20260903 审查 P1 补齐：slots 聚合 / match 拆字母 / 存量组链 IAL ── */

const clozeKd = [
    "{{{row",
    "完形语篇题干（空位 __1__）",
    '{: custom-plugin-wengu-part="stem"}',
    "",
    "A 选项文本",
    '{: custom-plugin-wengu-part="slot-1-option-0"}',
    "",
    "B 选项文本",
    '{: custom-plugin-wengu-part="slot-1-option-1"}',
    "",
    "A",
    '{: custom-plugin-wengu-part="slot-1-answer"}',
    "",
    "C 选项文本",
    '{: custom-plugin-wengu-part="slot-2-option-0"}',
    "",
    "C",
    '{: custom-plugin-wengu-part="slot-2-answer"}',
    "}}}",
    '{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="cloze"}',
].join("\n");

describe("parseQuestionKramdown · slots 聚合（cloze 逐空）", () => {
    it("slot-{k}-option/answer 按空聚合出 q.slots", () => {
        const q = parseQuestionKramdown(clozeKd, "q1");
        expect(q?.slots).toHaveLength(2);
        expect(q?.slots?.[0]).toMatchObject({ answer: "A" });
        expect(q?.slots?.[0]?.optionMd).toEqual(["A 选项文本", "B 选项文本"]);
        expect(q?.slots?.[1]).toMatchObject({ answer: "C" });
    });
    it("match 无 slot 子块时按题级 answer 拆字母兜底（候选池=optionMd）", () => {
        const kd = [
            "{{{row",
            "七选五题干",
            '{: custom-plugin-wengu-part="stem"}',
            "",
            "- 候选甲",
            '{: custom-plugin-wengu-part="option-0"}',
            "",
            "- 候选乙",
            '{: custom-plugin-wengu-part="option-1"}',
            "",
            "> D|A",
            '{: custom-plugin-wengu-part="answer"}',
            "}}}",
            '{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="match"}',
        ].join("\n");
        const q = parseQuestionKramdown(kd, "q2");
        expect(q?.type).toBe(QuestionType.Match);
        expect(q?.slots?.map((s) => s.answer)).toEqual(["D", "A"]);
        expect(q?.slots?.[0]?.optionMd).toEqual([]);
    });
    it("存量容器 group IAL 解析进 q.group（记录字段缺省时的组链兜底）", () => {
        const kd = singleKd.replace(
            'custom-plugin-wengu-knowledge="极限"',
            'custom-plugin-wengu-knowledge="极限" custom-plugin-wengu-group="20260811172855-ta6w8oh"'
        );
        expect(parseQuestionKramdown(kd, "q3")?.group).toBe("20260811172855-ta6w8oh");
    });
});

describe("parseMaterialKramdown · 存量材料超级块", () => {
    it("material=1 容器解析 body/trans；非材料容器/空材料返回 undefined", () => {
        const matKd = [
            "{{{row",
            "阅读原文第一段",
            '{: custom-plugin-wengu-part="body"}',
            "",
            "参考译文",
            '{: custom-plugin-wengu-part="trans"}',
            "}}}",
            '{: custom-plugin-wengu-material="1"}',
        ].join("\n");
        const mat = parseMaterialKramdown(matKd, "mat1", "set1");
        expect(mat).toMatchObject({ id: "mat1", rootId: "set1", bodyMd: "阅读原文第一段", transMd: "参考译文" });
        expect(parseMaterialKramdown(singleKd, "mat2", "set1")).toBeUndefined();
    });
});
