import { describe, expect, it } from "vitest";
import { QuestionType } from "../../types";
import type { WenguQuestion } from "../../types";
import { parseDrafts } from "../../convert/service/draft/QuestionDraft";
import { buildRegenPrompt } from "../../ai/prompts/gen";
import { protocolSpec } from "../../ai/prompts/protocol";
import { reseatAnswer } from "./RegenVerify";

/**
 * 重新生成答案核查（Issue #123，20260915 真机实录）：原题 ans=B
 * （运动是物质的根本属性），AI 按「正确项写最前」协议重排选项却照抄
 * 旧字母 B —— 核查后答案必须指向正确的那个选项文本。
 */

/** 用户实录原题视图：ans=B 指向「运动是物质的根本属性」。 */
const USER_Q: WenguQuestion = {
    id: "20260915120000-user0001",
    type: QuestionType.Single,
    attempts: 0,
    wrongCount: 0,
    answer: "B",
    optionMd: [
        "- A. 运动是物质的唯一特性",
        "- B. 运动是物质的根本属性",
        "- C. 运动是物质的一维性",
        "- D. 运动是物质的衡量尺度",
    ],
};

/** 用户实录回复：正确项已挪到最前，ans 仍是旧字母 B。 */
const USER_REPLY = [
    "@@Q type=single",
    "@@P stem",
    "下列关于运动的说法正确的是（）",
    "@@P opt",
    "运动是物质的根本属性",
    "@@P opt",
    "运动是物质的唯一特性",
    "@@P opt",
    "运动是物质的一维性",
    "@@P opt",
    "运动是物质的衡量尺度",
    "@@P ans",
    "B",
    "@@P sol",
    "B 正确，其余说法混淆了运动与物质其他属性。",
    "@@END",
].join("\n");

describe("reseatAnswer · 客观题正确项文本比对", () => {
    it("实录复现：正确项已挪到首位但 ans 仍是旧字母 B → 校正为 A", () => {
        const d = parseDrafts(USER_REPLY)[0];
        const v = reseatAnswer(d, USER_Q);
        expect(v).toEqual({ kind: "ok", answer: "A" });
        const ans = d.parts.find((p) => p.name === "answer")?.text;
        expect(ans).toBe("A");
        // 落盘答案指向「运动是物质的根本属性」
        const opts = d.parts.filter((p) => p.name === "option-0").map((p) => p.text);
        expect(opts["ABCD".indexOf(ans ?? "")]).toBe("运动是物质的根本属性");
    });

    it("原序输出（选项与字母沿用原题）→ 行为与现状一致，字母不动", () => {
        const d = parseDrafts(
            USER_REPLY.replace(
                "运动是物质的根本属性\n@@P opt\n运动是物质的唯一特性",
                "运动是物质的唯一特性\n@@P opt\n运动是物质的根本属性"
            )
        )[0];
        const v = reseatAnswer(d, USER_Q);
        expect(v).toEqual({ kind: "ok", answer: "B" });
        expect(d.parts.find((p) => p.name === "answer")?.text).toBe("B");
    });

    it("多选：正确项集合按新位置全部命中", () => {
        const q: WenguQuestion = {
            ...USER_Q,
            type: QuestionType.Multiple,
            answer: "AB",
            optionMd: ["- A. 甲", "- B. 乙", "- C. 丙", "- D. 丁"],
        };
        const d = parseDrafts(
            [
                "@@Q type=multiple",
                "@@P stem",
                "多选",
                "@@P opt",
                "丙",
                "@@P opt",
                "甲",
                "@@P opt",
                "丁",
                "@@P opt",
                "乙",
                "@@P ans",
                "AB",
                "@@P sol",
                "解析",
                "@@END",
            ].join("\n")
        )[0];
        expect(reseatAnswer(d, q)).toEqual({ kind: "ok", answer: "BD" });
    });

    it("文本失配且规模对不上 → mismatch（调用方走 AI 自检兜底）", () => {
        const reply = USER_REPLY.replace("运动是物质的根本属性\n@@P opt", "运动是物质的存在方式\n@@P opt");
        const d = parseDrafts(reply)[0];
        expect(reseatAnswer(d, USER_Q)).toEqual({ kind: "mismatch", reason: "letters-not-found" });
    });

    it("折行/标签/全角空白差异照旧命中（走 optionComparable 归一）", () => {
        const d = parseDrafts(USER_REPLY.replace("运动是物质的根本属性", "- A. 运动是物质的根本属性　"))[0];
        expect(reseatAnswer(d, USER_Q)).toEqual({ kind: "ok", answer: "A" });
    });

    it("原题无选项/答案非字母 → skip（无基准可校，维持现状）", () => {
        const d = parseDrafts(USER_REPLY)[0];
        expect(reseatAnswer(d, { ...USER_Q, optionMd: [] }).kind).toBe("skip");
        expect(reseatAnswer(d, { ...USER_Q, answer: "$e^2$" }).kind).toBe("skip");
    });

    it("判断题比 √/×：改了判不通过、没改放行", () => {
        const q: WenguQuestion = { ...USER_Q, type: QuestionType.Judge, answer: "√", optionMd: [] };
        const mk = (a: string) =>
            parseDrafts(["@@Q type=judge", "@@P stem", "判断", "@@P ans", a, "@@END"].join("\n"))[0];
        expect(reseatAnswer(mk("√"), q)).toEqual({ kind: "ok" });
        expect(reseatAnswer(mk("对"), q)).toEqual({ kind: "ok" }); // 同义形态
        expect(reseatAnswer(mk("×"), q)).toEqual({ kind: "mismatch", reason: "letters-not-found" });
    });

    it("答案部件缺失时校正结果补写进去", () => {
        const reply = USER_REPLY.replace("@@P ans\nB\n", "");
        const d = parseDrafts(reply)[0];
        expect(reseatAnswer(d, USER_Q)).toEqual({ kind: "ok", answer: "A" });
        expect(d.parts.find((p) => p.name === "answer")?.text).toBe("A");
    });
});

describe("reseatAnswer · keep 序下字母与选项内容自洽（Issue #214 随洗牌删除改锁）", () => {
    it("原序回复不改字母，答案仍指向原题正确项文本", () => {
        const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        // keep 序回复：选项顺序与字母同原题（ans=B 指向第 2 项=正确项）
        const reply = [
            "@@Q type=single",
            "@@P stem",
            "下列关于运动的说法正确的是（）",
            "@@P opt",
            "运动是物质的唯一特性",
            "@@P opt",
            "运动是物质的根本属性",
            "@@P opt",
            "运动是物质的一维性",
            "@@P opt",
            "运动是物质的衡量尺度",
            "@@P ans",
            "B",
            "@@P sol",
            "B 正确，A、C、D 都是混淆说法。",
            "@@END",
        ].join("\n");
        const d = parseDrafts(reply)[0];
        expect(reseatAnswer(d, USER_Q)).toEqual({ kind: "ok", answer: "B" }); // 原序 → 字母不动
        const ans = d.parts.find((p) => p.name === "answer")?.text ?? "";
        expect(d.parts.filter((p) => p.name === "option-0").map((p) => p.text)[LETTERS.indexOf(ans)]).toBe(
            "运动是物质的根本属性"
        );
        // 解析文本**原样**（Issue #176 收窄）：插件不再对用户文本猜字母。
        expect(d.parts.find((p) => p.name === "solution")?.text).toBe("B 正确，A、C、D 都是混淆说法。");
    });
});

describe("prompt：regen 走「选项沿用原题顺序与字母」变体", () => {
    const kd = '{{{row\n题干\n}}}\n{: custom-plugin-wengu-q="1"}';

    it("buildRegenPrompt 显式传 keep：带原序约定、不带「正确项写在最前」", () => {
        const p = buildRegenPrompt(kd, "", "", "", QuestionType.Single, "keep");
        expect(p).toContain("原题顺序与字母");
        expect(p).not.toContain("正确项写在最前");
    });

    it("默认（不带 order）：与改造前逐字节一致（转换/加练链不受影响）", () => {
        const noArg = buildRegenPrompt(kd, "", "", "", QuestionType.Single);
        const empty = buildRegenPrompt(kd, "", "", "", QuestionType.Single, "");
        expect(noArg).toBe(empty);
        expect(noArg).toContain("正确项写在最前");
        expect(noArg).toContain(protocolSpec([QuestionType.Single]));
    });

    it("protocolSpec 的 keep 变体只换 @@P opt 那一行，其余逐字不变", () => {
        const def = protocolSpec([QuestionType.Single]);
        const keep = protocolSpec([QuestionType.Single], { order: "keep" });
        expect(keep).not.toBe(def);
        // 剔除「按变体改动的那些行」：@@P opt 约定 + @@P sol 的 〔opt:X〕
        // 标记约定（Issue #131 随 order/bank 一并生效）——其余行必须逐字
        // 相同。
        const strip = (s: string): string =>
            s
                .split("\n")
                .filter(
                    (l) =>
                        !l.includes("正确项写在最前") &&
                        !l.includes("原题顺序与字母") &&
                        !l.includes("逐题判断") &&
                        !l.includes("〔opt:X〕")
                )
                .join("\n");
        expect(strip(keep)).toBe(strip(def));
    });
});
