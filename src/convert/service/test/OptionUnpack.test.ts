import { describe, expect, it } from "vitest";
import { unpackPackedOptions } from "../draft/OptionUnpack";
import { parseDrafts, renderUnit } from "../draft/QuestionDraft";

/**
 * 挤行选项拆行（Issue #131 从 OptionShuffle.unpackPackedSingle 接出）：
 * 拆行是**格式规范**（AI 把多选项塞进一个 @@P opt 时渲染只给首行编字母、
 * 其余成续行 ⇒ 落库即「只剩正确选项」），与选项顺序无关。死形态协议下
 * **不碰答案字母**（字母指向原文位置，改答案就是凭空判错）。
 */

const draftOf = (sol: string, ans: string, optTexts: string[], type = "single") => {
    const lines = [`@@Q type=${type}`, "@@P stem", "下列说法正确的是（）"];
    for (const t of optTexts) lines.push("@@P opt", t);
    lines.push("@@P ans", ans, "@@P sol", sol, "@@END");
    return parseDrafts(lines.join("\n"))[0];
};

describe("unpackPackedOptions", () => {
    it("挤行选项拆成多个同名部件；答案字母逐字不动（keep 序前提）", () => {
        const d = draftOf("解析", "C", ["甲\n乙\n丙\xa0", "丁"]);
        const out = unpackPackedOptions(d);
        const opts = out.parts.filter((p) => p.name === "option-0").map((p) => p.text);
        expect(opts).toEqual(["甲", "乙", "丙", "丁"]);
        expect(out.parts.find((p) => p.name === "answer")?.text).toBe("C"); // 不动
    });

    it("渲染后字母完整（不再「只剩首行」）", () => {
        const kd = renderUnit(unpackPackedOptions(draftOf("解析", "B", ["甲\n乙\n丙"])));
        expect(kd).toContain("- A. 甲");
        expect(kd).toContain("- B. 乙");
        expect(kd).toContain("- C. 丙");
    });

    it("无挤行：返回原对象（引用相等，零开销）", () => {
        const d = draftOf("解析", "A", ["甲", "乙"]);
        expect(unpackPackedOptions(d)).toBe(d);
    });

    it("非选项部件里的多行照旧（题干/解析不拆）", () => {
        const d = parseDrafts(
            [
                "@@Q type=single",
                "@@P stem",
                "题干第一行\n题干第二行",
                "@@P opt",
                "甲",
                "@@P ans",
                "A",
                "@@P sol",
                "解析第一行\n解析第二行",
                "@@END",
            ].join("\n")
        )[0];
        expect(unpackPackedOptions(d)).toBe(d);
    });

    it("step-k 选项挤行同样拆（多步题每步一组）", () => {
        const d = parseDrafts(
            [
                "@@Q type=steps steps=result",
                "@@P stem",
                "大题",
                "@@P step",
                "第一步",
                "@@P step-opt",
                "甲\n乙",
                "@@P step-ans",
                "B",
                "@@END",
            ].join("\n")
        )[0];
        const out = unpackPackedOptions(d);
        expect(out.parts.filter((p) => p.name === "step-1-option-0").map((p) => p.text)).toEqual(["甲", "乙"]);
        expect(out.parts.find((p) => p.name === "step-1-answer")?.text).toBe("B");
    });

    it("材料块跳过", () => {
        const d = parseDrafts(["@@Q material=1", "@@P body", "第一行\n第二行", "@@END"].join("\n"))[0];
        expect(unpackPackedOptions(d)).toBe(d);
    });
});
