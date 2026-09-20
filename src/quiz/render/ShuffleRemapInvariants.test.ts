import { describe, expect, it } from "vitest";
import { LETTERS, optionDisplayMd, QuestionType, type WenguQuestion } from "../../types";
import { shuffleForDisplay, shuffleListForDisplay } from "./CardDisplayShuffle";

/**
 * Issue #176 **收窄后的展示层口径锁**（20260919 用户拍板：不治存量）。
 *
 * 展示层洗牌**只重映射 `answer` 字母**，解析/题干文本在渲染路径上**逐字节
 * 不动**——不对用户文本现猜字母（判据对 `维生素A`/`A4纸`/引文体字母的误伤面
 * 不可接受，且每洗一次牌就在用户眼前跑一遍）。存量带裸字母的旧记录由用户
 * **重新转换**消化：重转产物经落库链 `normalizeDraftOptionRefs` 即成无字母
 * 引文（那侧的验收在 `convert/service/test/OptionRefNormalize.chain.test.ts`）。
 *
 * `9d998f1` 曾在此钉「洗牌同步改写解析字母引用」的一整套不变量与对抗矩阵
 * （判据对抗、恒等排列映射参照、引头/词符次序穷举…），随特性**整体撤除**——
 * 那些断言锁的是一条已经不存在的行为。这里只留两条薄锁：
 *   1. **文本层**：任意种子 N 组洗牌下，解析与题干逐字节不动；
 *   2. **字母层**：`answer` 重映射与卡面选项序自洽（判分/描色仍准）。
 *
 * 既有 `CardDisplayShuffle.test.ts`（#131 回归锁）与 `ShuffleRemap.test.ts`
 * （含落库链验收）原样保留、保持全绿。
 */

/** 洗后选项的渲染序文本（本文件的题面都不含挤行部件，一行一项）。 */
const cardsOf = (q: WenguQuestion): string[] => (q.optionMd ?? []).map((t) => optionDisplayMd(t));

/** 由「洗前选项顺序」与「洗后题面」反推 `toIdx`（原第 i 位 → 新第 j 位）。 */
const toIdxOf = (before: string[], after: WenguQuestion): Map<number, number> => {
    const m = new Map<number, number>();
    (after.optionMd ?? []).forEach((t, j) => m.set(before.indexOf(t), j));
    return m;
};

const mk = (sol: string, opts: string[], extra: Partial<WenguQuestion> = {}): WenguQuestion => ({
    id: "q-inv",
    type: QuestionType.Single,
    attempts: 0,
    wrongCount: 0,
    optionMd: opts,
    answer: "A",
    solutionMd: sol,
    ...extra,
});

/** 解析模板：CJK 夹写引用、英文正文词、所有格、CJK 融合词、型号、保护区、
 *  引文体——**展示层哪一种都不许碰**（这正是收窄要保住的边界）。 */
const TEMPLATES: string[] = [
    "「A. 甲」正确，A 错误。",
    "「B 乙」正确，「C. 丙」错误。",
    "A 正确，B 错误。（A）甲 正确。",
    "选项 C 错误，选项 A 正确。",
    "「D. 丁」错误，C 正确。",
    "Plan A failed，Students' A is graded。",
    "维生素A 缺乏症、A4纸 规格、B2B 业务。",
    "$x_A$ 与 $A^{2}$ 无关，`A` 也不相关，$$A$$ 与 \\(A\\) 与 \\[A\\] 同。",
    "「A proposal to establish a new framework…」正确。",
    "「A 与 B 相互独立」 正确。",
];

const OPTS4 = ["甲", "乙", "丙", "丁"];

describe("锁①：解析/题干文本逐字节不动（1200 组种子化洗牌）", () => {
    it("single：任意种子下 `solutionMd` 与入参逐字相同", () => {
        let checked = 0;
        const orders = new Set<string>();
        for (let k = 0; k < 1200; k++) {
            const sol = TEMPLATES[k % TEMPLATES.length]!;
            const before = [...OPTS4];
            const q = mk(sol, before);
            const x = shuffleListForDisplay([q], { scope: `inv-${k}` })[0]!;
            expect(x.solutionMd).toBe(sol);
            expect(x.solutionMd).toBe(q.solutionMd);
            orders.add((x.optionMd ?? []).join("|"));
            checked += 1;
        }
        expect(checked).toBe(1200);
        expect(orders.size).toBeGreaterThan(1); // 确实换了序（消剧透仍成立）
    });

    it("single：题干 `stemMd` 同样逐字不动（含实体名字母）", () => {
        for (let k = 0; k < 240; k++) {
            const stem = "关于 A、B 两点的说法，正确的是（ ）";
            const q = mk(TEMPLATES[k % TEMPLATES.length]!, [...OPTS4], { stemMd: stem });
            const x = shuffleListForDisplay([q], { scope: `stem-${k}` })[0]!;
            expect(x.stemMd).toBe(stem);
        }
    });

    it("显式随机源入口（`shuffleForDisplay`）同样不动文本", () => {
        for (const rand of [() => 0, () => 0.9, () => 0.5, () => 0.37]) {
            for (const sol of TEMPLATES) {
                expect(shuffleForDisplay(mk(sol, [...OPTS4]), rand).solutionMd).toBe(sol);
            }
        }
    });

    it("steps：各步独立洗，题级解析逐字不动（各步映射不同，指代无从判定）", () => {
        const sol = "第一步 A. 甲 正确，第二步 B. 丁 正确。";
        const q: WenguQuestion = {
            id: "s",
            type: QuestionType.Steps,
            attempts: 0,
            wrongCount: 0,
            answer: "A",
            solutionMd: sol,
            steps: [
                { kind: "method", stemMd: "第一步", optionMd: ["甲", "乙"], answer: "A" },
                { kind: "result", stemMd: "第二步", optionMd: ["丙", "丁"], answer: "B" },
            ],
        };
        for (const scope of ["s1", "s2", "s3", "s4", "s5"]) {
            const x = shuffleListForDisplay([q], { scope })[0]!;
            expect(x.solutionMd).toBe(sol);
            expect(x.steps!.map((s) => s.stemMd)).toEqual(["第一步", "第二步"]);
            expect(x.steps!.some((s) => "solutionMd" in (s as object))).toBe(false); // WenguStep 无解析
        }
        // 步内答案与选项同源洗过（自洽）
        const z = shuffleForDisplay(q, () => 0);
        expect(cardsOf({ ...z, optionMd: z.steps![0]!.optionMd })[LETTERS.indexOf(z.steps![0]!.answer!)]).toBe("甲");
        expect(cardsOf({ ...z, optionMd: z.steps![1]!.optionMd })[LETTERS.indexOf(z.steps![1]!.answer!)]).toBe("丁");
    });

    it("不可洗的题（选项不足 / 位置敏感 / cloze/match）：原对象引用相等", () => {
        const one = mk("A 正确。", ["甲"], {});
        expect(shuffleForDisplay(one, () => 0)).toBe(one);
        const sensitive = mk("A 正确。", ["甲", "以上都对"], {});
        expect(shuffleForDisplay(sensitive, () => 0)).toBe(sensitive);
        for (const t of [QuestionType.Cloze, QuestionType.Match]) {
            const q = mk("A 正确。", ["甲", "乙"], { type: t });
            expect(shuffleForDisplay(q, () => 0)).toBe(q);
        }
    });
});

describe("锁②：`answer` 重映射与卡面选项序自洽（审阅用，与 #131 回归锁同源）", () => {
    it("single：答案字母恒指原正确项；选项集合不变、顺序确实变过", () => {
        for (let k = 0; k < 240; k++) {
            const before = [...OPTS4];
            const x = shuffleListForDisplay([mk("A 正确。", before, { answer: "B" })], { scope: `ans-${k}` })[0]!;
            expect(cardsOf(x)[LETTERS.indexOf(x.answer!)]).toBe("乙"); // 原始正确答案的文本
            expect([...(x.optionMd ?? [])].sort()).toEqual([...before].sort()); // 集合不变
            expect(toIdxOf(before, x).get(1)).toBe(LETTERS.indexOf(x.answer!)); // 同一份 order 映射
        }
    });

    it("multiple：正确集合的文本集合不变、答案串恒升序", () => {
        for (let k = 0; k < 240; k++) {
            const q = mk("A 正确。", [...OPTS4], { type: QuestionType.Multiple, answer: "AD" });
            const x = shuffleListForDisplay([q], { scope: `multi-${k}` })[0]!;
            const cards = cardsOf(x);
            expect(
                (x.answer ?? "")
                    .split("")
                    .map((ch) => cards[LETTERS.indexOf(ch)])
                    .sort()
            ).toEqual(["丁", "甲"].sort());
            expect(x.answer).toBe([...(x.answer ?? "")].sort().join(""));
        }
    });
});

/** 源级口径锁：展示层**不得**再引入「猜字母」的改写路径（防特性悄悄回来）。 */
describe("收窄口径的源级锁", () => {
    const SRC = import.meta.glob("./CardDisplayShuffle.ts", {
        query: "?raw",
        import: "default",
        eager: true,
    }) as Record<string, string>;
    const DRAFT = import.meta.glob("../../convert/service/draft/LetterRefs.ts", {
        query: "?raw",
        import: "default",
        eager: true,
    }) as Record<string, string>;

    it("CardDisplayShuffle 不引 LetterRefs / OptGroups，也不碰 solutionMd/stemMd", () => {
        const src = SRC["./CardDisplayShuffle.ts"]!;
        expect(src).not.toContain("LetterRefs");
        expect(src).not.toContain("OptGroups");
        // 注：文件头注释里会出现 `solutionMd`/`stemMd` 字样（说明「不动」），
        // 故这里只锁**行为面**——导入、改写器名、自持字母正则。

        expect(src).not.toMatch(/\[A-H\]/); // 自持字母正则 = 又一套口径
        expect(src).not.toContain("rewriteLetters");
        expect(src).not.toContain("remapQuotedHead");
    });

    it("LetterRefs 只剩落库判据（改写器已删净）", () => {
        const src = DRAFT["../../convert/service/draft/LetterRefs.ts"]!;
        expect(src).not.toContain("export function rewriteLetters");
        expect(src).not.toContain("export function letterMapper");
    });
});
