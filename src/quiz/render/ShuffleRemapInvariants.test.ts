import { describe, expect, it } from "vitest";
import { LETTERS, optionDisplayMd, QuestionType, type WenguQuestion } from "../../types";
import { shuffleForDisplay, shuffleListForDisplay } from "./CardDisplayShuffle";
import { remapQuotedHead } from "../../convert/service/draft/OptGroups";
import { letterMapper, rewriteLetters } from "../../convert/service/draft/LetterRefs";

/**
 * Issue #176 的**独立验收**（不碰业务代码，只钉口径）：展示层洗牌时解析里
 * 的「选项字母引用」必须与 `answer` **同源**重映射。
 *
 * 与既有 `ShuffleRemap.test.ts` 的分工：那份以**真机 kramdown 样本**为锚
 * （改坏了会被抓），本份做**不变量与对抗矩阵**——种子化随机排列下的逐组
 * 比对、单遍映射次序、保护区/所有格/英文正文词/超范围字母的边界。
 *
 * 判据分三层，互相独立：
 *   1. **单遍参照**（形式层）：解析输出 === 「把每个 A–H 字母按 `toIdx`
 *      映射一次」的参照实现；
 *   2. **语义层**：每条引用所指的选项文本洗牌前后一致（与 `answer` 同源）；
 *   3. **边界层**：不该动的一个都不许动。
 *
 * ⚠️ **红项已收口**（20260919）：原先 6 条以 `it.fails` 落的红项，
 * 探针转正为普通 `it` —— 它们从「已知缺陷的可执行证据」变成**回归锁**，
 * 断言一字未松。修法见 `LetterRefs`（R1/R2/R3 判据）、`OptGroups`
 * （R4 引头接保护区）、`OptionRefReplace`（R5 引号体不透明）。
 */

/** 洗后选项的渲染序文本（本文件的题面都不含挤行部件，一行一项）。 */
const cardsOf = (q: WenguQuestion): string[] => (q.optionMd ?? []).map((t) => optionDisplayMd(t));

/** 由「洗前选项顺序」与「洗后题面」反推 `toIdx`（原第 i 位 → 新第 j 位）。 */
const toIdxOf = (before: string[], after: WenguQuestion): Map<number, number> => {
    const m = new Map<number, number>();
    (after.optionMd ?? []).forEach((t, j) => m.set(before.indexOf(t), j));
    return m;
};

/** 单遍参照：把文本里**每个** A–H 字母按 `toIdx` 映射一次（引用前缀与
 *  独立词符同一遍、同一表），组外字母（`toIdx` 无键）原样。 */
const singlePass = (text: string, toIdx: Map<number, number>): string =>
    text.replace(/[A-H]/g, (ch) => {
        const j = toIdx.get(LETTERS.indexOf(ch));
        return j === undefined ? ch : LETTERS[j]!;
    });

/** 二次映射（反例：先改词符再改引用前缀会得到的形态）。 */
const doublePass = (text: string, toIdx: Map<number, number>): string => singlePass(singlePass(text, toIdx), toIdx);

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

/** 解析模板（全 CJK 夹写，无保护区/所有格/英文词——参照实现的前提）。 */
const TEMPLATES: string[] = [
    "「A. 甲」正确，A 错误。",
    "「B 乙」正确，「C. 丙」错误。",
    "A 正确，B 错误。",
    "（A）甲 正确。",
    "「D. 丁」错误，C 正确。",
    "选项 C 错误，选项 A 正确。",
];

const OPTS4 = ["甲", "乙", "丙", "丁"];

describe("核心不变量（N=240 种子化排列）", () => {
    it("形式层：解析 === 单遍映射（引用前缀与独立词符同源同一遍）", () => {
        const seen = new Set<string>();
        let checked = 0;
        let distinguishable = 0; // 排列非对合（单遍与二次结果不同）的组数
        for (let k = 0; k < 240; k++) {
            const sol = TEMPLATES[k % TEMPLATES.length]!;
            const before = [...OPTS4];
            const x = shuffleListForDisplay([mk(sol, before)], { scope: `inv-${k}` })[0]!;
            const toIdx = toIdxOf(before, x);
            expect(x.solutionMd).toBe(singlePass(sol, toIdx));
            // 「不得二次映射」：只在排列能分辨两者时断言（对合排列下两遍等值，
            // 断言无意义；`A→C→B` 只有 3 元及以上循环才看得出）
            if (singlePass(sol, toIdx) !== doublePass(sol, toIdx)) {
                expect(x.solutionMd).not.toBe(doublePass(sol, toIdx));
                distinguishable += 1;
            }
            seen.add((x.optionMd ?? []).join("|"));
            checked += 1;
        }
        expect(checked).toBe(240);
        expect(distinguishable).toBeGreaterThan(20); // 样本里确有可分辨排列
        expect(seen.size).toBeGreaterThan(1); // 确实换了序（消剧透仍成立）
    });

    it("语义层：每条引用所指的选项文本洗牌前后一致（与 answer 同源）", () => {
        let refsChecked = 0;
        for (let k = 0; k < 240; k++) {
            const before = [...OPTS4];
            // 引用形态带文本：`「X. 文本」`——文本即该字母在库内所指的选项
            const sol = `「A. ${before[0]!}」正确，「C. ${before[2]!}」错误，B 错误。`;
            const x = shuffleListForDisplay([mk(sol, before)], { scope: `sem-${k}` })[0]!;
            const cards = cardsOf(x);
            const toIdx = toIdxOf(before, x);
            // 每条引用：引号里的文本必须仍坐在该字母的卡位上
            for (const m of (x.solutionMd ?? "").matchAll(/「([A-H])\.\s*([^」]+)」/g)) {
                const letter = m[1]!;
                const text = m[2]!;
                expect(cards[LETTERS.indexOf(letter)]).toBe(text);
                expect(toIdx.get(before.indexOf(text))).toBe(LETTERS.indexOf(letter));
                refsChecked += 1;
            }
            // answer 字母指向的仍是原正确项
            expect(cards[LETTERS.indexOf(x.answer!)]).toBe(before[0]!);
        }
        expect(refsChecked).toBe(240 * 2);
    });

    it("答案字母与该组引用的前缀字母始终同一（多选亦锁）", () => {
        for (let k = 0; k < 60; k++) {
            const before = [...OPTS4];
            const q = mk("「A. 甲」正确，「C. 丙」正确。", before, { type: QuestionType.Multiple, answer: "AC" });
            const x = shuffleListForDisplay([q], { scope: `multi-${k}` })[0]!;
            const cards = cardsOf(x);
            const heads = [...(x.solutionMd ?? "").matchAll(/「([A-H])\.\s*(甲|丙)」/g)];
            expect(heads).toHaveLength(2);
            for (const m of heads) {
                expect(x.answer!.includes(m[1]!)).toBe(true); // 前缀在答案字母集合内
                expect(cards[LETTERS.indexOf(m[1]!)]).toBe(m[2]!); // 且指向同一文本
            }
        }
    });

    it("恒等排列：解析逐字节不变（零动作不是「换了又换回来」）", () => {
        // 展示层入口**恒定重掷掉恒等排列**（消剧透），故恒等只能从映射层验：
        // 恒等 `toIdx` 下 remapQuotedHead 与 rewriteLetters 都必须原样返回。
        const idMap = new Map<number, number>([
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 3],
        ]);
        for (const sol of TEMPLATES) {
            expect(remapQuotedHead(sol, idMap, LETTERS)).toBe(sol);
            expect(rewriteLetters(sol, letterMapper(idMap))).toBe(sol);
            expect(rewriteLetters(remapQuotedHead(sol, idMap, LETTERS), letterMapper(idMap))).toBe(sol);
        }
    });
});

describe("对抗矩阵", () => {
    it("同一字母既作引用前缀又独立出现：单遍映射，不得二次映射（钉住 remapQuotedHead 先于 rewriteLetters）", () => {
        // 3 元循环排列（A→C / C→B / B→A）：二次映射会得到与单遍不同的字母，
        // 是「先改前缀、再改词符」与「反序」唯一可分辨的排列类型。
        const toIdx = new Map<number, number>([
            [0, 2],
            [1, 0],
            [2, 1],
        ]);
        const sol = "「A. 甲」正确，A 错误。";
        const once = rewriteLetters(remapQuotedHead(sol, toIdx, LETTERS), letterMapper(toIdx));
        const reversed = remapQuotedHead(rewriteLetters(sol, letterMapper(toIdx)), toIdx, LETTERS);
        expect(once).toBe("「C. 甲」正确，C 错误。");
        expect(once).not.toBe(doublePass(sol, toIdx)); // 不是 A→C→B
        // ⚠️ **两个次序实测不可分辨**（本文件 3000 组随机文本 × 3 元全排列穷举，
        // 零差异）：`remapQuotedHead` 的命中集与 `rewriteLetters` 的可改集**由同
        // 一条判据（前导字符是 `「`）切开、互为补集**——反序只少改不重改，二次
        // 映射在这两个函数之间结构上不可达。故这里锁的是「两种次序都不产生
        // A→C→B」，而不是「次序必须如此」；模块注释声称的『顺序反了会二次映射』
        // 与实测不符（见 PR 归因表）。
        expect(reversed).toBe(once);
        // 穷举取证：3 元全排列 × 大量随机引文形态，两序零差异
        const perms: number[][] = [];
        const walk = (rest: number[], cur: number[]): void => {
            if (rest.length === 0) {
                perms.push(cur);
                return;
            }
            rest.forEach((v, i) => walk([...rest.slice(0, i), ...rest.slice(i + 1)], [...cur, v]));
        };
        walk([0, 1, 2], []);
        const toks = ["「", "」", "A", "B", "C", "D", " ", ".", "、", "甲", "错误", "正确", "（", "）", "'", ","];
        let seed = 7;
        const rnd = (): number => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };
        let diffs = 0;
        for (let k = 0; k < 3000; k++) {
            const text = Array.from(
                { length: 2 + Math.floor(rnd() * 8) },
                () => toks[Math.floor(rnd() * toks.length)]!
            ).join("");
            const perm = perms[Math.floor(rnd() * perms.length)]!;
            const map3 = new Map<number, number>(perm.map((j, i) => [i, j]));
            const fwd = rewriteLetters(remapQuotedHead(text, map3, LETTERS), letterMapper(map3));
            const rev = remapQuotedHead(rewriteLetters(text, letterMapper(map3)), map3, LETTERS);
            if (fwd !== rev) diffs += 1;
        }
        expect(diffs).toBe(0);
        // 展示层入口（rand=()=>0 ⇒ order [1,2,0]，同一条 3 元循环）
        const x = shuffleForDisplay(mk(sol, ["甲", "乙", "丙"]), () => 0);
        expect(x.answer).toBe("C");
        expect(x.solutionMd).toBe("「C. 甲」正确，C 错误。");
        expect(x.solutionMd).not.toBe(doublePass(sol, toIdx));
    });

    it("超范围字母（3 选项组解析写 E）原样保留", () => {
        const x = shuffleForDisplay(mk("E 错误，F 也不对。", ["甲", "乙", "丙"]), () => 0);
        expect(x.solutionMd).toBe("E 错误，F 也不对。");
        // 超范围字母出现在引用前缀位置同样不动（remapQuotedHead 按组长度校验）
        const y = shuffleForDisplay(mk("「E. 戊」正确，A 错误。", ["甲", "乙", "丙"]), () => 0);
        expect(y.solutionMd).toContain("「E. 戊」");
        expect(y.solutionMd).toContain("C 错误。"); // 组内字母照改
    });

    it("英文正文词（含多空格）与所有格前缀：不改写", () => {
        for (const sol of ["Plan A failed.", "Plan  A works (double space).", "Students' A is graded."]) {
            expect(shuffleForDisplay(mk(sol, OPTS4), () => 0).solutionMd).toBe(sol);
            expect(shuffleForDisplay(mk(sol, OPTS4), () => 0.9).solutionMd).toBe(sol);
        }
    });

    it("数学 / 代码保护区里的独立字母：不改写", () => {
        const sol = "$x_A$ 与 $A^{2}$ 无关，`A` 也不相关，$$A$$ 与 \\(A\\) 与 \\[A\\] 同。";
        expect(shuffleForDisplay(mk(sol, OPTS4), () => 0).solutionMd).toBe(sol);
    });

    it("所有格后缀 `A's`：不改写（R1 回归锁）", () => {
        // 修复前：`D's plan works.`（rand=0 时 A→D）。判据当时只排**前导**
        // 撇号 `students' A`，不排**后随**撇号 `A's` ⇒ 英文所有格的 A 被当
        // 引用改写。现由 `LetterRefs.POSSESSIVE_AFTER` 否掉（半/全角撇号均认）。
        for (const sol of ["A's plan works.", "A’s plan works.", "A' works."]) {
            expect(shuffleForDisplay(mk(sol, OPTS4), () => 0).solutionMd).toBe(sol);
            expect(shuffleForDisplay(mk(sol, OPTS4), () => 0.9).solutionMd).toBe(sol);
        }
        // 反向锁：**带空格**的 `A 's` 不是所有格，是独立引用（判据只挡紧贴）
        expect(shuffleForDisplay(mk("A 's plan.", OPTS4), () => 0).solutionMd).toBe("D 's plan.");
    });

    it("CJK 融合词紧贴的字母 `维生素A`：不改写（R2 回归锁）", () => {
        // 修复前：`维生素D 缺乏症。`（判据只排除 ASCII 词前缀，CJK 不在排除面）。
        // 现由 `LetterRefs.WORD_BEFORE_CJK` 否掉——**只挡紧贴**。
        for (const sol of ["维生素A 缺乏症。", "A型血 是常见类型。", "B站 的题。"]) {
            expect(shuffleForDisplay(mk(sol, OPTS4), () => 0).solutionMd).toBe(sol);
        }
        // ⚠️ 反向锁（同一条用例里两向都锁）：带分隔符的照旧是引用——
        // 「只挡紧贴」若被实现成「见 CJK 就不改」，真机引用会成片漏检。
        expect(shuffleForDisplay(mk("维生素 A 缺乏症。", OPTS4), () => 0).solutionMd).toBe("维生素 D 缺乏症。");
        expect(shuffleForDisplay(mk("选项 A 正确。", OPTS4), () => 0).solutionMd).toBe("选项 D 正确。");
    });

    it("字母 + 数字型号 `A4纸` / `B2B`：不改写（R3 回归锁）", () => {
        // 修复前：`D4纸 规格。`（`LETTER_TOKEN` 只挡 `[A-Za-z]` 两侧，数字不在
        // 排除面）。现由 `LetterRefs.DIGIT_AFTER` 否掉——只挡**后随数字**。
        for (const sol of ["A4纸 规格。", "B2B 业务。", "C2 系统与 D5 平台。"]) {
            expect(shuffleForDisplay(mk(sol, OPTS4), () => 0).solutionMd).toBe(sol);
        }
        // 反向锁：数字在**前**（`1A` 是编号后缀？）不影响判定——字母后无数字
        // 仍是引用候选，靠前缀/词符判据决定
        expect(shuffleForDisplay(mk("第 4 项后 A 正确。", OPTS4), () => 0).solutionMd).toBe("第 4 项后 D 正确。");
    });

    it("代码 / 数学保护区内的引用前缀：原样（R4 回归锁）", () => {
        // 修复前前缀照改（`D.`）：`remapQuotedHead` 未接 `protectionMask`，
        // 同一段文本词符层不动、引头层照改，两层口径不一致。
        // 现由 `OptGroups.remapQuotedHead` 过 mask 守住（`mask[offset+1]`）。
        for (const sol of [
            "`「A. 甲」` 是代码。",
            "$「A. 甲」$ 是公式。",
            "$$「A. 甲」$$ 同。",
            "\\(「A. 甲」\\) 同。",
        ]) {
            expect(shuffleForDisplay(mk(sol, OPTS4), () => 0).solutionMd).toBe(sol);
        }
        // 反向锁：**保护区外**的引头照旧映射（不许为了挡保护区把引头整类关掉）
        expect(shuffleForDisplay(mk("`代码` 与 「A. 甲」正确。", OPTS4), () => 0).solutionMd).toBe(
            "`代码` 与 「D. 甲」正确。"
        );
    });

    it("stemMd 不改写；steps 各步独立洗、cloak/match 不洗；WenguStep 无解析部件", () => {
        const stem = "关于 A、B 两点的说法，正确的是（ ）";
        const x = shuffleForDisplay(mk("A 正确。", ["甲", "乙", "丙"], { stemMd: stem }), () => 0);
        expect(x.stemMd).toBe(stem); // 题干字母多为实体名，改写面外
        expect(x.solutionMd).toBe("C 正确。");

        const steps: WenguQuestion = {
            id: "s",
            type: QuestionType.Steps,
            attempts: 0,
            wrongCount: 0,
            answer: "A",
            solutionMd: "题级解析 A 不动。",
            steps: [
                { kind: "method", stemMd: "第一步", optionMd: ["甲", "乙"], answer: "A" },
                { kind: "result", stemMd: "第二步", optionMd: ["丙", "丁"], answer: "A" },
            ],
        };
        const z = shuffleForDisplay(steps, () => 0);
        expect(z.solutionMd).toBe("题级解析 A 不动。"); // 各步映射不同，题级指代无从判定
        expect(z.steps!.map((s) => s.optionMd)).toEqual([
            ["乙", "甲"],
            ["丁", "丙"],
        ]);
        expect(z.steps!.map((s) => s.answer)).toEqual(["B", "B"]);
        expect(z.steps!.some((s) => "solutionMd" in (s as object))).toBe(false); // WenguStep 无解析

        for (const t of [QuestionType.Cloze, QuestionType.Match]) {
            const q = mk("A 正确。", ["甲", "乙"], { type: t });
            expect(shuffleForDisplay(q, () => 0)).toBe(q); // 引用相等：零改动
        }
        const sensitive = mk("A 正确。", ["甲", "以上都对"], {});
        expect(shuffleForDisplay(sensitive, () => 0)).toBe(sensitive); // 位置敏感措辞组不洗
    });
});

/** 口径单一落点（源级）：展示层不得自持正则、两处必须共用同一套判定。 */
describe("口径单一落点与既有回归锁", () => {
    const SOURCES = import.meta.glob("./CardDisplayShuffle.ts", {
        query: "?raw",
        import: "default",
        eager: true,
    }) as Record<string, string>;
    const DRAFT = import.meta.glob("../../convert/service/draft/{LetterRefs,OptionRefReplace}.ts", {
        query: "?raw",
        import: "default",
        eager: true,
    }) as Record<string, string>;

    it("CardDisplayShuffle 的词符判定全部来自 LetterRefs / OptGroups（无自持 A–H 正则）", () => {
        const src = SOURCES["./CardDisplayShuffle.ts"]!;
        expect(src).toContain('from "../../convert/service/draft/LetterRefs"');
        expect(src).toContain('from "../../convert/service/draft/OptGroups"');
        // 词符正则只允许在 LetterRefs 里出现（展示层再写一套必然漂移）
        expect(src).not.toMatch(/\[A-H\]/);
        expect(DRAFT["../../convert/service/draft/LetterRefs.ts"]!).toMatch(/\[A-H\]/);
        expect(DRAFT["../../convert/service/draft/OptionRefReplace.ts"]!).toContain("LetterRefs");
    });

    it("既有回归锁不回退（OptionRefReplace.test.ts 新口径三断言，逐条复述）", () => {
        // ① 截断形态只带**引用前缀**（前 30 字 + 省略号，无字母提示）；
        // ② 洗后前缀字母 = 洗后答案字母；③ 引用正文逐字不动。
        const LONG = ["A proposal to establish a new framework for international cooperation", "Another", "Third"];
        const sol = `「${LONG[0]!.slice(0, 30)}…」正确。`;
        expect(/「([A-H])/.exec(sol)?.[1]).toBe("A");
        expect(sol.split("」")).toHaveLength(2);
        expect(sol).not.toMatch(/[（(][A-H][)）]/); // 不补字母提示（#148 复核定案）
        for (let k = 0; k < 12; k++) {
            const x = shuffleListForDisplay([mk(sol, LONG)], { scope: `reg-${k}` })[0]!;
            const head = /「([A-H])/.exec(x.solutionMd ?? "")?.[1] ?? "";
            expect(head).toBe(x.answer);
            expect(x.optionMd![LETTERS.indexOf(head)]).toBe(LONG[0]);
            expect(x.solutionMd).toContain(`${LONG[0]!.slice(1, 30)}…」正确。`); // 前缀之后逐字不动
        }
    });

    it("长选项截断引用（Issue #148 口径，不回退）：前缀随映射、引用正文逐字不动", () => {
        const LONG = [
            "A proposal to establish a new framework for international cooperation",
            "The author argues that technology has reshaped the way we communicate",
            "Governments should prioritize environmental protection over growth",
        ];
        const sol = `「A ${LONG[0]!.slice(0, 28)}…」正确。`;
        for (let k = 0; k < 12; k++) {
            const x = shuffleListForDisplay([mk(sol, LONG)], { scope: `long-${k}` })[0]!;
            const head = /「([A-H])/.exec(x.solutionMd ?? "")?.[1] ?? "";
            expect(head).toBe(x.answer); // 前缀 = 洗后答案字母（同一项）
            expect(x.optionMd![LETTERS.indexOf(head)]).toBe(LONG[0]); // 指向原文本
            // 引用正文（前缀之后的部分）逐字不动
            expect(x.solutionMd).toContain(` ${LONG[0]!.slice(0, 28)}…」正确。`);
        }
    });

    it("双字母剥净（#176 伴生畸形）：展示侧口径对 ≤3 层标签亦干净", () => {
        // 主修在落库（renderUnit 拼接处），展示侧是幂等兜底——两层都验：
        // 展示侧走 optionDisplayMd（封顶 3 层）；落库侧走 normalizeOptionLabels。
        const q = mk("A 正确。", ["- A. A. 时空是一切运动的观念载体", "另一项"], {});
        const x = shuffleForDisplay(q, () => 0);
        const stripped = (x.optionMd ?? []).map((t) => optionDisplayMd(t.replace(/^\s*-\s*/, "")));
        expect(stripped).toContain("时空是一切运动的观念载体");
        for (const t of stripped) expect(t).not.toMatch(/^A\.\s*A\./);
    });
});
