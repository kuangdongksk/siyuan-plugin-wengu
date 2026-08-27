import { describe, expect, it } from "vitest";
import { shuffleChoiceOptions } from "./OptionShuffle";

/**
 * 选项洗牌的核心不变量：**正确项的内容跟着答案字母走**——无论洗成
 * 什么排列，落在新字母位置上的选项内容与重写后的答案必须一致（判分
 * 按字母比，这里锁定「洗完仍判得对」）。位置敏感措辞/无字母语义题型
 * 原样返回。
 */

const PART = /custom-plugin-wengu-part="([a-z0-9-]+)"/;

/** 从 kramdown 里抓 part → 内容行（IAL 前一行）的映射（测试用迷你解析）。 */
function partBodies(kd: string): Map<string, string> {
    const lines = kd.split("\n");
    const out = new Map<string, string>();
    lines.forEach((line, i) => {
        const m = PART.exec(line);
        if (m) out.set(m[1], (lines[i - 1] ?? "").trim());
    });
    return out;
}

function singleKd(options: string[], answerLetter: string): string {
    return [
        "{{{row",
        "下列说法正确的是？",
        '{: custom-plugin-wengu-part="stem"}',
        "",
        ...options.flatMap((text, i) => [`- ${text}`, `{: custom-plugin-wengu-part="option-${i}"}`, ""]),
        `> ${answerLetter}`,
        '{: custom-plugin-wengu-part="answer"}',
        "}}}",
        '{: custom-plugin-wengu-type="single" custom-plugin-wengu-q="1"}',
    ].join("\n");
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

describe("shuffleChoiceOptions · single", () => {
    it("正确项内容与重写后的答案字母保持对应", () => {
        const kd = singleKd(["甲方法", "乙方法", "丙方法", "丁方法"], "B");
        const out = shuffleChoiceOptions(kd);
        const bodies = partBodies(out);
        // 答案字母被重写为某个新字母，且该字母位置上仍是原正确项内容
        const newAnswer = (bodies.get("answer") ?? "").replace(/^>\s*/, "").trim();
        expect(newAnswer).toMatch(/^[A-D]$/);
        const pos = LETTERS.indexOf(newAnswer);
        expect((bodies.get(`option-${pos}`) ?? "").replace(/^- /, "")).toBe("乙方法");
        // 四个选项整体不丢不重，part 序号连续
        for (let i = 0; i < 4; i++) expect(bodies.has(`option-${i}`)).toBe(true);
        const texts = [0, 1, 2, 3].map((i) => (bodies.get(`option-${i}`) ?? "").replace(/^- /, ""));
        expect(texts.sort()).toEqual(["丁方法", "丙方法", "乙方法", "甲方法"].sort());
    });
    it("multiple：两个正确项的内容集合与新答案字母集合对应", () => {
        const kd = singleKd(["甲", "乙", "丙", "丁"], "AB");
        const out = shuffleChoiceOptions(kd);
        const bodies = partBodies(out);
        const newAnswer = (bodies.get("answer") ?? "").replace(/^>\s*/, "").trim();
        expect(newAnswer).toMatch(/^[A-D]{2}$/);
        const hit = [...newAnswer].map((ch) => (bodies.get(`option-${LETTERS.indexOf(ch)}`) ?? "").replace(/^- /, ""));
        expect(hit.sort()).toEqual(["乙", "甲"]);
    });
});

describe("shuffleChoiceOptions · 跳过语义", () => {
    it("位置敏感措辞（以上都对）原样返回", () => {
        const kd = singleKd(["甲", "乙", "以上都对"], "C");
        expect(shuffleChoiceOptions(kd)).toBe(kd);
    });
    it("judge/fill 无字母重排语义，原样返回", () => {
        const kd = singleKd(["对", "错"], "A").replace(
            'custom-plugin-wengu-type="single"',
            'custom-plugin-wengu-type="judge"'
        );
        expect(shuffleChoiceOptions(kd)).toBe(kd);
    });
    it("只有 1 个选项不可洗，原样返回", () => {
        const kd = singleKd(["唯一"], "A");
        expect(shuffleChoiceOptions(kd)).toBe(kd);
    });
});

describe("shuffleChoiceOptions · steps", () => {
    it("每步选项各自洗且答案字母同步（method 步可行集合保持）", () => {
        const kd = [
            "{{{row",
            "计算题……",
            '{: custom-plugin-wengu-part="stem"}',
            "",
            "第 1 步 · 选方法：可行的是（ ）",
            '{: custom-plugin-wengu-part="step-0-stem"}',
            "",
            "- 洛必达",
            '{: custom-plugin-wengu-part="step-0-option-0"}',
            "",
            "- 等价无穷小",
            '{: custom-plugin-wengu-part="step-0-option-1"}',
            "",
            "- 泰勒展开",
            '{: custom-plugin-wengu-part="step-0-option-2"}',
            "",
            "> AB",
            '{: custom-plugin-wengu-part="step-0-answer"}',
            "",
            "第 2 步 · 结果是（ ）",
            '{: custom-plugin-wengu-part="step-1-stem"}',
            "",
            "- 1",
            '{: custom-plugin-wengu-part="step-1-option-0"}',
            "",
            "- 0",
            '{: custom-plugin-wengu-part="step-1-option-1"}',
            "",
            "> B",
            '{: custom-plugin-wengu-part="step-1-answer"}',
            "}}}",
            '{: custom-plugin-wengu-type="steps" custom-plugin-wengu-steps="method|result" custom-plugin-wengu-q="1"}',
        ].join("\n");
        const out = shuffleChoiceOptions(kd);
        const bodies = partBodies(out);
        const ans0 = (bodies.get("step-0-answer") ?? "").replace(/^>\s*/, "").trim();
        expect(ans0).toMatch(/^[A-C]{2}$/);
        for (const ch of ans0) {
            expect(["- 洛必达", "- 等价无穷小"]).toContain(bodies.get(`step-0-option-${LETTERS.indexOf(ch)}`));
        }
        const ans1 = (bodies.get("step-1-answer") ?? "").replace(/^>\s*/, "").trim();
        expect(ans1).toMatch(/^[A-B]$/);
        expect((bodies.get(`step-1-option-${LETTERS.indexOf(ans1)}`) ?? "").replace(/^- /, "")).toBe("0");
    });
});
