import { describe, expect, it } from "vitest";
import { shuffleDraftOptions } from "./OptionShuffle";
import { parseDrafts, type DraftUnit } from "./QuestionDraft";

/**
 * 选项洗牌的核心不变量：**正确项的内容跟着答案字母走**——无论洗成
 * 什么排列，落在新字母位置上的选项内容与重写后的答案必须一致（判分
 * 按字母比，这里锁定「洗完仍判得对」）。位置敏感措辞/无字母语义题型
 * 原样不动。draft 层洗牌：部件数组重排 + 答案字母按「新位置」重编，
 * 字母本身由渲染按顺序自动编（本测试只验证 draft 内部一致性）。
 */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 造一道协议题并解析成 draft（真实路径：parseDrafts → shuffle → 断言）。 */
function draftOf(opts: string[], ans: string, type = "single", extraQ = ""): DraftUnit {
    const lines = [`@@Q type=${type}${extraQ}`, "@@P stem", "下列说法正确的是？"];
    for (const o of opts) lines.push("@@P opt", o);
    lines.push("@@P ans", ans, "@@P sol", "解析", "@@END");
    return parseDrafts(lines.join("\n"))[0];
}

/** draft 里某 part 名的全部文本。 */
function textsOf(d: DraftUnit, name: string): string[] {
    return d.parts.filter((p) => p.name === name).map((p) => p.text);
}

describe("shuffleDraftOptions · single", () => {
    it("正确项内容与重写后的答案字母保持对应", () => {
        const d = draftOf(["甲方法", "乙方法", "丙方法", "丁方法"], "B");
        shuffleDraftOptions(d);
        const ans = textsOf(d, "answer")[0];
        expect(ans).toMatch(/^[A-D]$/);
        const pos = LETTERS.indexOf(ans);
        expect(textsOf(d, "option-0")[pos]).toBe("乙方法"); // 字母=选项位置
        const all = textsOf(d, "option-0");
        expect(all.sort()).toEqual(["丁方法", "丙方法", "乙方法", "甲方法"].sort());
    });
    it("multiple：两个正确项的内容集合与新答案字母集合对应", () => {
        const d = draftOf(["甲", "乙", "丙", "丁"], "AB");
        shuffleDraftOptions(d);
        const ans = textsOf(d, "answer")[0];
        expect(ans).toMatch(/^[A-D]{2}$/);
        const opts = textsOf(d, "option-0");
        expect([...ans].map((ch) => opts[LETTERS.indexOf(ch)]).sort()).toEqual(["乙", "甲"]);
    });
    it("洗牌结果不会恒等于原序（正确项写最前时原序=答案恒 A 的剧透）", () => {
        const d = draftOf(["正确项", "干扰一", "干扰二", "干扰三"], "A");
        shuffleDraftOptions(d);
        expect(textsOf(d, "option-0")).not.toEqual(["正确项", "干扰一", "干扰二", "干扰三"]);
    });
});

describe("shuffleDraftOptions · 跳过语义", () => {
    it("位置敏感措辞（以上都对）原样不动", () => {
        const d = draftOf(["甲", "乙", "以上都对"], "C");
        const before = d.parts.map((p) => `${p.name}:${p.text}`);
        shuffleDraftOptions(d);
        expect(d.parts.map((p) => `${p.name}:${p.text}`)).toEqual(before);
    });
    it("judge/fill 无字母重排语义，原样不动", () => {
        const d = draftOf(["对", "错"], "A", "judge");
        const before = d.parts.map((p) => `${p.name}:${p.text}`);
        shuffleDraftOptions(d);
        expect(d.parts.map((p) => `${p.name}:${p.text}`)).toEqual(before);
    });
    it("只有 1 个选项不可洗，原样不动", () => {
        const d = draftOf(["唯一"], "A");
        const before = d.parts.map((p) => `${p.name}:${p.text}`);
        shuffleDraftOptions(d);
        expect(d.parts.map((p) => `${p.name}:${p.text}`)).toEqual(before);
    });
    it("答案是内容而非字母（判分走内容比对）不洗", () => {
        const d = draftOf(["甲", "乙"], "$e^2$");
        const before = d.parts.map((p) => `${p.name}:${p.text}`);
        shuffleDraftOptions(d);
        expect(d.parts.map((p) => `${p.name}:${p.text}`)).toEqual(before);
    });
});

describe("shuffleDraftOptions · steps", () => {
    it("每步选项各自洗且答案字母同步（method 步可行集合保持）", () => {
        const lines = [
            "@@Q type=steps steps=method|result",
            "@@P stem",
            "计算题……",
            "@@P step",
            "第 1 步 · 选方法：可行的是（ ）",
            "@@P step-opt",
            "洛必达",
            "@@P step-opt",
            "等价无穷小",
            "@@P step-opt",
            "泰勒展开",
            "@@P step-ans",
            "AB",
            "@@P step",
            "第 2 步 · 结果是（ ）",
            "@@P step-opt",
            "1",
            "@@P step-opt",
            "0",
            "@@P step-ans",
            "B",
            "@@P sol",
            "完整解析",
            "@@END",
        ];
        const d = parseDrafts(lines.join("\n"))[0];
        shuffleDraftOptions(d);
        const ans0 = textsOf(d, "step-1-answer")[0];
        expect(ans0).toMatch(/^[A-C]{2}$/);
        const opts0 = textsOf(d, "step-1-option-0");
        for (const ch of ans0) expect(["洛必达", "等价无穷小"]).toContain(opts0[LETTERS.indexOf(ch)]);
        const ans1 = textsOf(d, "step-2-answer")[0];
        expect(ans1).toMatch(/^[A-B]$/);
        expect(textsOf(d, "step-2-option-0")[LETTERS.indexOf(ans1)]).toBe("0");
    });
});
