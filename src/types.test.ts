import { describe, expect, it } from "vitest";
import { QuestionType } from "./types";
import {
    cleanStemMd,
    normAnswerText,
    normalizeAnswerMd,
    normalizeType,
    optionComparable,
    optionDisplayMd,
    parseDifficulty,
    parseStepKinds,
    splitOptionMd,
} from "./types";

/**
 * 契约归一化层：块属性/子块文本 → 结构化视图的「翻译规则」，判分与
 * 渲染都压在这些函数上。中文别名/边界值/容错口径在此锁定。
 */

describe("normalizeType", () => {
    it("英文题型大小写不敏感", () => {
        expect(normalizeType("SINGLE")).toBe(QuestionType.Single);
        expect(normalizeType(" Steps ")).toBe(QuestionType.Steps);
    });
    it("中文别名归一", () => {
        expect(normalizeType("多步")).toBe(QuestionType.Steps);
        expect(normalizeType("完形")).toBe(QuestionType.Cloze);
        expect(normalizeType("新题型")).toBe(QuestionType.Match);
        expect(normalizeType("翻译")).toBe(QuestionType.Trans);
    });
    it("无法识别返回 undefined（走自评流程）", () => {
        expect(normalizeType("garbage")).toBeUndefined();
        expect(normalizeType("")).toBeUndefined();
        expect(normalizeType(undefined)).toBeUndefined();
    });
});

describe("parseDifficulty", () => {
    it("1~5 整数合法", () => {
        expect(parseDifficulty("1")).toBe(1);
        expect(parseDifficulty("5")).toBe(5);
    });
    it("越界/非整数/非数字返回 undefined", () => {
        expect(parseDifficulty("0")).toBeUndefined();
        expect(parseDifficulty("6")).toBeUndefined();
        expect(parseDifficulty("2.5")).toBeUndefined();
        expect(parseDifficulty("hard")).toBeUndefined();
    });
});

describe("parseStepKinds", () => {
    it("竖线/逗号/中文变体分隔", () => {
        expect(parseStepKinds("method|result")).toEqual(["method", "result"]);
        expect(parseStepKinds("方法，结果")).toEqual(["method", "result"]);
        expect(parseStepKinds("method result")).toEqual(["method", "result"]);
    });
    it("出现非法步类型整体放弃（undefined，全部按 result 容错）", () => {
        expect(parseStepKinds("method|bad")).toBeUndefined();
        expect(parseStepKinds("")).toBeUndefined();
    });
});

describe("答案与题干清洗", () => {
    it("normalizeAnswerMd：剥引述前缀/答案标签/转义竖线", () => {
        expect(normalizeAnswerMd("> B")).toBe("B");
        expect(normalizeAnswerMd("正确答案：B")).toBe("B");
        expect(normalizeAnswerMd("Answer: A")).toBe("A");
        expect(normalizeAnswerMd("a\\|b")).toBe("a|b");
        expect(normalizeAnswerMd("> 第一行\n> 第二行")).toBe("第一行\n第二行");
    });
    it("cleanStemMd：剥「题干A：」类前缀与悬空 **", () => {
        expect(cleanStemMd("题干A：实际内容")).toBe("实际内容");
        expect(cleanStemMd("题干：**内容")).toBe("内容");
        expect(cleanStemMd("普通题干")).toBe("普通题干");
    });
    it("normAnswerText：大写、去空白、去 $ 定界（^ 保留）", () => {
        expect(normAnswerText(" $e^2$ ")).toBe("E^2");
        expect(normAnswerText("a b")).toBe("AB");
    });
});

describe("splitOptionMd", () => {
    it("一个列表块拆成逐选项（嵌套行跟随父条目）", () => {
        expect(splitOptionMd("- A. 甲\n  甲续行\n- B. 乙")).toEqual(["- A. 甲\n  甲续行", "- B. 乙"]);
    });
    it("无列表标记整块返回", () => {
        expect(splitOptionMd("纯文本选项")).toEqual(["纯文本选项"]);
        expect(splitOptionMd("")).toEqual([""]);
    });
});

describe("选项展示与可比文本", () => {
    it("optionDisplayMd：去列表标记与字母标签", () => {
        expect(optionDisplayMd("- A. 甲")).toBe("甲");
        expect(optionDisplayMd("B、乙")).toBe("乙");
        expect(optionDisplayMd("(C) 丙")).toBe("丙");
    });
    it("optionComparable：展示文本再判分规整；小数选项不被当有序列表标记", () => {
        expect(optionComparable("- B. $e^2$")).toBe("E^2");
        expect(optionComparable("1.5")).toBe("1.5");
        expect(optionComparable("0.5")).toBe("0.5");
        expect(optionComparable("1. 选项一")).toBe("选项一");
    });
});
