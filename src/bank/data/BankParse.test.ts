import { describe, expect, it } from "vitest";
import { parseKpRefs, parseQuestionKramdown, questionHash } from "./BankParse";
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
});
