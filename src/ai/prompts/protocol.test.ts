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

describe("protocolSpec · 选项顺序变体（Issue #123；Issue #131 加 bank 条件规则）", () => {
    it("默认：要求「正确项写最前」（新造题口径）", () => {
        expect(protocolSpec([QuestionType.Single])).toContain("正确项写在最前");
    });

    it("keep：要求按原题顺序与字母，且不再出现「正确项写在最前」", () => {
        const s = protocolSpec([QuestionType.Single], { order: "keep" });
        expect(s).toContain("原题顺序与字母");
        expect(s).not.toContain("正确项写在最前");
    });

    it("bank（Issue #131）：逐题条件规则——原文有现成选项走原序、新造题走重排", () => {
        const s = protocolSpec([QuestionType.Single], { bank: true });
        expect(s).toContain("原题顺序与字母");
        expect(s).toContain("正确项写在最前");
        expect(s).toContain("逐题判断");
    });

    it("bank 优先于 order（两支语义已在条件规则里）", () => {
        const s = protocolSpec([QuestionType.Single], { order: "keep", bank: true });
        expect(s).toContain("逐题判断");
    });

    it("变体只换 @@P opt 那一行，其余段落逐字不变（含 undefined 全量兜底）", () => {
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
        for (const types of [undefined, [QuestionType.Single], [QuestionType.Steps, QuestionType.Multiple]]) {
            expect(strip(protocolSpec(types, { order: "keep" }))).toBe(strip(protocolSpec(types)));
            expect(strip(protocolSpec(types, { bank: true }))).toBe(strip(protocolSpec(types)));
        }
    });

    it("解析选项引用标记协议：只有显式要口径的调用方拿得到（默认不带）", () => {
        for (const types of [undefined, [QuestionType.Single], [QuestionType.Steps]]) {
            expect(protocolSpec(types)).not.toContain("〔opt:X〕");
            expect(protocolSpec(types, { order: "keep" })).toContain("〔opt:X〕");
            expect(protocolSpec(types, { bank: true })).toContain("〔opt:X〕");
        }
    });

    it("默认变体（新造题）不提「不得用裸字母指代选项」——加练/变式链路逐字节不变", () => {
        expect(protocolSpec([QuestionType.Single])).not.toContain("不得用裸字母指代选项");
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
