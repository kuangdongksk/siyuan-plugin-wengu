import { describe, expect, it } from "vitest";
import { QuestionType } from "../../types";
import { annoEnabled, isEnglishTypes, pickAnnobarButtons } from "./AnnoScope";

/**
 * 标注浮条作用域纯逻辑（Issue #45）：模式闸（只做题模式放行）、卷级
 * 英语判定（题型并集含英语四类任一）、按钮分流（两钮都不出=不出现）。
 */

describe("annoEnabled 模式闸", () => {
    it("只有做题模式放行", () => {
        expect(annoEnabled("quiz")).toBe(true);
    });

    it("预览/复习/学习一律不出浮条（Issue #45 验收 2/3）", () => {
        expect(annoEnabled("preview")).toBe(false);
        expect(annoEnabled("review")).toBe(false);
        expect(annoEnabled("study")).toBe(false);
    });
});

describe("isEnglishTypes 卷级英语判定", () => {
    it("英语四类任一在场即英语卷", () => {
        for (const t of [QuestionType.Cloze, QuestionType.Match, QuestionType.Essay, QuestionType.Trans]) {
            expect(isEnglishTypes([QuestionType.Single, t])).toBe(true);
        }
    });

    it("纯数学/政治题型不是英语卷", () => {
        expect(isEnglishTypes([QuestionType.Single, QuestionType.Multiple, QuestionType.Fill])).toBe(false);
        expect(isEnglishTypes([QuestionType.Brief, QuestionType.Steps, QuestionType.Judge])).toBe(false);
    });

    it("英语阅读的 single 题要靠同卷英语题型认出来（题级判不开）", () => {
        // 单看这道题（single）判不出，卷级并集里有 essay/cloze 才行
        expect(isEnglishTypes([QuestionType.Single])).toBe(false);
        expect(isEnglishTypes([QuestionType.Single, QuestionType.Trans])).toBe(true);
    });

    it("空并集/缺省判否（反查不出证据宁缺勿错）", () => {
        expect(isEnglishTypes([])).toBe(false);
        expect(isEnglishTypes(undefined)).toBe(false);
        expect(isEnglishTypes(null)).toBe(false);
    });
});

describe("pickAnnobarButtons 按钮分流", () => {
    it("预览/复习：两钮都不出，浮条整体不出现", () => {
        for (const mode of ["preview", "review", "study"] as const) {
            expect(pickAnnobarButtons({ mode, isCluable: true, english: true })).toEqual({
                show: false,
                clue: false,
                word: false,
            });
        }
    });

    it("做题模式既有行为不变：可标区域出两钮，其余区域只出标生词", () => {
        expect(pickAnnobarButtons({ mode: "quiz", isCluable: true, english: true })).toEqual({
            show: true,
            clue: true,
            word: true,
        });
        expect(pickAnnobarButtons({ mode: "quiz", isCluable: false, english: true })).toEqual({
            show: true,
            clue: false,
            word: true,
        });
    });

    it("非英语卷：任何区域都不出标生词，可标区域仍出标为线索（验收 4）", () => {
        expect(pickAnnobarButtons({ mode: "quiz", isCluable: true, english: false })).toEqual({
            show: true,
            clue: true,
            word: false,
        });
    });

    it("非英语卷且非可标区域：浮条整体不出现（不出空条，验收 4）", () => {
        expect(pickAnnobarButtons({ mode: "quiz", isCluable: false, english: false })).toEqual({
            show: false,
            clue: false,
            word: false,
        });
    });
});
