import { describe, expect, it } from "vitest";
import { fallbackQuestionHtml, optionRowHtml } from "./ProtyleHost";
import type { WenguQuestion } from "../../types";

/**
 * 静态/降级渲染的选项字母角标回归面（20260828 用户反馈「ABCD 都没了」）：
 * >50 题长卷与题库模式走 mountStatic、Protyle 挂载失败走降级——两路
 * 都经 optionRowHtml，选项文本被 optionDisplayMd 剥掉文档里的字母
 * 标签后，字母必须由页签按位补画，否则作答 chip（A/B/C/D）无从对应。
 * node 环境无 window.Lute，safeLute 退 <pre> 纯文本——正好锁「角标
 * 在、正文在、原字母标签不在」的结构断言。
 */

describe("optionRowHtml：选项行字母角标", () => {
    it("按位画角标且正文剥掉列表标记与字母标签", () => {
        const a = optionRowHtml(0, "- A. 甲");
        expect(a).toContain('<span class="wengu-opt-letter">A</span>');
        expect(a).toContain('class="wengu-opt-body"');
        expect(a).toContain("甲");
        expect(a).not.toContain("A. 甲");
        const b = optionRowHtml(1, "B、乙");
        expect(b).toContain('<span class="wengu-opt-letter">B</span>');
        expect(b).not.toContain("B、乙");
    });

    it("自定义行类（复习详情复用同款角标）", () => {
        expect(optionRowHtml(0, "甲", "wengu-review-option")).toContain('class="wengu-review-option"');
    });

    it("越界下标角标为空不抛异常", () => {
        expect(optionRowHtml(99, "甲")).toContain('<span class="wengu-opt-letter"></span>');
    });
});

describe("fallbackQuestionHtml：题干 + 选项行", () => {
    it("选项逐行带角标，与 optionMd 顺序对齐", () => {
        const q = {
            id: "q1",
            attempts: 0,
            wrongCount: 0,
            stemMd: "题干",
            optionMd: ["- A. 甲", "- B. 乙", "- C. 丙", "- D. 丁"],
        } satisfies WenguQuestion;
        const html = fallbackQuestionHtml(q);
        expect(html).toContain("题干");
        expect(html).toContain('<div class="wengu-opts">'); // 多列排布容器（opt-compact）
        for (const letter of ["A", "B", "C", "D"]) {
            expect(html).toContain(`<span class="wengu-opt-letter">${letter}</span>`);
            expect(html).not.toContain(`${letter}.`);
        }
    });
});
