import { describe, expect, it } from "vitest";
import { shuffleDraftOptions } from "../draft/OptionShuffle";
import { parseDrafts, type DraftUnit } from "../draft/QuestionDraft";

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

describe("shuffleDraftOptions · 拆行 unpack（挤行选项）", () => {
    /** 挤行形态：全部选项一行一个塞进同一 @@P opt（20260905 概率篇真机
     *  踩坑——渲染只给首行编字母，落库即「只剩正确选项」）。 */
    function packedDraft(type: string, packed: string, ans: string): DraftUnit {
        return parseDrafts(
            [
                "@@Q type=" + type,
                "@@P stem",
                "题干……",
                "@@P opt",
                packed,
                "@@P ans",
                ans,
                "@@P sol",
                "解析",
                "@@END",
            ].join("\n")
        )[0];
    }
    it("单部件多行拆回独立选项，原答案字母口径不可信被重写", () => {
        const d = packedDraft("single", "360种\n240种\n120种\n60种", "C");
        shuffleDraftOptions(d);
        const opts = textsOf(d, "option-0");
        expect(opts).toHaveLength(4);
        expect([...opts].sort()).toEqual(["120种", "240种", "360种", "60种"].sort());
        const ans = textsOf(d, "answer")[0];
        expect(ans).toMatch(/^[A-D]$/);
        expect(opts[LETTERS.indexOf(ans)]).toBe("360种"); // 首行=正确项跟着答案字母走
    });
    it("位置敏感挤行：拆行但保序，答案 A 指向首行（正确项）", () => {
        const d = packedDraft("single", "正确项\n干扰项\n以上都对", "B");
        shuffleDraftOptions(d);
        expect(textsOf(d, "option-0")).toEqual(["正确项", "干扰项", "以上都对"]);
        expect(textsOf(d, "answer")[0]).toBe("A");
    });
    it("multiple 挤行不拆：正确集合规模不可推导，保持原样待体检报告", () => {
        const d = packedDraft("multiple", "甲\n乙\n丙\n丁", "AB");
        const before = d.parts.map((p) => `${p.name}:${p.text}`);
        shuffleDraftOptions(d);
        expect(d.parts.map((p) => `${p.name}:${p.text}`)).toEqual(before);
    });
});

describe("shuffleDraftOptions · 解析字母同步改写（Issue #123）", () => {
    it("解析里的裸字母词符按同一映射改写（正解指向正确答案）", () => {
        const d = parseDrafts(
            [
                "@@Q type=single",
                "@@P stem",
                "下列说法正确的是？",
                "@@P opt",
                "甲方法",
                "@@P opt",
                "乙方法",
                "@@P opt",
                "丙方法",
                "@@P ans",
                "A",
                "@@P sol",
                "A 正确，B 与 C 都是干扰说法。",
                "@@END",
            ].join("\n")
        )[0];
        shuffleDraftOptions(d);
        const ans = textsOf(d, "answer")[0];
        const sol = textsOf(d, "solution")[0];
        // 解析的正解字母必须与答案同步；另两个字母落在剩余选项上
        const m = /^([A-C]) 正确，([A-C]) 与 ([A-C]) 都是干扰说法。$/.exec(sol);
        expect(m?.[1]).toBe(ans);
        expect([m?.[2], m?.[3]].sort()).toEqual(["A", "B", "C"].filter((x) => x !== ans).sort());
    });

    it("数学区间/行内代码里的字母不是选项字母，绝不动", () => {
        const d = parseDrafts(
            [
                "@@Q type=single",
                "@@P stem",
                "题",
                "@@P opt",
                "甲",
                "@@P opt",
                "乙",
                "@@P opt",
                "丙",
                "@@P ans",
                "A",
                "@@P sol",
                "设 $A$ 为矩阵，`B` 是代码，故 A 正确。",
                "@@END",
            ].join("\n")
        )[0];
        shuffleDraftOptions(d);
        const ans = textsOf(d, "answer")[0];
        const sol = textsOf(d, "solution")[0];
        expect(sol).toContain("$A$");
        expect(sol).toContain("`B`");
        expect(sol).toContain(`${ans} 正确`);
    });

    it("英文词内/所有格后的字母不当作选项字母引用", () => {
        const d = parseDrafts(
            [
                "@@Q type=single",
                "@@P stem",
                "题",
                "@@P opt",
                "甲",
                "@@P opt",
                "乙",
                "@@P opt",
                "丙",
                "@@P ans",
                "A",
                "@@P sol",
                "students' A 与 BAD 里的字母不动，A 正确。",
                "@@END",
            ].join("\n")
        )[0];
        shuffleDraftOptions(d);
        const sol = textsOf(d, "solution")[0];
        expect(sol).toContain("students' A");
        expect(sol).toContain("BAD");
        expect(sol).toContain(`${textsOf(d, "answer")[0]} 正确`);
    });

    it("位置敏感措辞组跳过洗牌 → 解析原样（无失配，零改写）", () => {
        const d = parseDrafts(
            [
                "@@Q type=single",
                "@@P stem",
                "题",
                "@@P opt",
                "甲",
                "@@P opt",
                "乙",
                "@@P opt",
                "以上都对",
                "@@P ans",
                "C",
                "@@P sol",
                "C 正确。",
                "@@END",
            ].join("\n")
        )[0];
        const before = d.parts.map((p) => `${p.name}:${p.text}`);
        shuffleDraftOptions(d);
        expect(d.parts.map((p) => `${p.name}:${p.text}`)).toEqual(before);
    });

    it("steps：每步解析的字母按该步自己的映射改写", () => {
        const d = parseDrafts(
            [
                "@@Q type=steps steps=method",
                "@@P stem",
                "计算题",
                "@@P step",
                "第 1 步",
                "@@P step-opt",
                "洛必达",
                "@@P step-opt",
                "等价无穷小",
                "@@P step-opt",
                "泰勒展开",
                "@@P step-ans",
                "AB",
                "@@P sol",
                "A 与 B 都可行，C 不可行。",
                "@@END",
            ].join("\n")
        )[0];
        shuffleDraftOptions(d);
        const ans = textsOf(d, "step-1-answer")[0];
        const sol = textsOf(d, "solution")[0] ?? "";
        const m = /^([A-C]) 与 ([A-C]) 都可行，([A-C]) 不可行。$/.exec(sol);
        expect(m).not.toBeNull();
        expect([m?.[1], m?.[2]].sort()).toEqual([...ans].sort());
        expect(m?.[3]).toBe(["A", "B", "C"].filter((x) => !ans.includes(x))[0]);
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
