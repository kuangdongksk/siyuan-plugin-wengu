import { describe, expect, it } from "vitest";
import { LETTERS, normalizeOptionLabels, optionDisplayMd, QuestionType, type WenguQuestion } from "../../types";
import { shuffleForDisplay, shuffleListForDisplay } from "./CardDisplayShuffle";
import { parseQuestionKramdown } from "../../bank/data/BankParse";
import {
    normalizeBareRefs,
    normalizeDraftOptionRefs,
    replaceDraftOptionRefs,
} from "../../convert/service/draft/OptionRefReplace";
import { parseDrafts, type DraftUnit } from "../../convert/service/draft/QuestionDraft";

/**
 * Issue #176 **收窄后的落库链验收**（20260918 真机报障的收口，20260919 用户
 * 拍板：不治存量、不在展示层猜字母）。
 *
 * 真机背景：卡面 B 位显示「时空是一切运动的观念载体」，解析却写「B. 时空与
 * 物质运动不可分割」——洗牌只重映射 `answer`、解析字母仍指库内原序位置，
 * 换序后全体失配（工作区 bank 实查 841 道里 835 道解析带字母引用）。
 *
 * **收窄后的解法**：插件不再在洗牌时现场猜字母（判据对 `维生素A`/`A4纸`/
 * 引文体字母的误伤面不可接受），改由**落库链**产出无字母引文：存量用户
 * 重新转换一次即消化，解析里根本没有字母，也就无所谓指代错位。
 *
 * 本文件锁两件事：
 *   1. **展示层只换序、不动文本**（真机样本 + 各形态解析一律逐字不动）；
 *   2. **落库规范化**（裸字母 / 「字母 + 全文」→ `「选项文本」`）三接线点共用，
 *      且吃掉的区间不被二次替换。
 * 展示层的答案字母自洽性由 `CardDisplayShuffle.test.ts` / 本文件末组锁住。
 */

/** 真机 kramdown（gen-mu3s7wm9-vpg6jm 那道题，工作区 bank 原文形态）：
 *  库内**自洽**——选项 A=观念载体 / B=不可分割 / C=绝对相对 / D=客观，
 *  answer=B，解析字母与文本三方吻合（误导只发生在**洗牌后**）。
 *  ⚠️ 顺带带出伴生畸形①：A 项文本是**双字母** `A. A. 时空…`（AI 自带
 *  一层 + 行协议层又叠一层）。 */
const REAL_KD = [
    "{{{col",
    "{{{row",
    "时空与物质运动的关系是（ ）",
    '{: custom-plugin-wengu-part="stem"}',
    "",
    "- A. A. 时空是一切运动的观念载体",
    '{: custom-plugin-wengu-part="option-0"}',
    "",
    "- B. 时空与物质运动不可分割",
    '{: custom-plugin-wengu-part="option-1"}',
    "",
    "- C. 时空是绝对与相对的统一",
    '{: custom-plugin-wengu-part="option-2"}',
    "",
    "- D. 物质运动是客观的",
    '{: custom-plugin-wengu-part="option-3"}',
    "",
    "> B",
    '{: custom-plugin-wengu-part="answer"}',
    "",
    "「B. 时空与物质运动不可分割」正确，「A. 时空是一切运动的观念载体」错误。",
    '{: custom-plugin-wengu-part="solution"}',
    "}}}",
    '{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single" custom-plugin-wengu-answer="B"}',
    "}}}",
].join("\n");

const realQuestion = (): WenguQuestion => {
    const q = parseQuestionKramdown(REAL_KD, "gen-mu3s7wm9-vpg6jm");
    if (!q) throw new Error("真实样本解析失败");
    return q;
};

/** 真机那道题洗后的**不变量**：答案字母指向的文本恒为「不可分割」。 */
const assertAnswerStable = (x: WenguQuestion): void => {
    const at = LETTERS.indexOf((x.answer ?? "").toUpperCase());
    expect(optionDisplayMd(normalizeOptionLabels((x.optionMd ?? [])[at] ?? ""))).toBe("时空与物质运动不可分割");
};

describe("真实 kramdown 样本（gen-mu3s7wm9-vpg6jm）", () => {
    it("库内自洽（洗牌前）：字母、文本、答案三方吻合", () => {
        const q = realQuestion();
        expect(q.answer).toBe("B");
        expect(q.solutionMd).toContain("B. 时空与物质运动不可分割");
        assertAnswerStable(q);
    });

    it("洗牌只换序：解析逐字不动、答案字母仍指原正确项（收窄后的行为锁）", () => {
        const q = realQuestion();
        const orders = new Set<string>();
        for (const scope of ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]) {
            const x = shuffleListForDisplay([q], { scope })[0]!;
            expect(x.solutionMd).toBe(q.solutionMd); // 逐字不动（不在展示层猜字母）
            expect(x.stemMd).toBe(q.stemMd);
            assertAnswerStable(x); // 答案字母指向的文本没变
            orders.add((x.optionMd ?? []).join("|"));
        }
        expect(orders.size).toBeGreaterThan(1); // 确实换了序（消剧透仍成立）
    });

    it("双字母「A. A. 时空…」剥净（伴生畸形①，展示侧兜底）", () => {
        const q = realQuestion();
        expect(optionDisplayMd(normalizeOptionLabels(q.optionMd![0]!))).toBe("时空是一切运动的观念载体");
    });
});

/** 收窄口径：展示层对**任何形态**的解析文本都不碰。 */
describe("展示层不改写解析（收窄后的边界锁）", () => {
    const base = (sol: string): WenguQuestion => ({
        id: "q1",
        type: QuestionType.Single,
        attempts: 0,
        wrongCount: 0,
        optionMd: ["甲", "乙", "丙"],
        answer: "A",
        solutionMd: sol,
    });

    const CASES: string[] = [
        "选项 A 正确，选项 B 错误。",
        "A 正确，B 错误。",
        "「A. 甲」正确，「C. 丙」错误。",
        "「A proposal to establish a new …」正确。",
        "$x_A$ 与 $A^{2}$ 无关，`A` 也不相关。",
        "Plan A works well. Students' A is graded.",
        "维生素A 缺乏症，A4纸 规格，B2B 业务。",
        "E 错误，F 也不对。",
    ];

    it("逐条：任意随机源下解析逐字不动", () => {
        for (const sol of CASES) {
            for (const rand of [() => 0, () => 0.9, () => 0.5]) {
                expect(shuffleForDisplay(base(sol), rand).solutionMd).toBe(sol);
            }
        }
    });

    it("题干（stemMd）不改写", () => {
        const stem = "关于 A、B 两点的说法，正确的是（ ）";
        const x = shuffleForDisplay(base("选项 A 正确。"), () => 0.9);
        expect(x.solutionMd).toBe("选项 A 正确。");
        const y = shuffleForDisplay({ ...base("A 正确。"), stemMd: stem }, () => 0.9);
        expect(y.stemMd).toBe(stem);
    });
});

/** 落库链：三接线点共用的**裸字母 / 「字母+全文」规范化**（本单正题）。 */
describe("源头规范化：裸字母与「字母+全文」引用（三接线点共用）", () => {
    const OPTS = ["维护封建统治", "加强思想教育", "以人民为中心", "全面从严治党"];

    it("裸字母 → 「选项文本」", () => {
        expect(normalizeBareRefs("A 正确，B 错误。", OPTS)).toBe("「维护封建统治」 正确，「加强思想教育」 错误。");
    });

    it("「字母 + 全文」→ 「文本」（标签、全文与尾部空白一并吃掉，不留叠影）", () => {
        expect(normalizeBareRefs("B. 加强思想教育 正确。", OPTS)).toBe("「加强思想教育」正确。");
        expect(normalizeBareRefs("（B）加强思想教育正确。", OPTS)).toBe("「加强思想教育」正确。");
        expect(normalizeBareRefs("（B）加强思想教育 正确。", OPTS)).toBe("「加强思想教育」正确。");
    });

    it("「字母 + 全文」吃掉的区间不得被后续命中二次替换（20260918 复核实缺陷）", () => {
        // 选项正文自带独立字母是常态（英文阅读题）：`A. A big plan…`。
        // `matchAll` 按**原文**位置迭代、不看上一处的游标 ⇒ 修复前会把正文里
        // 那个 A 当第二处引用再换一遍，输出重复叠影。
        expect(normalizeBareRefs("A. A big plan 正确。", ["A big plan", "另一项"])).toBe("「A big plan」正确。");
        expect(
            normalizeBareRefs("B. The author argues this 正确，A. A proposal is wrong 错误。", [
                "A proposal is wrong",
                "The author argues this",
            ])
        ).toBe("「The author argues this」正确，「A proposal is wrong」错误。");
        // 不因跳过而漏吃：`A. 甲 正确。B 错误。` 两处都该换
        expect(normalizeBareRefs("A. 甲 正确。B 错误。", ["甲", "另一项"])).toBe("「甲」正确。「另一项」 错误。");
    });

    it("`Plan A` 的多格空白排版也排除（WORD_BEFORE 修复）", () => {
        const en = "Plan  A works (double space).";
        expect(normalizeBareRefs(en, ["甲", "乙"])).toBe(en);
    });

    it("无凭据（超范围字母 / 无选项组）一律原样", () => {
        expect(normalizeBareRefs("E 不存在。", OPTS)).toBe("E 不存在。");
        expect(normalizeBareRefs("A 正确。", [])).toBe("A 正确。");
    });

    it("数学/代码区、英文正文词、所有格不动", () => {
        const en = "$x_A$ 与 `A` 无关；Plan A works. Students' A is graded.";
        expect(normalizeBareRefs(en, OPTS)).toBe(en);
    });

    it("已带标记/已是「文本」形态的引用不再动（幂等）", () => {
        const once = normalizeBareRefs("「维护封建统治」正确。", OPTS);
        expect(once).toBe("「维护封建统治」正确。");
        expect(normalizeBareRefs(once, OPTS)).toBe(once);
    });

    it("草稿单元：解析与题干同链规范化；材料块跳过（纯函数）", () => {
        const src: DraftUnit = {
            material: false,
            attrs: { type: "single" },
            parts: [
                { name: "stem", text: "关于 A 说法正确的是（）" },
                ...OPTS.map((t) => ({ name: "option-0", text: t })),
                { name: "answer", text: "B" },
                { name: "solution", text: "A. 维护封建统治 错误，B 正确。" },
            ],
        };
        const out = normalizeDraftOptionRefs(src);
        const sol = (d: DraftUnit): string => d.parts.find((p) => p.name === "solution")?.text ?? "";
        expect(sol(out)).toBe("「维护封建统治」错误，「加强思想教育」 正确。");
        // 裸字母形态不吞前导空白（只吞「字母 + 全文」形态的）——题干这里
        // 保留一格，读起来更清楚；口径与「标点不归引用」一致。
        expect(out.parts.find((p) => p.name === "stem")!.text).toBe("关于 「维护封建统治」 说法正确的是（）");
        expect(sol(src)).toBe("A. 维护封建统治 错误，B 正确。"); // 入参未被污染
        expect(src.parts.find((p) => p.name === "stem")!.text).toBe("关于 A 说法正确的是（）");
        const mat: DraftUnit = { material: true, attrs: {}, parts: [{ name: "body", text: "A 正确" }] };
        expect(normalizeDraftOptionRefs(mat)).toBe(mat);
    });

    it("与标记替换同链：先换标记、再规范化裸字母（落库最后一跳）", () => {
        const d = parseDrafts(
            [
                "@@Q type=single",
                "@@P stem",
                "题干",
                ...OPTS.flatMap((o) => ["@@P opt", o]),
                "@@P ans",
                "B",
                "@@P sol",
                "〔opt:B〕正确，A 错误。",
                "@@END",
            ].join("\n")
        )[0]!;
        const fixed = normalizeDraftOptionRefs(replaceDraftOptionRefs(d));
        expect(fixed.parts.find((p) => p.name === "solution")?.text).toBe(
            "「加强思想教育」正确，「维护封建统治」 错误。"
        );
    });
});

/** 移动端：同走 `shuffleListForDisplay`（会话恢复路径）——只换序、不动文本。 */
describe("移动端同源（MobileRound 走同一函数）", () => {
    it("恢复路径按会话 id 定种子：同会话两次一致、解析逐字不动", () => {
        const q = realQuestion();
        const a = shuffleListForDisplay([q], { scope: "m-s1" })[0]!;
        const b = shuffleListForDisplay([q], { scope: "m-s1" })[0]!;
        expect(b.optionMd).toEqual(a.optionMd);
        expect(b.solutionMd).toBe(q.solutionMd);
        assertAnswerStable(a);
    });

    it("换轮换序，答案仍指同一项（移动端与桌面零分叉）", () => {
        const q = realQuestion();
        const s1 = shuffleListForDisplay([q], { scope: "m-s1" })[0]!;
        const s2 = shuffleListForDisplay([q], { scope: "m-s2" })[0]!;
        assertAnswerStable(s1);
        assertAnswerStable(s2);
        expect(s1.solutionMd).toBe(s2.solutionMd); // 文本不随轮次变
        expect(s1.optionMd).not.toEqual(s2.optionMd);
    });
});
