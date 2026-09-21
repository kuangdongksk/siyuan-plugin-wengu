import { describe, expect, it } from "vitest";
import { QuestionType } from "../../types";
import { materialExamplesFor, materialRulesFor, protocolSpec, typeRulesFor } from "./protocol";

/**
 * 题型化 prompt 的裁剪口径（20260910 起）：undefined = 全量兜底（与题型化
 * 改造前逐字节一致），给定题型时按在场题型裁剪。Issue #30 的词条保真约定
 * 挂在「英语题型约定」段——**只有四类英语题型在场才拼**，非英语卷的
 * prompt 产物因此逐字节不含该段（验收第 5 条）。
 */

describe("materialRulesFor：英语题型约定与词条保真段", () => {
    it("英语题型在场：带词条保真约定", () => {
        const s = materialRulesFor([QuestionType.Cloze]);
        expect(s).toContain("英语题型约定");
        expect(s).toContain("词条保真");
        expect(s).toContain("@@P body");
    });

    it("非英语题型在场：整段省略（词条段一并省略）", () => {
        expect(materialRulesFor([QuestionType.Single, QuestionType.Brief])).toBe("");
        expect(materialRulesFor([QuestionType.Steps])).not.toContain("词条保真");
    });

    it("undefined 全量兜底：四类全拼 + 词条保真段在场（兜底也是全量的组成）", () => {
        const s = materialRulesFor(undefined);
        expect(s).toContain("完形填空");
        expect(s).toContain("翻译用 type");
        expect(s).toContain("词条保真");
    });

    it("各题型只拼自己的约定（裁剪生效）", () => {
        expect(materialRulesFor([QuestionType.Trans])).not.toContain("完形填空");
        expect(materialRulesFor([QuestionType.Trans])).toContain("翻译用 type");
    });
});

describe("protocolSpec · 选项顺序变体（Issue #123；#131 加 bank；#206 收敛为单规则）", () => {
    it("默认：要求「正确项写最前」（新造题口径）", () => {
        expect(protocolSpec([QuestionType.Single])).toContain("正确项写在最前");
    });

    it("keep：要求按原题顺序与字母，且不再出现「正确项写在最前」", () => {
        const s = protocolSpec([QuestionType.Single], { order: "keep" });
        expect(s).toContain("原题顺序与字母");
        expect(s).not.toContain("正确项写在最前");
    });

    it("bank（Issue #206）：单规则照抄——不重排、按原文选项顺序、答案按原序数", () => {
        const s = protocolSpec([QuestionType.Single], { bank: true });
        // 新口径在场（转换链只做 transcription、不重排）
        expect(s).toContain("不重排");
        expect(s).toContain("按原文选项顺序");
        expect(s).toContain("不写字母标签");
        // 逐题分支的两个旧口径字面**必须消失**（重排类错误在结构上不可能再发生）
        expect(s).not.toContain("逐题判断");
        expect(s).not.toContain("正确项写在最前");
        expect(s).not.toContain("原题顺序与字母");
    });

    it("bank 任意题型组合都出单规则（题型只影响 ans 约定，不动 @@P opt 行）", () => {
        for (const types of [undefined, [QuestionType.Single], [QuestionType.Steps, QuestionType.Multiple]]) {
            const s = protocolSpec(types, { bank: true });
            expect(s).toContain("不重排");
            expect(s).toContain("按原文选项顺序");
            expect(s).not.toContain("逐题判断");
            expect(s).not.toContain("正确项写在最前");
            expect(s).not.toContain("原题顺序与字母");
        }
    });

    it("bank 优先于 order（转换链口径优先于 regen 的 keep 序）", () => {
        const s = protocolSpec([QuestionType.Single], { order: "keep", bank: true });
        expect(s).toBe(protocolSpec([QuestionType.Single], { bank: true }));
        expect(s).not.toContain("原题顺序与字母");
    });

    it("变体只换「非变体差异」的行，其余段落逐字不变（含 undefined 全量兜底）", () => {
        // ⚠️ 标记约定（sol 规则行）自 P1（20260915 审查）起**缺省恒在**，
        // 不再是变体之间的差异——故剥除清单里只留「选项顺序」那几行的
        // 差异行；sol 规则行两侧都该在、原样参与比对（漏了它说明缺省被
        // 摘掉，正是那次要修的回归）。
        // ⚠️ 过滤词表随 #206 新文案更新（词表是「差异行」的代理，漏一词
        // 即断言失效）：bank 行现含「照原文抄 / 不重排 / 按原文选项顺序 /
        // 不写字母标签」，keep 行含「原题顺序与字母」，默认行含「正确项写
        // 在最前」——三者互不包含，故三行都被剥掉、其余段落逐字比对。
        const strip = (s: string): string =>
            s
                .split("\n")
                .filter(
                    (l) =>
                        !l.includes("正确项写在最前") &&
                        !l.includes("原题顺序与字母") &&
                        !l.includes("照原文抄") &&
                        !l.includes("按原文选项顺序")
                )
                .join("\n");
        for (const types of [undefined, [QuestionType.Single], [QuestionType.Steps, QuestionType.Multiple]]) {
            expect(strip(protocolSpec(types, { order: "keep" }))).toBe(strip(protocolSpec(types)));
            expect(strip(protocolSpec(types, { bank: true }))).toBe(strip(protocolSpec(types)));
        }
    });

    it("解析标记约定**缺省恒在**（P1）：三个变体都带，唯一差别在 @@P opt 行", () => {
        for (const types of [undefined, [QuestionType.Single], [QuestionType.Steps]]) {
            for (const opts of [undefined, { order: "keep" } as const, { bank: true } as const]) {
                const s = protocolSpec(types, opts);
                expect(s).toContain("〔opt:X〕");
                expect(s).toContain("不得用裸字母指代选项");
            }
        }
    });

    it("加练/变式链（conceptPrompt/variantPrompt 的默认协议）也带标记约定——解析不残留裸字母", () => {
        // GenQuestion 的加练与变式走默认 protocolSpec（无 opts），原先被
        // withSolRule 的条件判定漏在链外：解析裸字母 + 写库不洗 + 展示只
        // 重映射答案 ⇒ 一进卡字母就指错。缺省 true 后这条链一并覆盖。
        const s = protocolSpec([QuestionType.Single, QuestionType.Judge]);
        expect(s).toContain("选项引用约定");
        expect(s).toContain("〔opt:X〕");
        expect(s).toContain("正确项写在最前"); // 新造题仍走重排口径（与 sol 规则互不干扰）
    });

    it("solRule: false 是唯一摘除口（当前无调用方）", () => {
        const s = protocolSpec([QuestionType.Single], { solRule: false });
        expect(s).not.toContain("〔opt:X〕");
        expect(s).toContain("正确项写在最前");
    });
});

describe("protocolSpec / typeRulesFor / materialExamplesFor：类型裁剪", () => {
    it("undefined 兜底含 steps/steps-opt/slot-opt 全量部件说明", () => {
        const s = protocolSpec(undefined);
        expect(s).toContain("@@P step");
        expect(s).toContain("@@P slot-opt");
    });

    it("无 steps 题型时省略 steps 部件说明", () => {
        const s = protocolSpec([QuestionType.Single]);
        expect(s).not.toContain("@@P step（步引导语）");
        expect(s).not.toContain("多步引导题"); // 裁剪后不留 steps 残留
    });

    it("typeRulesFor：undefined 全量题型清单，给定题型只列在场项", () => {
        expect(typeRulesFor(undefined)).toContain("single/multiple/judge/fill/brief/steps/cloze/match/essay/trans");
        const s = typeRulesFor([QuestionType.Single]);
        expect(s).toContain("single");
        expect(s).toContain("brief"); // brief 恒含
        expect(s).not.toContain("cloze");
    });

    it("materialExamplesFor：非英语卷只提阅读文章", () => {
        expect(materialExamplesFor([QuestionType.Single])).toBe("：阅读文章等共用语篇");
        expect(materialExamplesFor([QuestionType.Cloze])).toContain("完形语篇");
        expect(materialExamplesFor(undefined)).toContain("新题型文章");
    });
});
