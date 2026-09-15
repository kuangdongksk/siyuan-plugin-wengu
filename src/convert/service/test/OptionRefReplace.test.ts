import { describe, expect, it } from "vitest";
import { replaceDraftOptionRefs, replaceOptionRefs, replaceOptionRefsMap } from "../draft/OptionRefReplace";
import { parseDrafts, type DraftUnit } from "../draft/QuestionDraft";

/**
 * 解析选项引用标记（Issue #131 验收 2）：正常单选/多选连续标记、非法字母
 * 降级、无标记不动、数学环境内照常替换（标记即显式意图）、非解析部件
 * （材料正文）不动、英语域裸字母零改动。
 */

const OPTS = ["保证全党服从中央", "加强思想教育和理论武装", "坚持以人民为中心", "全面从严治党"];

/** 造一道单选题（解析文本由调用方给）。 */
function draftOf(sol: string, type = "single"): DraftUnit {
    const lines = [`@@Q type=${type}`, "@@P stem", "下列说法正确的是（）"];
    for (const o of OPTS) lines.push("@@P opt", o);
    lines.push("@@P ans", "B", "@@P sol", sol, "@@END");
    return parseDrafts(lines.join("\n"))[0];
}

const solOf = (d: DraftUnit): string => d.parts.find((p) => p.name === "solution")?.text ?? "";

describe("replaceOptionRefs · 纯函数", () => {
    it("单选：标记 → 该选项文本（全角引号包裹）", () => {
        expect(replaceOptionRefs("〔opt:B〕正确。", OPTS)).toBe("「加强思想教育和理论武装」正确。");
    });

    it("多选连续标记：自然连排、各自独立换", () => {
        expect(replaceOptionRefs("〔opt:A〕与〔opt:C〕均错误，〔opt:B〕〔opt:D〕正确。", OPTS)).toBe(
            "「保证全党服从中央」与「坚持以人民为中心」均错误，「加强思想教育和理论武装」「全面从严治党」正确。"
        );
    });

    it("非法字母（超出选项数 / 非 A-H）降级为裸字母，不丢信息", () => {
        expect(replaceOptionRefs("〔opt:E〕错。", OPTS)).toBe("E错。");
        expect(replaceOptionRefs("〔opt:Z〕错。", OPTS)).toBe("Z错。");
    });

    it("无标记的裸字母一律不动（英语域保护）", () => {
        const en = "Plan A works, option B is wrong, and vitamin A matters. Students' A is fine.";
        expect(replaceOptionRefs(en, OPTS)).toBe(en);
    });

    it("数学/代码环境内的标记照常替换（标记即显式意图）", () => {
        expect(replaceOptionRefs("$x_A$ 与 〔opt:A〕 不同", OPTS)).toBe("$x_A$ 与 「保证全党服从中央」 不同");
    });

    it("空文本/无标记：原样返回", () => {
        expect(replaceOptionRefs("", OPTS)).toBe("");
        expect(replaceOptionRefs("没有引用", OPTS)).toBe("没有引用");
    });
});

describe("replaceDraftOptionRefs · 草稿单元", () => {
    it("解析与题干都换；非法字母降级", () => {
        const src = draftOf("〔opt:B〕正确，〔opt:A〕错，〔opt:X〕不存在。");
        const d = replaceDraftOptionRefs(src);
        expect(solOf(d)).toBe("「加强思想教育和理论武装」正确，「保证全党服从中央」错，X不存在。");
    });

    it("纯函数：不改入参（原对象逐字不变）", () => {
        const src = draftOf("〔opt:B〕正确。");
        const d = replaceDraftOptionRefs(src);
        expect(d).not.toBe(src);
        expect(solOf(src)).toBe("〔opt:B〕正确。"); // 调用方手里的 draft 未被污染
    });

    it("无标记：返回原对象（引用相等，零开销）", () => {
        const src = draftOf("没有引用。");
        expect(replaceDraftOptionRefs(src)).toBe(src);
    });

    it("answer 部件不受影响（答案是字母，不是解析）", () => {
        const d = replaceDraftOptionRefs(draftOf("〔opt:B〕正确。"));
        expect(d.parts.find((p) => p.name === "answer")?.text).toBe("B");
    });

    it("无选项组（判断题）时零动作", () => {
        const src = parseDrafts(
            ["@@Q type=judge", "@@P stem", "判断", "@@P ans", "√", "@@P sol", "〔opt:A〕对", "@@END"].join("\n")
        )[0];
        expect(replaceDraftOptionRefs(src)).toBe(src);
        expect(solOf(src)).toBe("〔opt:A〕对"); // 无选项可指，标记原样留着（可见即知协议没被遵守）
    });

    it("材料块（material=1）跳过", () => {
        const src = parseDrafts(["@@Q material=1", "@@P body", "正文 〔opt:A〕", "@@END"].join("\n"))[0];
        expect(replaceDraftOptionRefs(src)).toBe(src);
    });
});

describe("replaceOptionRefsMap · 整批", () => {
    it("逐单元替换", () => {
        const [d] = replaceOptionRefsMap([draftOf("〔opt:D〕正确。")]);
        expect(solOf(d)).toBe("「全面从严治党」正确。");
    });

    it("幂等：替换后再跑一遍不产生二次变化（标记已无）", () => {
        const [once] = replaceOptionRefsMap([draftOf("〔opt:A〕错。")]);
        const [twice] = replaceOptionRefsMap([once]);
        expect(solOf(twice)).toBe(solOf(once));
        expect(twice).toBe(once); // 无标记 ⇒ 原对象
    });
});
