import { describe, expect, it } from "vitest";
import { normalizeBareRefs, normalizeDraftOptionRefs, replaceDraftOptionRefs } from "../draft/OptionRefReplace";
import { unpackPackedOptions } from "../draft/OptionUnpack";
import { parseDrafts, renderUnit, type DraftPart, type DraftUnit } from "../draft/QuestionDraft";
import { parseQuestionKramdown } from "../../../bank/data/BankParse";
import { QuestionBank as Bank } from "../../../bank/data/QuestionBank";
import { SetWriter } from "../output/SetWriter";
import type { BankData } from "../../../bank/data/QuestionBank";

(globalThis as { window?: unknown }).window ??= globalThis;

/**
 * Issue #176 的**独立验收（落库侧）**：三条落库链共用的
 * `normalizeDraftOptionRefs`（裸字母 / 「字母 + 全文」引用规范化）与
 * `unpack → replace → normalize` 的**次序与幂等**。
 *
 * 三条链（各自接线，`SetWriter` 兜不到另外两条）：
 *   - `convert/service/output/SetWriter.ts`（转换 / 增量）
 *   - `bank/gen/GenQuestion.ts`（加练 / 变式，直写题库）
 *   - `bank/ui/RegenDialog.ts`（单题重生成，直写 replaceRecordKramdown）
 * 本文件用 `?raw` 源级断言钉「三处调用点用的同一条表达式」，用**真实
 * SetWriter**（唯一能在单测里整链跑通的出口）钉端到端形态。
 *
 * ⚠️ **红项已收口**（20260919）：原先 2 条以 `it.fails` 落的红项转正为
 * 普通 `it`，断言一字未松——它们现在钉的是「修复不许回退」。
 */

const OPTS = ["维护封建统治", "加强思想教育", "以人民为中心", "全面从严治党"];

/** 三链与移动端的源码原文（源级断言；`?raw` 是仓内既有范式，不引 mock 库）。 */
const RAW = import.meta.glob("../../../**/{SetWriter,GenQuestion,RegenDialog,MobileRound}.ts", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

const SETWRITER = RAW["../output/SetWriter.ts"]!;
const GEN = RAW["../../../bank/gen/GenQuestion.ts"]!;
const REGEN = RAW["../../../bank/ui/RegenDialog.ts"]!;
const MOBILE = RAW["../../../mobile/core/MobileRound.ts"]!;

/** SetWriter / GenQuestion 的完整三步链（原地 unpack）。 */
const CHAIN_CALL = "normalizeDraftOptionRefs(replaceDraftOptionRefs(unpackPackedOptions(";
/** Regen 链：unpack 已在上游对 `drafts[0]` 做过，此处只接后两步。 */
const REGEN_CALL = "normalizeDraftOptionRefs(replaceDraftOptionRefs(draft))";

const draftOf = (sol: string, opts: string[] = OPTS, stem = "题干"): DraftUnit => ({
    material: false,
    attrs: { type: "single" },
    parts: [
        { name: "stem", text: stem },
        ...opts.map((t): DraftPart => ({ name: "option-0", text: t })),
        { name: "answer", text: "A" },
        { name: "solution", text: sol },
    ],
});

const solOf = (d: DraftUnit): string => d.parts.find((p) => p.name === "solution")?.text ?? "";
const chain = (d: DraftUnit): DraftUnit => normalizeDraftOptionRefs(replaceDraftOptionRefs(unpackPackedOptions(d)));

describe("三链接线同源（源级断言）", () => {
    it("SetWriter / GenQuestion 两处调用同一条 unpack→replace→normalize", () => {
        for (const [name, src] of [
            ["SetWriter", SETWRITER],
            ["GenQuestion", GEN],
        ] as const) {
            expect(`${name}:${src.includes(CHAIN_CALL)}`).toBe(`${name}:true`);
            expect(`${name}:${src.includes("normalizeDraftOptionRefs")}`).toBe(`${name}:true`);
        }
    });

    it("Regen 链：unpack 在 reseat 之前、replace+normalize 在 reseat 之后 render 之前", () => {
        const unpack = REGEN.indexOf("unpackPackedOptions(drafts[0])");
        const reseat = REGEN.indexOf("reseatAnswer(draft, q)");
        const fix = REGEN.indexOf(REGEN_CALL);
        const render = REGEN.indexOf("renderUnit(fixed)");
        expect(unpack).toBeGreaterThan(-1);
        expect(reseat).toBeGreaterThan(unpack); // reseat 要在拆分后的部件上看选项
        expect(fix).toBeGreaterThan(reseat); // 规范化在其之后（reseat 只动 ans 部件）
        expect(render).toBeGreaterThan(fix); // AI 自检看到的与落盘形态一致
    });

    it("移动端三处洗牌全走同一入口 shuffleListForDisplay（源级）", () => {
        expect(MOBILE.includes('from "../../quiz/render/CardDisplayShuffle"')).toBe(true);
        expect((MOBILE.match(/shuffleListForDisplay\(/g) ?? []).length).toBe(3);
        expect(MOBILE).not.toMatch(/\bMath\.random\b/); // 排列一律按会话 id 定种子
    });
});

describe("幂等：跑两遍 = 跑一遍", () => {
    const cases: [string, string[]][] = [
        ["A 正确，B 错误。", OPTS],
        ["A. 维护封建统治 正确。", OPTS],
        ["「维护封建统治」正确。", OPTS], // 已规范形态
        ["〔opt:B〕正确，A 错误。", OPTS], // 标记形态先转文本，再规范化
        ["E 错误。", OPTS], // 无凭据原样
    ];

    it("normalizeBareRefs 单函数层幂等", () => {
        for (const [sol, opts] of cases) {
            const once = normalizeBareRefs(sol, opts);
            expect(normalizeBareRefs(once, opts)).toBe(once);
        }
    });

    it("草稿单元层幂等（normalizeDraftOptionRefs）", () => {
        for (const [sol, opts] of cases) {
            const once = normalizeDraftOptionRefs(draftOf(sol, opts));
            const twice = normalizeDraftOptionRefs(once);
            expect(solOf(twice)).toBe(solOf(once));
        }
    });

    it("三步链整链幂等（unpack→replace→normalize 再跑一遍）", () => {
        for (const [sol, opts] of cases) {
            const once = chain(draftOf(sol, opts));
            const twice = chain(once);
            expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
        }
    });

    it("选项正文自带字母时链幂等（`A 与 B 相互独立`，R5 回归锁）", () => {
        // 修复前：第一遍产出的 `「A 与 B 相互独立」`，其**引号体内**的独立字母
        // 是第二遍的候选 ⇒ 再跑一遍得到 `「A 与 「两事件互斥」 相互独立」`，
        // 库内文本被静默改坏（幂等破）。现由 `quotedBodyMask` 把引号体当
        // **不透明区间**跳过 —— 幂等与「一条检出都不丢」同时成立。
        const opts = ["A 与 B 相互独立", "两事件互斥", "无法确定"];
        const once = normalizeBareRefs("A 正确，B 错误。", opts);
        expect(once).toBe("「A 与 B 相互独立」 正确，「两事件互斥」 错误。");
        expect(normalizeBareRefs(once, opts)).toBe(once);
        // 草稿单元层与整链层同样幂等（三层都钉，别只钉最内层）
        const d = draftOf("A 正确，B 错误。", opts);
        expect(solOf(normalizeDraftOptionRefs(normalizeDraftOptionRefs(d)))).toBe(solOf(normalizeDraftOptionRefs(d)));
        expect(JSON.stringify(chain(chain(d)))).toBe(JSON.stringify(chain(d)));
        // 反向锁：引号**体外**的引用照旧检出（跳过引号体不许把后面的也吞了）
        expect(normalizeBareRefs("「甲」正确，B 错误。", OPTS)).toBe("「甲」正确，「加强思想教育」 错误。");
    });
});

describe("「字母 + 全文」→「文本」：无叠影", () => {
    it("标签、全文与尾部空白一并吃掉（三种标签写法）", () => {
        expect(normalizeBareRefs("B. 加强思想教育 正确。", OPTS)).toBe("「加强思想教育」正确。");
        expect(normalizeBareRefs("B、加强思想教育 正确。", OPTS)).toBe("「加强思想教育」正确。");
        expect(normalizeBareRefs("（B）加强思想教育 正确。", OPTS)).toBe("「加强思想教育」正确。");
        expect(normalizeBareRefs("B：加强思想教育正确。", OPTS)).toBe("「加强思想教育」正确。");
    });

    it("选项正文自带字母的「字母 + 全文」不得再叠一份（英文阅读题常态）", () => {
        expect(normalizeBareRefs("A. A big plan 正确。", ["A big plan", "另一项"])).toBe("「A big plan」正确。");
        expect(
            normalizeBareRefs("B. The author argues this 正确，A. A proposal is wrong 错误。", [
                "A proposal is wrong",
                "The author argues this",
            ])
        ).toBe("「The author argues this」正确，「A proposal is wrong」错误。");
    });

    it("落库端到端（真实 SetWriter）：库内解析与题干都无裸字母", async () => {
        const { bank, data } = newBank();
        const w = new SetWriter(bank);
        const setId = await w.openSet({ title: "卷" });
        const out = await w.append(setId, [{ draft: draftOf("A. 维护封建统治 正确，B 错误。") }]);
        const kd = data().records[out.qids[0]!]!.kramdown;
        expect(kd).toContain("「维护封建统治」正确，「加强思想教育」 错误。");
        // 纯函数口径：调用方手里的 draft 未被污染
        const q = parseQuestionKramdown(kd, out.qids[0]!, setId);
        expect(q?.solutionMd).toContain("「维护封建统治」正确");
        // 解析部件里不再有裸字母引用（选项行里的 `- A. …` 是标签，不算引用）
        expect(q?.solutionMd).not.toMatch(/(?<![A-Za-z])[A-H](?![A-Za-z])/);
    });
});

describe("无凭据字母原样保留", () => {
    it("超范围字母 / 无选项组 / 空选项表一律原样", () => {
        expect(normalizeBareRefs("E 错误，F 也不对。", OPTS)).toBe("E 错误，F 也不对。");
        expect(normalizeBareRefs("Z 未知。", OPTS)).toBe("Z 未知。");
        expect(normalizeBareRefs("A 正确。", [])).toBe("A 正确。");
        expect(normalizeBareRefs("E 错误。", ["甲", "乙", "丙"])).toBe("E 错误。");
    });

    it("无凭据时草稿单元零改动（返回原对象）", () => {
        const d = draftOf("E 错误。", ["甲", "乙"]);
        expect(normalizeDraftOptionRefs(d)).toBe(d);
    });

    it("裸字母形态的受保护区 / 英文正文词不动（与标记替换相反：这里是猜测）", () => {
        const sol = "$x_A$ 与 `A` 无关；Plan A works（Plan  A 双空格同）。Students' A is graded.";
        expect(normalizeBareRefs(sol, OPTS)).toBe(sol);
    });

    it("所有格后缀 `A's` / CJK 融合词 `维生素A` / 型号 `A4纸`：不动（R1–R3 回归锁）", () => {
        // 三条款式与展示层同一条判据（`LetterRefs.isRefLetter`）——展示层那份
        // 回归锁在 `ShuffleRemapInvariants.test.ts`，这里钉落库链的口径一致。
        for (const sol of ["A's plan works.", "维生素A 缺乏症。", "A4纸 规格。", "B2B 业务。"]) {
            expect(normalizeBareRefs(sol, OPTS)).toBe(sol);
        }
        // ⚠️ 反向锁（同一判据不许为了不误伤而漏检）：真机三种引用形态照旧检出
        expect(normalizeBareRefs("A 正确。", OPTS)).toBe("「维护封建统治」 正确。");
        expect(normalizeBareRefs("选项 A 正确。", OPTS)).toBe("选项 「维护封建统治」 正确。");
        expect(normalizeBareRefs("A. 维护封建统治 全文。", OPTS)).toBe("「维护封建统治」全文。");
        expect(normalizeBareRefs("（B）加强思想教育 正确。", OPTS)).toBe("「加强思想教育」正确。");
    });

    it("代码 / 数学保护区里的独立字母不动（本层已守住）", () => {
        // `normalizeBareRefs` 先做 `protectionMask`，故代码/数学区确实不动
        // ——裸字母是**猜测**，碰保护区就是静默毁公式（见模块头）。
        // 「展示层同步改写解析」的旧对照组已随 Issue #176 收窄撤除：展示层
        // 根本不碰文本，这条只剩本层自身口径。
        const sol = "$x_A$ 与 `A` 无关，$$A$$ 同。";
        expect(normalizeBareRefs(sol, OPTS)).toBe(sol);
    });
});

describe("次序：unpack → replace → normalize", () => {
    it("挤行部件必须先拆行，否则字母表与渲染序错位（拆前拆后产物对比）", () => {
        const packed = (): DraftUnit => ({
            material: false,
            attrs: { type: "single" },
            parts: [
                { name: "stem", text: "题干" },
                { name: "option-0", text: "A. 甲文本\nB. 乙文本" },
                { name: "answer", text: "A" },
                { name: "solution", text: "A 正确，B 错误。" },
            ],
        });
        const good = renderUnit(chain(packed()));
        const noUnpack = renderUnit(normalizeDraftOptionRefs(replaceDraftOptionRefs(packed())));
        // 正确次序：两个选项各占一行、字母表两项、引用各自成对
        expect(good).toContain("- A. 甲文本\n- B. 乙文本");
        expect(good).toContain("「甲文本」 正确，「乙文本」 错误。");
        // 反例（照实记录，供归因参照）：不拆行时字母表只有 1 项、正文残留 `B.`
        expect(noUnpack).not.toBe(good);
        expect(noUnpack).toContain("B. 乙文本");
    });

    it("标记替换必须先于裸字母规范化（反序会留下 `〔opt:…〕` 或错引）", () => {
        const d = draftOf("〔opt:B〕正确，A 错误。");
        const good = chain(d);
        expect(solOf(good)).toBe("「加强思想教育」正确，「维护封建统治」 错误。");
        // 反序：normalize 先跑时 `〔opt:B〕` 里的 B 被当裸字母换掉，标记残缺
        const bad = unpackPackedOptions(replaceDraftOptionRefs(normalizeDraftOptionRefs(d)));
        expect(solOf(bad)).not.toBe(solOf(good));
        expect(solOf(bad)).toContain("〔opt:");
    });

    it("端到端：真实 SetWriter 落库后读回，解析不再含选项字母引用", async () => {
        const { bank, data } = newBank();
        const w = new SetWriter(bank);
        const setId = await w.openSet({ title: "卷" });
        const packed: DraftUnit = {
            material: false,
            attrs: { type: "single" },
            parts: [
                { name: "stem", text: "题干" },
                { name: "option-0", text: "甲文本\n乙文本" },
                { name: "answer", text: "B" },
                { name: "solution", text: "A. 甲文本 错误，B 正确。" },
            ],
        };
        const out = await w.append(setId, [{ draft: packed }]);
        const q = parseQuestionKramdown(data().records[out.qids[0]!]!.kramdown, out.qids[0]!, setId);
        expect(q?.optionMd).toHaveLength(2);
        expect(q?.solutionMd).not.toMatch(/(?<![A-Za-z])[A-H](?![A-Za-z])/);
    });
});

/** 内存题库（与 SetWriter.test.ts 同款最小替身；不引 mock 库）。 */
function newBank(): { bank: Bank; data: () => BankData } {
    let cache: BankData | undefined;
    const bank = new Bank(
        async () =>
            (cache ??= {
                version: 1,
                records: {},
                collections: [],
                migratedDocs: [],
                hashed: {},
                knowRoots: [],
                folders: [],
                docStats: {},
                sets: {},
                materials: {},
            } as BankData),
        async (v) => {
            cache = v;
        }
    );
    return { bank, data: () => cache! };
}

describe("草稿解析入口同链（parseDrafts → 三链）", () => {
    it("AI 回复文本落库：裸字母引用被规范化（行协议整链）", () => {
        const d = parseDrafts(
            [
                "@@Q type=single",
                "@@P stem",
                "题干",
                ...OPTS.flatMap((o) => ["@@P opt", o]),
                "@@P ans",
                "B",
                "@@P sol",
                "A. 维护封建统治 错误，B 正确。",
                "@@END",
            ].join("\n")
        )[0]!;
        expect(solOf(chain(d))).toBe("「维护封建统治」错误，「加强思想教育」 正确。");
    });
});
