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
 * Issue #176 验收：**展示层洗牌必须同步改写解析里的选项字母引用**。
 *
 * 真机报障（20260918）：卡面 B 位显示「时空是一切运动的观念载体」，解析
 * 却写「B. 时空与物质运动不可分割」正确——洗牌只重映射 `answer`、解析
 * 里的字母仍指库内原序位置，换序后全体失配（工作区 bank 实查 841 道
 * single/multiple 里 835 道（99.3%）解析带字母引用）。
 *
 * 本文件的三条锁：
 *   1. **真实 kramdown 样本自洽锁**（题源 gen-mu3s7wm9-vpg6jm，工作区
 *      bank 原文）：洗牌后解析里每个字母引用指向的选项文本 == 卡面该字母
 *      位的选项文本；换 scope 重洗仍自洽；
 *   2. 词符口径：数学/代码区不误伤、超范围字母（E/F）不动、英文正文词
 *      （`Plan A`）不动、所有格（`students' A`）不动；
 *   3. 长引用前缀（`「A proposal…」`）：前缀随映射搬、引用正文逐字不动。
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

/**
 * 自洽锁（本单主修的唯一判据）：解析里每个「`X. <选项文本>`」引用拆出的
 * **文本**，必须与**卡面 X 位**的选项文本逐字一致——洗牌把选项换位后，
 * 解析里的字母必须跟着换，否则就是真机那个「卡面 B 位显示甲、解析说
 * B 是乙」的错误指代。
 *
 * 只判「文本确为某个选项」的引用（长选项截断形态、非引用大写字母不掺和）。
 */
const assertSelfConsistent = (x: WenguQuestion): void => {
    const cards = (x.optionMd ?? []).map((t) => optionDisplayMd(normalizeOptionLabels(t)));
    const textAt = (letter: string): string => cards[LETTERS.indexOf(letter)] ?? "";
    let checked = 0;
    for (const m of (x.solutionMd ?? "").matchAll(/(?<![A-Za-z])([A-H])[.、]\s*([^，。、「」]+)/g)) {
        const letter = m[1]!;
        const claim = normalizeOptionLabels(m[2]!.trim().replace(/[.。]$/, ""));
        const hit = cards.find((c) => c === claim);
        if (!hit) continue; // 非选项引用 / 截断形态：不掺和
        checked += 1;
        if (claim !== textAt(letter))
            console.log("MISMATCH", JSON.stringify({ letter, claim, at: textAt(letter), cards, sol: x.solutionMd }));
        expect({ letter, claim }).toEqual({ letter, claim: textAt(letter) });
    }
    expect(checked).toBeGreaterThan(0); // 真机样本必须至少有一条可判引用
};

/** 真机那道题洗后的**不变量**：答案字母指向的文本恒为「不可分割」。 */
const assertAnswerStable = (x: WenguQuestion): void => {
    const at = LETTERS.indexOf((x.answer ?? "").toUpperCase());
    expect(optionDisplayMd(normalizeOptionLabels((x.optionMd ?? [])[at] ?? ""))).toBe("时空与物质运动不可分割");
};

describe("真实 kramdown 样本自洽锁（gen-mu3s7wm9-vpg6jm）", () => {
    it("库内自洽（洗牌前）：字母、文本、答案三方吻合", () => {
        const q = realQuestion();
        expect(q.answer).toBe("B");
        expect(q.solutionMd).toContain("B. 时空与物质运动不可分割");
        assertAnswerStable(q);
        assertSelfConsistent(q);
    });

    it("换 scope 重洗：解析引用与卡面选项位**始终自洽**（本单主修）", () => {
        const q = realQuestion();
        const orders = new Set<string>();
        for (const scope of ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]) {
            const x = shuffleListForDisplay([q], { scope })[0]!;
            assertAnswerStable(x); // 答案字母指向的文本没变
            assertSelfConsistent(x); // 解析引用与卡面同字母位一致
            orders.add((x.optionMd ?? []).join("|"));
        }
        expect(orders.size).toBeGreaterThan(1); // 确实换了序（消剧透仍成立）
    });

    it("解析里的字母引用确实被改写（洗序变了 ⇒ 文本必须跟着换位）", () => {
        const q = realQuestion();
        const seen = new Set<string>();
        for (const scope of ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]) {
            const x = shuffleListForDisplay([q], { scope })[0]!;
            seen.add(x.solutionMd ?? "");
        }
        expect(seen.size).toBeGreaterThan(1); // 解析文本随洗牌变（不是原样抄库）
        // ⚠️ 反向锁：解析里**不再**出现「B. 不可分割」以外的「X. 文本」错配
        for (const scope of ["s1", "s2", "s3"]) {
            const x = shuffleListForDisplay([q], { scope })[0]!;
            const cards = (x.optionMd ?? []).map((t) => optionDisplayMd(normalizeOptionLabels(t)));
            for (const m of (x.solutionMd ?? "").matchAll(/(?<![A-Za-z])([A-H])(?!=[A-Za-z])\.\s*([^，。」]+)/g)) {
                if (m[2] && !cards.some((c) => c.startsWith(m[2]!.trim()))) {
                    throw new Error(`解析引用失配：${m[0]}`);
                }
            }
        }
    });

    it("双字母「A. A. 时空…」剥净（伴生畸形①，展示侧兜底）", () => {
        const q = realQuestion();
        expect(optionDisplayMd(normalizeOptionLabels(q.optionMd![0]!))).toBe("时空是一切运动的观念载体");
    });
});

/** 词符口径（复用 #123 成套件）：不该动的一个都不许动。 */
describe("解析字母重映射的词符口径", () => {
    const base = (sol: string): WenguQuestion => ({
        id: "q1",
        type: QuestionType.Single,
        attempts: 0,
        wrongCount: 0,
        optionMd: ["甲", "乙", "丙"],
        answer: "A",
        solutionMd: sol,
    });

    it("数学 `^A$` 与代码区不误伤", () => {
        const x = shuffleForDisplay(base("$x_A$ 与 $A^{2}$ 无关，`A` 也不相关。甲正确。"), () => 0.9);
        expect(x.solutionMd).toContain("$x_A$");
        expect(x.solutionMd).toContain("$A^{2}$");
        expect(x.solutionMd).toContain("`A`");
    });

    it("超范围字母（该组 3 项而解析写 E/F）不动", () => {
        const x = shuffleForDisplay(base("E 错误，F 也不对。"), () => 0.9);
        expect(x.solutionMd).toBe("E 错误，F 也不对。");
    });

    it("英文正文词 `Plan A` 与所有格 `students' A` 不动", () => {
        const en = "Plan A works well. Students' A is graded.";
        const x = shuffleForDisplay(base(en), () => 0.9);
        expect(x.solutionMd).toBe(en);
    });

    it("中文夹写的独立字母（「选项 A 正确」）会跟着重映射", () => {
        // 洗序把原 A 项挪到 B 位 ⇒ 解析里的 A 必须改成 B（不然指到别的项）
        const x = shuffleForDisplay(base("选项 A 正确，选项 B 错误。"), () => 0.9);
        expect(x.answer).toBe("B");
        expect(x.solutionMd).toBe("选项 B 正确，选项 A 错误。");
    });

    it("长引用前缀（`「A proposal…」`）：前缀随映射、引用正文逐字不动", () => {
        const opts = [
            "A proposal to establish a new framework for international cooperation",
            "The author argues that technology has reshaped the way we communicate",
            "Governments should prioritize environmental protection over growth",
        ];
        const q: WenguQuestion = {
            id: "q2",
            type: QuestionType.Single,
            attempts: 0,
            wrongCount: 0,
            optionMd: opts,
            answer: "A",
            solutionMd: "「A proposal to establish a new …」正确。",
        };
        for (const scope of ["s1", "s2", "s3", "s4"]) {
            const x = shuffleListForDisplay([q], { scope })[0]!;
            const head = /^「([A-H])/.exec(x.solutionMd ?? "")?.[1];
            expect(head).toBe((x.answer ?? "").toUpperCase());
            // 引用首词逐字不动（前缀之外的部分一字未改）
            expect(x.solutionMd).toContain("proposal to establish a new …」正确。");
            expect((x.optionMd ?? [])[LETTERS.indexOf(head!)]).toBe(opts[0]);
        }
    });
});

/** 源头堵新流量：落库三链共用的**裸字母 / 「字母+全文」规范化**。 */
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

/** 移动端：同走 `shuffleListForDisplay`（会话恢复路径）——补一条口径锁。 */
describe("移动端同源（MobileRound 走同一函数）", () => {
    it("恢复路径按会话 id 定种子：同会话两次一致、解析引用同源自洽", () => {
        const q = realQuestion();
        const a = shuffleListForDisplay([q], { scope: "m-s1" })[0]!;
        const b = shuffleListForDisplay([q], { scope: "m-s1" })[0]!;
        expect(b.optionMd).toEqual(a.optionMd);
        expect(b.solutionMd).toBe(a.solutionMd);
        assertAnswerStable(a);
        assertSelfConsistent(a);
    });

    it("换轮换序，仍自洽（移动端与桌面零分叉）", () => {
        const q = realQuestion();
        const s1 = shuffleListForDisplay([q], { scope: "m-s1" })[0]!;
        const s2 = shuffleListForDisplay([q], { scope: "m-s2" })[0]!;
        assertSelfConsistent(s1);
        assertSelfConsistent(s2);
        expect(s1.optionMd).not.toEqual(s2.optionMd);
    });
});
