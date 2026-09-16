import { describe, expect, it } from "vitest";
import { QuestionType } from "../../types";
import { buildRegenPrompt, conceptPrompt, variantPrompt, verifyPrompt } from "./gen";

/**
 * 单题生成族 prompt 的口径（Issue #131 P1，20260915 审查）：**解析标记
 * 协议 `〔opt:X〕` 全链统一**——凡是产物会落库、会被展示层洗牌的链，
 * 解析里都不许留裸字母指代选项。
 *
 * 原先这条约定只挂在 `order` / `bank` 上，把加练（conceptPrompt）与变式
 * （variantPrompt）漏在链外：它们走**默认协议**（无 opts），AI 写裸字母
 * （按它自己输出的序位），而写库已不洗、展示层只重映射答案 ⇒ 这些新题
 * 一进卡解析字母就指错。缺省 true 后本文件把这条链锁住。
 *
 * 与 `protocol.test.ts` 的分工：那里锁 `protocolSpec` 本身（变体差异、
 * 裁剪口径）；这里锁**调用方拿到的最终 prompt**（谁带标记约定、谁不该带）。
 */

/** 标记约定的判据串（出现在协议 @@P sol 行下方，独占一行）。 */
const SOL_RULE_MARK = "选项引用约定";

describe("加练/变式链的解析标记约定（P1）", () => {
    it("conceptPrompt（概念辨析/加练）：带 〔opt:X〕 约定", () => {
        const p = conceptPrompt("幂函数", "", "幂函数小节正文");
        expect(p).toContain(SOL_RULE_MARK);
        expect(p).toContain("〔opt:X〕");
        expect(p).toContain("不得用裸字母指代选项");
        // 新造题的选项顺序口径仍是「正确项写最前」（与标记约定互不干扰）
        expect(p).toContain("正确项写在最前");
    });

    it("variantPrompt（知识点变式 / 按题变式）：带 〔opt:X〕 约定", () => {
        for (const type of [QuestionType.Single, QuestionType.Steps, undefined]) {
            const p = variantPrompt("原题 kramdown", "", type);
            expect(p).toContain(SOL_RULE_MARK);
            expect(p).toContain("〔opt:X〕");
        }
    });

    it("按题变式重练（generateVariantOf 的 prompt 同款路径）：同样带", () => {
        // generateVariantOf 直接调 variantPrompt，无额外包装——本断言即锁它
        const p = variantPrompt("原题", "", QuestionType.Multiple);
        expect(p).toContain("不得用裸字母指代选项");
    });

    it("regen（keep 序）：标记约定照旧在", () => {
        const p = buildRegenPrompt("原题 kd", "", "小节", "", QuestionType.Single, "keep");
        expect(p).toContain(SOL_RULE_MARK);
        expect(p).toContain("原题顺序与字母");
    });

    it("自检 prompt 不带标记约定（它不是出题协议，只是算一遍比对）", () => {
        // verifyPrompt 的入参是**已渲染的题目 kramdown**（标记早被 OptionRefReplace
        // 换成选项文本），它自身不该出现任何 `` 约定——否则 AI 会被要求写标记
        expect(verifyPrompt('{{{row\n题干\n}}}\n{: custom-plugin-wengu-q="1"}')).not.toContain(SOL_RULE_MARK);
    });
});
